/* global $, io, ArenaRenderer, GameAudio */
// Page sections, jQuery handlers and fetch authentication adapt game_room.js;
// socket event -> UI updates adapt hand_game.js. Handlers are installed once.
$(function() {
  const renderer = ArenaRenderer(document.querySelector('#arena'));
  const avatarNames = ['fox', 'cat', 'frog', 'owl', 'bunny', 'bear', 'panda', 'penguin'];
  let user = null, socket = null, match = null, result = null;
  let assetsReady = false, clockOffset = 0, bestRtt = Infinity, clockSamples = 0;
  let queued = false, connected = false, superseded = false;
  const keys = new Set(), seenEvents = new Set();
  const rules = document.querySelector('#rules-template').content;
  document.querySelector('#home-rules').append(rules.cloneNode(true));
  document.querySelector('#dialog-rules').append(rules.cloneNode(true));
  for (const avatar of avatarNames) {
    const label = $('<label>').attr('title', avatar);
    $('<input>').attr({ type: 'radio', name: 'avatar', value: avatar, 'aria-label': avatar }).prop('checked', avatar === 'fox').appendTo(label);
    $('<img>').attr({ src: `/assets/avatar-${avatar}.svg`, alt: avatar }).appendTo(label);
    $('<span>').text(avatar).appendTo(label);
    $('#avatar-options').append(label);
  }
  const notice = message => $('#notice').text(message).prop('hidden', !message);
  const showView = id => {
    $('#home-view,#game-view,#results-view').prop('hidden', true);
    $(id).prop('hidden', false);
  };
  const now = () => Date.now() + clockOffset;
  const api = async (path, data) => {
    let response;
    try { response = await fetch(path, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }); }
    catch { throw new Error('Connection failed. Check that the game server is running.'); }
    const body = await response.json();
    if (!response.ok || body.error) throw new Error(body.error || 'The request failed. Please try again.');
    return body;
  };
  function authTab(register) {
    $('#signin-form').prop('hidden', register); $('#register-form').prop('hidden', !register);
    $('#signin-tab').attr('aria-selected', String(!register)); $('#register-tab').attr('aria-selected', String(register));
    $('#auth-message').text('');
  }
  $('#signin-tab').on('click', () => authTab(false)); $('#register-tab').on('click', () => authTab(true));
  $('#rules-button').on('click', () => document.querySelector('#rules-dialog').showModal());
  $('#close-rules').on('click', () => document.querySelector('#rules-dialog').close());
  const muteLabel = () => $('#mute-button').text(GameAudio.isMuted() ? 'Sound off' : 'Sound on').attr('aria-pressed', String(GameAudio.isMuted()));
  muteLabel();
  $('#mute-button').on('click', () => { GameAudio.unlock(); GameAudio.toggle(); muteLabel(); if (match?.phase === 'playing') GameAudio.play('background'); });
  GameAudio.onFailure(() => notice('A sound could not load. You can keep playing; reload to retry audio.'));
  renderer.ready.then(() => { assetsReady = true; updateQueue(); }).catch(error => notice(error.message));

  $('#register-form').on('submit', async function(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(this));
    if (!data.name.trim()) { $('#auth-message').text('Enter a display name.'); return; }
    if (data.password !== data.confirmPassword) { $('#auth-message').text('Passwords do not match.'); return; }
    const button = $(this).find('button').prop('disabled', true);
    $('#auth-message').text('Creating your account…');
    try { await api('/register', data); this.reset(); authTab(false); $('#signin-username').val(data.username); $('#auth-message').text('Account created. Sign in to enter the glade.'); $('#signin-password').trigger('focus'); }
    catch (error) { $('#auth-message').text(error.message); }
    finally { button.prop('disabled', false); }
  });
  $('#signin-form').on('submit', async function(event) {
    event.preventDefault();
    const button = $(this).find('button').prop('disabled', true);
    $('#auth-message').text('Signing in…');
    try { const body = await api('/signin', Object.fromEntries(new FormData(this))); this.reset(); login(body.user); }
    catch (error) { $('#auth-message').text(error.message); }
    finally { button.prop('disabled', false); }
  });
  $('#signout-button').on('click', async function() {
    $(this).prop('disabled', true);
    try { await api('/signout', {}); logout('Signed out.'); }
    catch (error) { notice(error.message); }
    finally { $(this).prop('disabled', false); }
  });
  function login(identity) {
    user = identity; superseded = false; notice('');
    $('#auth-panel').prop('hidden', true); $('#lobby-panel,#signout-button').prop('hidden', false);
    $('#my-name').text(user.name); $('#my-avatar').attr('src', `/assets/avatar-${user.avatar}.svg`);
    showView('#home-view'); connect(); loadLobbyBoard();
  }
  function logout(message) {
    release(); GameAudio.stop();
    connected = false; user = null; match = null; result = null; queued = false;
    socket?.disconnect(); socket = null; notice('');
    renderer.reset(); showView('#home-view');
    $('#auth-panel').prop('hidden', false); $('#lobby-panel,#signout-button').prop('hidden', true); authTab(false);
    $('#auth-message').text(message);
  }
  function updateQueue() {
    $('#find-button').prop('hidden', queued).prop('disabled', !connected || !assetsReady || superseded);
    $('#cancel-button').prop('hidden', !queued).prop('disabled', !connected);
    $('#queue-status').text(superseded ? 'This account is controlled by another tab. Sign in again to take over.' : !connected ? 'Connecting to the game server…' : !assetsReady ? 'Loading game assets…' : queued ? 'Searching… waiting for another player.' : 'Ready when you are. Find your next rival.');
  }
  function synchronizeClock() {
    if (!socket?.connected) return;
    const sent = Date.now();
    socket.timeout(4000).emit('clock:ping', {}, (error, reply) => {
      if (error || !reply) return;
      const received = Date.now(), rtt = received - sent;
      // Minimum RTT reduces asymmetric-delay bias; reset periodically.
      if (++clockSamples % 30 === 0) bestRtt = Infinity;
      if (rtt <= bestRtt) { bestRtt = rtt; clockOffset = reply.serverTime - (sent + received) / 2; }
    });
  }
  function connect() {
    socket?.disconnect();
    connected = false; updateQueue(); bestRtt = Infinity;
    socket = io({ autoConnect: false });
    socket.on('connect', () => { connected = true; notice(''); synchronizeClock(); updateQueue(); });
    socket.on('connect_error', error => {
      connected = false; updateQueue();
      if (error.message === 'Sign in to connect.') { logout('Your session ended or the server restarted. Sign in again.'); return; }
      notice(`Connection error: ${error.message} Reconnecting automatically.`);
    });
    socket.on('disconnect', () => { connected = false; release(); updateQueue(); $('#connection-status').text('Reconnecting…'); if (!superseded && user) notice('Connection lost. Reconnecting… active matches allow 10 seconds to return.'); });
    socket.on('session:replaced', () => {
      superseded = true; release(); GameAudio.stop(); match = null; result = null; renderer.reset(); showView('#home-view');
      notice('Another tab took control of this account. Close it or sign in here again.');
      // Show sign-in so the old tab can intentionally establish a new session.
      $('#auth-panel').prop('hidden', false); $('#lobby-panel').prop('hidden', true); updateQueue();
    });
    socket.on('session:expired', () => logout('Your session ended. Sign in again.'));
    socket.on('lobby:state', state => {
      if (!user) return;
      queued = state.queued.includes(user.username); updateQueue();
      $('#online-count').text(`${state.players.length} online`); const list = $('#online-players').empty();
      for (const player of state.players) {
        const row = $('<li>');
        $('<img>').attr({ src: `/assets/avatar-${player.avatar}.svg`, alt: '' }).appendTo(row);
        $('<span>').addClass('name').text(player.name + (player.username === user.username ? ' (you)' : '')).appendTo(row);
        $('<span>').addClass('status').text(player.status).appendTo(row); list.append(row);
      }
    });
    socket.on('match:found', async data => {
      release(); GameAudio.stop(); match = data.snapshot; result = null; queued = false;
      seenEvents.clear(); renderer.reset(); renderer.snapshot(match); showView('#game-view'); notice('');
      if (bestRtt === Infinity) clockOffset = match.serverTime - Date.now();
      const opponent = match.players.find(p => p.username !== user.username);
      $('#overlay-detail').text(`Matched with ${opponent.name}`); $('#countdown').text(''); lastCount = null;
      const vs = $('#vs-row').empty();
      match.players.forEach((p, i) => {
        if (i === 1) $('<span>').addClass('vs-word').text('VS').appendTo(vs);
        const side = $('<div>').addClass(`vs-side ${i === 0 ? 'mint' : 'peach'}`);
        // Show the animated character itself (alt colours when both picked the same one).
        const same = match.players[0].avatar === match.players[1].avatar;
        $('<span>').addClass('vs-char').attr('role', 'img').attr('aria-label', p.avatar)
          .css('background-image', `url(/assets/characters/char-${p.avatar}${same && i === 1 ? '-alt' : ''}.png)`).appendTo(side);
        $('<b>').text(p.name + (p.username === user.username ? ' (you)' : '')).appendTo(side);
        $('<small>').text(`${p.avatar}${same && i === 1 ? ' · alt colours' : ''}`).appendTo(side);
        vs.append(side);
      });
      $('#arena-overlay').prop('hidden', false); $('#match-message').text('Loading the arena for both players…');
      buildScoreboard();
      const id = match.matchId;
      try { await renderer.ready; if (match?.matchId === id && match.phase === 'loading') socket.emit('match:ready', { matchId: id }); }
      catch (error) { notice(error.message); }
    });
    socket.on('match:countdown', acceptSnapshot);
    socket.on('match:snapshot', acceptSnapshot);
    socket.on('match:event', event => {
      if (event.matchId !== match?.matchId || seenEvents.has(event.id)) return;
      seenEvents.add(event.id); renderer.event(event);
      const mine = event.username === user?.username;
      if (event.type === 'collect') GameAudio.play('collect', mine ? 1 : .45);
      else if (event.type === 'fire') GameAudio.play('fire', mine ? 1 : .45);
      else if (event.type === 'power') GameAudio.play(event.kind === 'ice' && !event.blocked ? 'freeze' : 'power', .9);
      else if (event.type === 'cheat' && mine) GameAudio.play('cheat', .8);
      else if (event.type === 'wave') GameAudio.play('fire', .35);
      else if (event.type === 'frenzy') GameAudio.play('go', .8);
    });
    socket.on('match:ended', end => {
      if (end.matchId !== match?.matchId || result?.matchId === end.matchId) return;
      release(); match.phase = 'finished'; result = end; GameAudio.stop();
      GameAudio.play(end.players.find(p => p.username === user.username)?.outcome === 'win' ? 'win' : 'gameover');
      renderResults(end); showView('#results-view'); window.scrollTo(0, 0);
    });
    socket.on('match:rematch-state', state => {
      if (state.matchId !== match?.matchId) return;
      const ready = state.ready.includes(user.username);
      $('#rematch-button').prop('disabled', ready || !state.available).text(ready ? 'Ready for rematch' : 'Play again');
      $('#rematch-status').text(!state.available ? 'Rematch unavailable. Your opponent left, disconnected, or the two-minute rematch window expired.' : ready ? 'Waiting for opponent.' : 'Want another round? Both players need to be ready.');
      $('#rematch-readiness').text(match.players.map(p => `${p.name}: ${state.ready.includes(p.username) ? 'ready' : 'not ready'}`).join(' · '));
    });
    socket.on('match:cancelled', data => { if (data.matchId === match?.matchId) home(data.message); });
    socket.on('lobby:return', data => home(data.message));
    socket.connect();
  }
  function home(message = '') {
    release(); GameAudio.stop(); match = null; result = null; renderer.reset(); seenEvents.clear();
    showView('#home-view'); notice(message); updateQueue(); window.scrollTo(0, 0); loadLobbyBoard();
  }
  // Leaderboard shown in the lobby, so players can see the ranking before a match.
  function renderBoard(target, board, limit = 10) {
    const list = $(target).empty();
    board.slice(0, limit).forEach(p => {
      const row = $('<li>').toggleClass('me', !!user && p.username === user.username).append($('<img>').attr({ src: `/assets/avatar-${p.avatar}.svg`, alt: '' }));
      row.append($('<span>').addClass('leader-name').text(p.name + (user && p.username === user.username ? ' (you)' : '')));
      row.append($('<span>').addClass('leader-score').text(p.bestScore).append($('<small>').text(`${p.wins} ${p.wins === 1 ? 'win' : 'wins'} · ${p.games || 0} played`)));
      list.append(row);
    });
    if (!board.length) list.append($('<p>').addClass('muted').text('No saved results yet. Be the first on the board!'));
  }
  function loadLobbyBoard() { api('/leaderboard').then(body => renderBoard('#lobby-leaderboard', body.leaderboard, 5)).catch(() => {}); }
  function acceptSnapshot(snapshot) {
    if (!match || snapshot.matchId !== match.matchId || snapshot.tick < match.tick || result) return;
    match = snapshot; renderer.snapshot(snapshot);
  }
  function buildScoreboard() {
    match.players.forEach((p, index) => {
      const root = $(index === 0 ? '#player-zero' : '#player-one').empty();
      const line = $('<div>').addClass('score-line');
      $('<img>').attr({ src: `/assets/avatar-${p.avatar}.svg`, alt: p.avatar }).appendTo(line);
      const name = $('<div>').addClass('name').text(p.name);
      $('<span>').addClass('you-label').text(p.username === user.username ? 'YOU' : 'RIVAL').appendTo(name); name.appendTo(line);
      $('<span>').addClass('score-number').text('0').appendTo(line); root.append(line);
      $('<div>').addClass('effects').appendTo(root); $('<div>').addClass('score-track').append($('<div>').addClass('score-fill')).appendTo(root);
    });
  }
  function updateHud(time) {
    if (!match || result) return;
    $('#match-phase').text(` / ${match.phase.toUpperCase()}`);
    match.players.forEach((p, index) => {
      const root = $(index === 0 ? '#player-zero' : '#player-one');
      root.find('.score-number').text(p.score); root.find('.score-fill').css('width', `${Math.min(100, p.score / 50 * 100)}%`);
      const effects = [];
      if (p.cheat) effects.push('CHEAT MODE ON');
      for (const [field, label] of [['bootsUntil', 'Boots'], ['stunUntil', 'Stun'], ['freezeUntil', 'Freeze']]) if (p[field] > time) effects.push(`${label} ${((p[field] - time) / 1000).toFixed(1)}s`);
      root.find('.effects').text(effects.join(' · ') || 'Ready to rush');
    });
    const seconds = match.endAt ? Math.max(0, Math.min(120, Math.ceil((match.endAt - time) / 1000))) : 120;
    $('#game-time').text(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`).toggleClass('low', match.phase === 'playing' && seconds <= 10);
    const local = match.players.find(p => p.username === user.username);
    $('#cheat-banner').prop('hidden', !(local?.cheat && match.phase === 'playing'));
    // Countdown beeps (3, 2, 1), a GO sound, and a tick each second in the last 10 s.
    const count = match.phase === 'countdown' ? Math.max(1, Math.ceil((match.startAt - time) / 1000)) : match.phase === 'playing' ? (seconds <= 10 ? `t${seconds}` : 'go') : null;
    if (count !== lastCount) {
      if (typeof count === 'number') GameAudio.play('countdown', .7);
      else if (count === 'go' && typeof lastCount === 'number') GameAudio.play('go', .7);
      else if (typeof count === 'string' && count.startsWith('t') && seconds > 0) GameAudio.play('countdown', .35);
      lastCount = count;
    }
    $('#connection-status').text(connected ? 'Connected · live duel' : 'Reconnecting…');
    $('#game-status').text(match.phase === 'playing' ? 'Race to the finish' : match.phase === 'finished' ? 'Saving results…' : match.phase === 'loading' ? 'Loading both players…' : 'Get ready');
    const pending = match.phase === 'loading' || match.phase === 'countdown';
    $('#arena-overlay').prop('hidden', !pending);
    $('#countdown').text(match.phase === 'countdown' ? Math.max(1, Math.ceil((match.startAt - time) / 1000)) : '');
    const absent = match.players.filter(p => !p.connected);
    $('#match-message').text(absent.length ? absent.map(p => `${p.name} disconnected — waiting ${Math.max(0, Math.ceil((p.disconnectedAt + 10000 - time) / 1000))}s for reconnection.`).join(' ') : pending ? 'Both players start together. Get your fingers ready.' : match.phase === 'finished' ? 'Match complete. Saving the final score…' : '');
    if (match.phase === 'playing') GameAudio.play('background');
  }
  function renderResults(end) {
    const local = end.players.find(p => p.username === user.username);
    $('#result-title').text(local.outcome === 'win' ? 'You win!' : local.outcome === 'loss' ? 'Good duel.' : "It's a draw!");
    const winner = end.players.find(p => p.username === end.winner);
    const loser = end.players.find(p => p.username !== end.winner);
    const reason = end.reason === 'target' ? `${winner.name} reached 50 points.` : end.reason === 'time' ? `Time is up. ${winner ? `${winner.name} has the higher score.` : 'Equal scores, shared glory.'}` : `${loser.name} ${end.reason === 'disconnect' ? 'did not reconnect within 10 seconds' : end.reason === 'signout' ? 'signed out' : 'left the match'}. ${winner.name} wins by forfeit.`;
    $('#result-reason').text(`${local.outcome === 'loss' ? 'You lost this round. ' : ''}${reason}`);
    const ranking = [...end.players].sort((a, b) => a.username === end.winner ? -1 : b.username === end.winner ? 1 : 0);
    const holder = $('#match-ranking').empty();
    ranking.forEach((p, i) => {
      const row = $('<div>').addClass('ranking-row'); $('<span>').addClass('rank').text(end.winner === null ? '=1' : i + 1).appendTo(row);
      $('<img>').attr({ src: `/assets/avatar-${p.avatar}.svg`, alt: '' }).appendTo(row);
      const name = $('<div>').addClass('ranking-name').text(p.name + (p.username === user.username ? ' (you)' : ''));
      $('<small>').text(`${p.outcome.toUpperCase()} · ${p.stats.usedCheat ? 'Cheat used' : 'No cheat used'}`).appendTo(name); row.append(name);
      $('<span>').addClass('ranking-score').text(p.score).appendTo(row); holder.append(row);
    });
    const head = $('<tr>').append($('<th>').text('Match statistics'));
    end.players.forEach(p => head.append($('<th>').text(p.name))); $('#stats-head').empty().append(head);
    // [label, value, which is better: 1 = higher, -1 = lower, 0 = no highlight]
    const stats = [['Final score', p => p.score, 1], ['Green gems · 1 pt', p => p.stats.green, 1], ['Red gems · 2 pts', p => p.stats.red, 1], ['Yellow gems · 3 pts', p => p.stats.yellow, 1], ['Purple gems · 5 pts', p => p.stats.purple, 1], ['Total gems', p => p.stats.gems, 1], ['Best gem streak', p => p.stats.bestStreak ?? 0, 1], ['Speed Boots', p => p.stats.boots, 1], ['Ice Crystals', p => p.stats.ice, 1], ['Total power-ups', p => p.stats.powers, 1], ['Rivals frozen', p => p.stats.freezesLanded ?? 0, 1], ['Fire hits', p => p.stats.fireHits, -1], ['Points lost to fire', p => p.stats.pointsLost ?? 0, -1], ['Times frozen', p => p.stats.frozen, -1], ['Distance run (px)', p => p.stats.distance ?? 0, 0], ['Cheat used', p => p.stats.usedCheat ? 'Yes' : 'No', 0], ['Result', p => p.outcome, 0]];
    const body = $('#stats-body').empty();
    stats.forEach(([label, value, better]) => {
      const row = $('<tr>').append($('<td>').text(label));
      const values = end.players.map(value);
      values.forEach((v, i) => {
        const other = values[1 - i];
        const best = !!better && typeof v === 'number' && v !== other && (better > 0 ? v > other : v < other);
        row.append($('<td>').toggleClass('better', best).text(v));
      });
      body.append(row);
    });
    renderBoard('#leaderboard', end.leaderboard);
    const myRank = end.ranks?.[user.username];
    $('#my-rank').text(myRank ? `Your all-time rank: #${myRank} of ${end.rankedPlayers} players` : '');
    $('#save-message').text(end.persistenceError || 'Results saved. Gem counts are pickups, before any cheat multiplier.');
    $('#rematch-button').prop('disabled', false).text('Play again');
  }
  const emitMatch = event => { if (match && socket?.connected) socket.emit(event, { matchId: match.matchId }); };
  $('#find-button').on('click', () => { GameAudio.unlock(); $('#queue-status').text('Joining the matchmaking queue…'); socket?.emit('queue:join'); });
  $('#cancel-button').on('click', () => socket?.emit('queue:leave'));
  $('#leave-button').on('click', () => { release(); emitMatch('match:leave'); });
  $('#home-button').on('click', () => { if (connected) emitMatch('match:leave'); else home('Connection lost. Reconnect or sign in to find another match.'); });
  $('#rematch-button').on('click', () => { GameAudio.unlock(); emitMatch('match:rematch'); });
  function sendInput() {
    if (!socket?.connected || match?.phase !== 'playing') return;
    const x = Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft'));
    const y = Number(keys.has('s') || keys.has('arrowdown')) - Number(keys.has('w') || keys.has('arrowup'));
    socket.emit('match:input', { matchId: match.matchId, x, y });
  }
  function release() { keys.clear(); sendInput(); }
  const movementKeys = ['w', 'a', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright'];
  $(document).on('keydown', event => {
    if ($(event.target).is('input,textarea,select,[contenteditable]') || document.querySelector('#rules-dialog').open || match?.phase !== 'playing') return;
    const key = event.key.toLowerCase();
    if (movementKeys.includes(key)) { event.preventDefault(); if (!keys.has(key)) { keys.add(key); sendInput(); } }
    if (key === 'c' && !event.repeat) { event.preventDefault(); GameAudio.unlock(); emitMatch('match:cheat'); }
  }).on('keyup', event => { if (keys.delete(event.key.toLowerCase())) sendInput(); });
  $(window).on('blur', release);
  document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
  document.querySelector('#rules-dialog').addEventListener('toggle', release);
  setInterval(sendInput, 200); setInterval(synchronizeClock, 5000);
  let lastHud = 0, lastCount = null;
  function frame() {
    const time = now();
    if (match && !result) { renderer.draw(time, user?.username); if (time - lastHud >= 80) { updateHud(time); lastHud = time; } }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  api('/validate').then(body => { if (body.user) login(body.user); }).catch(error => notice(error.message));
});
