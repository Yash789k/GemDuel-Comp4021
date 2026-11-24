'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { io } = require('socket.io-client');
const argon2 = require('argon2');
const { createGameServer } = require('../game_server');
const { openStorage } = require('../server/storage');
const defaults = require('../server/config');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = predicate(); if (value) return value; await delay(15); }
  throw new Error('Condition timed out');
}
async function fixture(t, overrides = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gemrush-test-'));
  const server = await createGameServer({ dataDir, config: { ...defaults, countdown: 60, grace: 250, loadTimeout: 400, duration: 30000, resultRetention: 3000, ...overrides } });
  const address = await server.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${address.port}`, sockets = [];
  t.after(async () => { sockets.forEach(s => s.disconnect()); await server.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  async function request(route, body, cookie) {
    const res = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, body: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0], headers: res.headers };
  }
  async function account(username) {
    const details = { username, name: username, avatar: 'fox', password: 'password123', confirmPassword: 'password123' };
    assert.equal((await request('/register', details)).status, 201);
    const signed = await request('/signin', details); assert.equal(signed.status, 200);
    return { username: username.toLowerCase(), cookie: signed.cookie };
  }
  async function connect(account, ready = true) {
    const s = io(base, { extraHeaders: { Cookie: account.cookie }, transports: ['websocket'], autoConnect: false, reconnection: false });
    s.events = []; s.onAny((event, data) => s.events.push({ event, data }));
    s.on('match:found', data => { s.match = data.snapshot; if (ready && s.match.phase === 'loading') s.emit('match:ready', { matchId: s.match.matchId }); });
    s.on('match:snapshot', data => { s.snapshot = data; });
    s.on('match:ended', data => { s.result = data; });
    s.connect(); sockets.push(s);
    await until(() => s.connected && s.events.some(e => e.event === 'session:ready'));
    return s;
  }
  async function pair(a, b) {
    a.emit('queue:join'); b.emit('queue:join');
    await until(() => a.snapshot?.phase === 'playing' && b.snapshot?.phase === 'playing');
    return server.manager.matches.get(a.snapshot.matchId);
  }
  return { server, base, request, account, connect, pair, dataDir, sockets };
}

test('registration validation, concurrent canonical uniqueness, Argon2, session cookies and private storage', async t => {
  const f = await fixture(t);
  const valid = { username: 'Player', name: '  A player  ', avatar: 'frog', password: '  literal pass  ', confirmPassword: '  literal pass  ' };
  for (const change of [{ username: 'a!' }, { username: '' }, { name: ' ' }, { name: 'x'.repeat(25) }, { avatar: '__proto__' }, { password: 'short' }, { password: 'x'.repeat(129) }, { confirmPassword: 'different' }]) assert.equal((await f.request('/register', { ...valid, ...change })).status, 400);
  const attempts = await Promise.all([f.request('/register', valid), f.request('/register', { ...valid, username: 'PLAYER' })]);
  assert.deepEqual(attempts.map(r => r.status).sort(), [201, 409]);
  const saved = f.server.storage.find('player'); assert.equal(saved.name, 'A player'); assert.match(saved.passwordHash, /^\$argon2id\$/); assert.equal(await argon2.verify(saved.passwordHash, valid.password), true);
  assert.equal((await f.request('/signin', { username: 'player', password: 'literal pass' })).status, 401);
  const signin = await f.request('/signin', { username: 'PLAYER', password: valid.password });
  assert.equal(signin.status, 200); assert.match(signin.headers.get('set-cookie'), /HttpOnly/); assert.match(signin.headers.get('set-cookie'), /SameSite=Lax/);
  assert.equal(JSON.stringify(signin.body).includes('password'), false);
  assert.deepEqual((await f.request('/validate', undefined, signin.cookie)).body.user, signin.body.user);
  const signedAgain = await f.request('/signin', { username: 'player', password: valid.password }, signin.cookie);
  assert.notEqual(signedAgain.cookie, signin.cookie);
  assert.equal((await f.request('/validate', undefined, signin.cookie)).body.user, null);
  const unusual = await f.account('__proto__'); const s = await f.connect(unusual); assert.equal(s.connected, true);
  assert.equal((await fetch(f.base + '/data/accounts.json')).status, 404);
  assert.equal((await fetch(f.base + '/server/game.js')).status, 404);
  const noAuth = io(f.base, { transports: ['websocket'], reconnection: false }); f.sockets.push(noAuth);
  await new Promise(resolve => noAuth.on('connect_error', error => { assert.match(error.message, /Sign in/); resolve(); }));
});

test('four users form isolated two-player rooms; queue cancellation and duplicate joins are safe', async t => {
  const f = await fixture(t);
  const accounts = await Promise.all(['one', 'two', 'three', 'four'].map(f.account));
  const [a, b, c, d] = await Promise.all(accounts.map(x => f.connect(x)));
  a.emit('queue:join'); a.emit('queue:join'); await until(() => f.server.manager.queue.length === 1);
  a.emit('queue:leave'); await until(() => f.server.manager.queue.length === 0);
  const first = await f.pair(a, b); const second = await f.pair(c, d);
  assert.notEqual(first.id, second.id); assert.equal(first.players.length, 2);
  a.emit('queue:join'); await delay(80); assert.equal(f.server.manager.queue.length, 0);
  assert.ok(a.events.filter(e => e.event.startsWith('match:') && e.data?.matchId).every(e => e.data.matchId === first.id));
  assert.ok(c.events.filter(e => e.event.startsWith('match:') && e.data?.matchId).every(e => e.data.matchId === second.id));
  const before = first.players[0].x;
  a.emit('match:input', { matchId: second.id, x: 1, y: 0, username: 'three', score: 999 });
  a.emit('match:input', { matchId: first.id, x: 5000, y: 0 }); await delay(100); assert.equal(first.players[0].x, before);
  a.emit('match:input', { matchId: first.id, x: 1, y: 0 }); await until(() => b.snapshot.players[0].x > before);
  assert.equal(second.players[0].x, 210);
  assert.deepEqual(a.snapshot.gems.map(g => g.id), b.snapshot.gems.map(g => g.id));
  assert.equal(a.snapshot.startAt, b.snapshot.startAt); assert.equal(a.snapshot.endAt, b.snapshot.endAt);
  a.emit('match:cheat', { matchId: first.id }); await until(() => b.snapshot.players[0].cheat);
  assert.equal(second.players[0].cheat, false);
  for (let i = 0; i < 100; i++) a.emit('match:input', { matchId: first.id, x: {}, y: 0 });
  await delay(70); assert.equal(f.server.httpServer.listening, true);
});

test('newest tab takes control without self-matching or old disconnect removing the new socket', async t => {
  const f = await fixture(t); const user = await f.account('duplicate');
  const old = await f.connect(user); old.emit('queue:join'); await until(() => f.server.manager.queue.length === 1);
  const replacement = await f.connect(user); await until(() => !old.connected);
  assert.ok(old.events.some(e => e.event === 'session:replaced'));
  replacement.emit('queue:join'); await delay(100);
  assert.deepEqual(f.server.manager.queue, ['duplicate']); assert.equal(f.server.manager.matches.size, 0);
  assert.equal(f.server.manager.connections.get('duplicate').id, replacement.id);
  replacement.disconnect(); await until(() => f.server.manager.queue.length === 0);
});

test('reload/reconnect keeps identity and match; expiry forfeits once; rematch has clean state', async t => {
  const f = await fixture(t, { grace: 500, initialGems: 0, fireCount: 0 });
  const aa = await f.account('alice'), bb = await f.account('bobby');
  let a = await f.connect(aa); const b = await f.connect(bb); const g = await f.pair(a, b);
  a.emit('match:input', { matchId: g.id, x: 1, y: 0 }); await delay(60); a.disconnect();
  await until(() => !g.player('alice').connected); assert.deepEqual(g.player('alice').input, { x: 0, y: 0 });
  a = await f.connect(aa); await until(() => a.match?.matchId === g.id); assert.equal(g.player('alice').connected, true);
  assert.equal(a.match.endAt, g.endAt);
  a.emit('match:cheat', { matchId: g.id }); await until(() => g.player('alice').cheat);
  a.emit('match:leave', { matchId: g.id }); await until(() => a.result && b.result);
  assert.equal(a.result.winner, 'bobby'); assert.deepEqual(a.result, b.result);
  g.finish('time', Date.now()); f.server.manager.finalize(g); await delay(60);
  assert.equal(f.server.storage.top().find(p => p.username === 'bobby').wins, 1);
  a.emit('match:rematch', { matchId: g.id }); await until(() => g.rematch.size === 1); assert.equal(f.server.manager.matches.size, 1);
  b.emit('match:rematch', { matchId: g.id });
  await until(() => a.match.matchId !== g.id && a.snapshot?.phase === 'playing' && a.snapshot.matchId !== g.id);
  assert.equal(a.match.matchId, b.match.matchId); assert.equal(f.server.manager.matches.size, 1);
  const fresh = f.server.manager.matches.get(a.match.matchId);
  assert.equal(fresh.player('alice').cheat, false); assert.equal(fresh.player('alice').stats.usedCheat, false); assert.equal(fresh.player('alice').score, 0);
  a.result = b.result = null; a.disconnect(); await until(() => b.result, 3000);
  assert.equal(b.result.reason, 'disconnect'); assert.equal(f.server.storage.top().find(p => p.username === 'bobby').wins, 2);
});

test('signout revokes already-connected socket and causes immediate forfeit', async t => {
  const f = await fixture(t); const aa = await f.account('signedout'), bb = await f.account('stays');
  const a = await f.connect(aa), b = await f.connect(bb); const g = await f.pair(a, b);
  await f.request('/signout', {}, aa.cookie); await until(() => !a.connected && b.result);
  assert.equal(b.result.reason, 'signout'); assert.equal(b.result.winner, 'stays');
  assert.equal((await f.request('/validate', undefined, aa.cookie)).body.user, null);
  a.emit('match:cheat', { matchId: g.id }); assert.equal(g.player('signedout').cheat, false);
});

test('both-player abandonment cancels without ranking updates', async t => {
  const f = await fixture(t); const a = await f.connect(await f.account('goneone')), b = await f.connect(await f.account('gonetwo'));
  await f.pair(a, b); a.disconnect(); b.disconnect();
  await until(() => f.server.manager.matches.size === 0); assert.equal(f.server.storage.top().length, 0);
});

test('HTTP signout still forfeits immediately when that session has already lost its game socket', async t => {
  const f = await fixture(t, { grace: 10000 });
  const aa = await f.account('transport'), bb = await f.account('opponent');
  const a = await f.connect(aa), b = await f.connect(bb); const g = await f.pair(a, b);
  a.disconnect(); await until(() => !g.player('transport').connected);
  await f.request('/signout', {}, aa.cookie); await until(() => b.result, 2000);
  assert.equal(b.result.reason, 'signout'); assert.equal(b.result.winner, 'opponent');
  assert.equal(f.server.manager.membership.has('transport'), false);
});

test('accounts and leaderboard survive an actual server close/reopen and still authenticate', async t => {
  const f = await fixture(t); const account = await f.account('persistent');
  const players = [{ username: 'persistent', name: 'persistent', avatar: 'fox', score: 42 }, { username: 'rival', name: 'Rival', avatar: 'owl', score: 3 }];
  await f.server.storage.record({ matchId: 'restart-check', winner: 'persistent', players });
  await f.server.close();
  const restarted = await createGameServer({ dataDir: f.dataDir });
  try {
    const address = await restarted.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${address.port}`;
    assert.equal((await (await fetch(base + '/validate', { headers: { Cookie: account.cookie } })).json()).user, null);
    const signed = await fetch(base + '/signin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'persistent', password: 'password123' }) });
    assert.equal(signed.status, 200); assert.equal((await signed.json()).user.username, 'persistent');
    const board = (await (await fetch(base + '/leaderboard')).json()).leaderboard;
    assert.equal(board[0].bestScore, 42); assert.equal(board[0].wins, 1);
  } finally { await restarted.close(); }
});

