'use strict';
const { Game } = require('./game');
const config = require('./config');

// Adapted from hand_game's presence, ready and disconnect handlers. A Map keyed
// by account identity and one private room per Game replace its global game.
class Matchmaking {
  constructor(io, storage, sessions, options = {}) {
    this.io = io; this.storage = storage; this.sessions = sessions;
    this.config = options.config || config;
    this.now = options.now || (() => performance.timeOrigin + performance.now());
    this.random = options.random || Math.random;
    this.connections = new Map(); this.membership = new Map();
    this.matches = new Map(); this.queue = [];
    this.lastStep = this.now(); this.accumulator = 0;
    // The HTTP session is read by Engine.IO, then identity is copied only from
    // the authenticated session. No client identity fields are trusted.
    io.engine.use(sessions);
    io.use((socket, next) => socket.request.session?.user ? next() : next(new Error('Sign in to connect.')));
    io.on('connection', socket => this.connect(socket));
    this.timer = setInterval(() => this.tick(), this.config.step);
  }
  presence() {
    this.io.emit('lobby:state', { players: [...this.connections].map(([username, socket]) => {
      const game = this.membership.get(username);
      return { ...socket.data.user, status: game ? game.phase === 'finished' ? 'Results' : 'In match' : this.queue.includes(username) ? 'Searching' : 'Available' };
    }), queued: this.queue.slice() });
  }
  connect(socket) {
    const user = socket.request.session.user;
    socket.data.user = user;
    socket.data.sessionId = socket.request.sessionID;
    const old = this.connections.get(user.username);
    // Set the replacement first: the old disconnect can no longer remove it.
    this.connections.set(user.username, socket);
    if (old) { old.emit('session:replaced'); old.disconnect(true); }
    const game = this.membership.get(user.username);
    if (game) {
      game.reconnect(user.username);
      game.sessionIds.set(user.username, socket.data.sessionId);
      socket.join(game.id);
      socket.emit('match:found', { snapshot: game.snapshot(this.now()), resumed: true });
      if (game.result && game.delivered) socket.emit('match:ended', game.delivery);
      if (game.phase === 'finished') this.rematchState(game);
    }
    socket.emit('session:ready', { user });
    this.presence();
    let windowAt = this.now(), packets = 0, controls = 0;
    socket.use(([event], next) => {
      const now = this.now();
      if (now - windowAt >= 1000) { windowAt = now; packets = controls = 0; }
      if (++packets > 70 || (event !== 'match:input' && ++controls > 20)) return;
      // Recheck the live session on each packet: a signed-out socket cannot act.
      this.sessions.store.get(socket.data.sessionId, (error, session) => {
        if (error || !session?.user || session.user.username !== user.username) { socket.emit('session:expired'); socket.disconnect(true); return; }
        if (this.connections.get(user.username) !== socket) return;
        next();
      });
    });
    const withMatch = (payload, action) => {
      const current = this.membership.get(user.username);
      if (current && payload?.matchId === current.id) action(current);
    };
    socket.on('clock:ping', (_, ack) => { if (typeof ack === 'function') ack({ serverTime: this.now() }); });
    socket.on('queue:join', () => {
      if (this.membership.has(user.username) || this.queue.includes(user.username)) return;
      this.queue.push(user.username); this.pair(); this.presence();
    });
    socket.on('queue:leave', () => { this.removeQueue(user.username); this.presence(); });
    socket.on('match:ready', data => withMatch(data, current => {
      const before = current.phase;
      current.setReady(user.username, this.now());
      if (before === 'loading' && current.phase === 'countdown') this.io.to(current.id).emit('match:countdown', current.snapshot(this.now()));
    }));
    socket.on('match:input', data => withMatch(data, current => current.setInput(user.username, data, this.now())));
    socket.on('match:shoot', data => withMatch(data, current => current.shoot(user.username, this.now())));
    socket.on('match:cheat', data => withMatch(data, current => {
      const now = this.now();
      if (now - (socket.data.lastCheat || 0) < 200) return;
      socket.data.lastCheat = now;
      current.toggleCheat(user.username, now);
    }));
    socket.on('match:leave', data => {
      if (!this.membership.has(user.username)) { socket.emit('lobby:return', { message: '' }); return; }
      withMatch(data, current => this.leave(user.username, current, 'leave'));
    });
    socket.on('match:rematch', data => withMatch(data, current => {
      if (current.phase !== 'finished' || !current.delivered || current.departed.size || current.players.some(p => !this.connections.has(p.username))) return;
      current.rematch.add(user.username); this.rematchState(current);
      if (current.rematch.size === 2) {
        const users = current.players.map(p => this.storage.publicUser(p));
        this.dispose(current);
        this.create(users);
      }
    }));
    socket.on('disconnect', () => {
      if (this.connections.get(user.username) !== socket) return;
      this.connections.delete(user.username); this.removeQueue(user.username);
      const current = this.membership.get(user.username);
      if (current) {
        current.disconnect(user.username, this.now());
        current.rematch.delete(user.username);
        if (['loading', 'countdown'].includes(current.phase)) this.cancel(current, 'Opponent disconnected before the start. Find another match.');
        else if (current.phase === 'finished') this.rematchState(current);
      }
      this.presence();
    });
  }
  removeQueue(username) { this.queue = this.queue.filter(u => u !== username); }
  pair() {
    this.queue = this.queue.filter(u => this.connections.has(u) && !this.membership.has(u));
    while (this.queue.length >= 2) {
      const users = this.queue.splice(0, 2).map(u => this.connections.get(u).data.user);
      this.create(users);
    }
  }
  create(users) {
    const game = new Game(users, this.now(), { config: this.config, random: this.random });
    // Remember the controlling session during a dropped transport so an HTTP
    // sign-out still forfeits immediately. Never include session IDs in snapshots.
    game.sessionIds = new Map(users.map(u => [u.username, this.connections.get(u.username).data.sessionId]));
    this.matches.set(game.id, game);
    for (const user of users) {
      this.membership.set(user.username, game);
      this.connections.get(user.username).join(game.id);
    }
    this.io.to(game.id).emit('match:found', { snapshot: game.snapshot(this.now()), resumed: false });
    this.presence();
    return game;
  }
  rematchState(game) {
    this.io.to(game.id).emit('match:rematch-state', { matchId: game.id,
      available: !game.departed.size && game.players.every(p => this.connections.has(p.username)),
      ready: [...game.rematch] });
  }
  detach(username, game) {
    if (this.membership.get(username) === game) this.membership.delete(username);
    this.connections.get(username)?.leave(game.id);
    game.departed.add(username); game.rematch.delete(username);
    this.rematchState(game);
    this.presence();
  }
  leave(username, game, reason) {
    if (['loading', 'countdown'].includes(game.phase)) { this.cancel(game, 'Match cancelled before the start.'); return; }
    if (game.phase === 'playing') {
      const opponent = game.players.find(p => p.username !== username);
      if (!this.connections.has(opponent.username)) this.cancel(game, 'Both players left. Match cancelled without ranking changes.');
      else {
        game.finish(reason, this.now(), opponent.username); this.finalize(game);
        if (reason === 'leave') return; // Both connected players receive the forfeit result.
      }
    }
    this.detach(username, game);
    this.connections.get(username)?.emit('lobby:return', { message: game.phase === 'finished' && reason !== 'home' ? 'Returned to the lobby.' : '' });
  }
  signout(sessionId) {
    for (const [username, game] of this.membership) {
      if (!this.connections.has(username) && game.sessionIds.get(username) === sessionId) this.leave(username, game, 'signout');
    }
    for (const [username, socket] of this.connections) {
      if (socket.data.sessionId !== sessionId) continue;
      const game = this.membership.get(username);
      if (game) this.leave(username, game, 'signout');
      this.removeQueue(username);
      socket.emit('session:expired'); socket.disconnect(true);
    }
  }
  cancel(game, message) {
    if (game.phase === 'cancelled' || game.phase === 'finished') return;
    game.phase = 'cancelled';
    game.clearEffects();
    this.io.to(game.id).emit('match:cancelled', { matchId: game.id, message });
    this.dispose(game); this.presence();
  }
  dispose(game) {
    for (const player of game.players) {
      if (this.membership.get(player.username) === game) this.membership.delete(player.username);
      this.connections.get(player.username)?.leave(game.id);
    }
    this.matches.delete(game.id);
  }
  finalize(game) {
    if (game.phase !== 'finished' || game.finalizing) return;
    // State becomes terminal synchronously. Only one save is scheduled even if
    // leave, a target pickup and the deadline occur in the same event-loop turn.
    game.finalizing = true;
    game.savePromise = this.storage.record(game.result).then(() => null, error => {
      console.error('Result persistence failed:', error.message);
      return 'The match ended, but the leaderboard could not be saved. Check server disk access.';
    }).then(error => {
      game.delivered = true;
      game.delivery = { ...game.result, leaderboard: this.storage.top(), ranks: this.storage.ranks(game.players.map(p => p.username)), rankedPlayers: this.storage.total(), persistenceError: error };
      this.io.to(game.id).emit('match:ended', game.delivery);
      this.rematchState(game); this.presence();
    });
  }
  tick() {
    const now = this.now();
    this.accumulator = Math.min(this.accumulator + now - this.lastStep, this.config.step * 5);
    this.lastStep = now;
    let steps = 0;
    while (this.accumulator >= this.config.step - .001) { this.accumulator -= this.config.step; steps++; }
    for (const game of [...this.matches.values()]) {
      if (game.phase === 'loading' && now - game.createdAt >= this.config.loadTimeout) {
        this.cancel(game, 'Loading timed out. Check assets and connection, then try again.'); continue;
      }
      if (game.phase === 'finished') {
        if (now - game.finishedAt >= this.config.resultRetention && game.delivered) {
          this.io.to(game.id).emit('match:rematch-state', { matchId: game.id, available: false, ready: [] });
          this.dispose(game); this.presence();
        }
        continue;
      }
      if (game.phase === 'playing') {
        const absent = game.players.filter(p => !p.connected);
        if (absent.length === 2 && (now >= game.endAt || absent.every(p => now - p.disconnectedAt >= this.config.grace))) {
          this.cancel(game, 'Both players disconnected. Match cancelled without ranking changes.'); continue;
        }
        if (absent.length === 1 && now - absent[0].disconnectedAt >= this.config.grace) {
          game.finish('disconnect', now, game.players.find(p => p.connected).username);
        }
      }
      for (let n = 0; n < steps; n++) game.step(now, this.config.step / 1000);
      for (const event of game.events.splice(0)) this.io.to(game.id).emit('match:event', event);
      this.io.to(game.id).emit('match:snapshot', game.snapshot(now));
      if (game.phase === 'finished') this.finalize(game);
    }
  }
  async close() {
    clearInterval(this.timer);
    await Promise.all([...this.matches.values()].map(g => g.savePromise));
  }
}
module.exports = { Matchmaking };