test('loading timeout and countdown disconnect return opponents to lobby without a result', async t => {
  const f = await fixture(t, { countdown: 500 });
  const aa = await f.account('loadone'), bb = await f.account('loadtwo');
  const a = await f.connect(aa), b = await f.connect(bb, false);
  a.emit('queue:join'); b.emit('queue:join'); await until(() => a.match);
  await until(() => a.events.some(e => e.event === 'match:cancelled'));
  assert.equal(f.server.manager.matches.size, 0); assert.equal(f.server.storage.top().length, 0);
  a.match = b.match = null; a.emit('queue:join'); b.emit('queue:join'); await until(() => b.match);
  b.emit('match:ready', { matchId: b.match.matchId }); await until(() => a.events.some(e => e.event === 'match:countdown'));
  b.disconnect(); await until(() => f.server.manager.matches.size === 0); assert.equal(f.server.storage.top().length, 0);
});

test('Back to Home revokes pending rematch and permits matchmaking again; results expire with bounded retention', async t => {
  const f = await fixture(t, { resultRetention: 300 });
  const a = await f.connect(await f.account('homeone')), b = await f.connect(await f.account('hometwo'));
  const g = await f.pair(a, b); a.emit('match:leave', { matchId: g.id }); await until(() => a.result && b.result);
  a.emit('match:rematch', { matchId: g.id }); await until(() => g.rematch.size === 1);
  b.emit('match:leave', { matchId: g.id }); await until(() => !f.server.manager.membership.has('hometwo'));
  assert.ok(a.events.some(e => e.event === 'match:rematch-state' && e.data.available === false));
  b.emit('queue:join'); await until(() => f.server.manager.queue.includes('hometwo'));
  await until(() => !f.server.manager.matches.has(g.id)); assert.equal(f.server.manager.membership.has('homeone'), false);
});

test('atomic persistence survives a new server; duplicate results, draws, sorting, and corrupt files', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gemrush-storage-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const storage = await openStorage(directory);
  await Promise.all(Array.from({ length: 12 }, (_, i) => storage.register({ username: `user${i}`, name: `User ${i}`, avatar: 'fox', passwordHash: 'test-hash' })));
  assert.equal(storage.accounts.value.length, 12);
  const players = [{ username: 'zulu', name: 'Z', avatar: 'fox', score: 10 }, { username: 'alpha', name: 'A', avatar: 'frog', score: 10 }];
  await Promise.all([storage.record({ matchId: 'same', winner: 'zulu', players }), storage.record({ matchId: 'same', winner: 'zulu', players }), storage.record({ matchId: 'draw', winner: null, players })]);
  assert.equal(storage.top()[0].username, 'zulu'); assert.equal(storage.top()[0].wins, 1);
  await storage.record({ matchId: 'tie', winner: 'alpha', players }); assert.equal(storage.top()[0].username, 'alpha');
  const server = await createGameServer({ dataDir: directory }); assert.equal(server.storage.accounts.value.length, 12); assert.deepEqual(server.storage.top(), storage.top()); await server.close();
  await fs.writeFile(path.join(directory, 'accounts.json'), '{broken');
  await assert.rejects(openStorage(directory), /Original file preserved/); assert.equal(await fs.readFile(path.join(directory, 'accounts.json'), 'utf8'), '{broken');
});
