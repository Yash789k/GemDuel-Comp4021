'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Game, distance } = require('../server/game');
const defaults = require('../server/config');
const users = [{ username: 'alpha', name: 'Alpha', avatar: 'fox' }, { username: 'beta', name: 'Beta', avatar: 'frog' }];
function setup(overrides = {}) {
  const game = new Game(users, 1000, { config: { ...defaults, initialGems: 0, fireCount: 0, ...overrides }, random: () => .4 });
  game.setReady('alpha', 1000); game.setReady('beta', 1000); game.step(4000, 0);
  return game;
}
const gem = (game, color, p = game.players[0], expiresAt = 99999) => game.gems.push({ id: `${color}${game.gems.length}`, color, x: p.x, y: p.y, radius: 12, expiresAt });
const power = (game, kind, p = game.players[0]) => game.powers.push({ id: `${kind}${game.powers.length}`, kind, x: p.x, y: p.y, radius: 14, expiresAt: 99999 });
const fire = (game, p = game.players[0]) => game.fires.push({ id: 'fire', x: p.x, y: p.y, radius: 14, vx: 0, vy: 0 });

test('both players must load; one shared countdown prevents movement and scoring', () => {
  const g = new Game(users, 1000); const p = g.players[0]; const x = p.x;
  g.setReady('alpha', 1000); g.setReady('alpha', 1001); assert.equal(g.phase, 'loading');
  g.setReady('beta', 1100); assert.equal(g.startAt, 4100); assert.equal(g.endAt, 124100);
  assert.equal(g.setInput('alpha', { x: 1, y: 0 }, 1200), false);
  gem(g, 'purple'); g.step(4000); assert.equal(p.x, x); assert.equal(p.score, 0);
  g.step(4100); assert.equal(g.phase, 'playing');
});

test('fixed-step movement normalizes diagonals, rejects invalid inputs and clears stale input', () => {
  const a = setup(), b = setup();
  a.setInput('alpha', { x: 1, y: 0 }, 4000); b.setInput('alpha', { x: 1, y: 1 }, 4000);
  a.step(4100, .1); b.step(4100, .1);
  assert.ok(Math.abs(distance(a.players[0], { x: 210, y: 295 }) - 18) < 1e-9);
  assert.ok(Math.abs(distance(b.players[0], { x: 210, y: 295 }) - 18) < 1e-9);
  for (const input of [null, {}, { x: 999, y: 0 }, { x: '1', y: 0 }, { x: NaN, y: 1 }]) assert.equal(a.setInput('alpha', input, 4110), false);
  const x = a.players[0].x; a.step(4700, .1); assert.equal(a.players[0].x, x);
});

test('circle bodies stay in bounds and resolve overlap against walls without persistent penetration', () => {
  const g = setup(), [a, b] = g.players;
  a.x = b.x = 77; a.y = b.y = 182; g.resolvePlayers();
  assert.ok(distance(a, b) >= 33.99); assert.ok(a.x >= 77 && b.x >= 77 && a.y >= 182 && b.y >= 182);
  a.x = 782; a.y = 402; b.x = 300; b.y = 250;
  g.setInput('alpha', { x: 1, y: 1 }, 4000); g.step(4100, .5);
  assert.equal(a.x, 783); assert.equal(a.y, 403);
  const previous = { x: a.x, y: a.y }; g.resolvePlayers(); assert.equal(distance(a, previous), 0);
});

test('all four gem values and counts are correct; a collected gem cannot score twice', () => {
  const g = setup();
  for (const color of ['green', 'red', 'yellow', 'purple']) gem(g, color);
  g.step(4010, 0); const p = g.players[0]; assert.equal(p.score, 11); assert.equal(p.stats.gems, 4);
  for (const color of ['green', 'red', 'yellow', 'purple']) assert.equal(p.stats[color], 1);
  assert.equal(g.gems.length, 0); g.step(4020, 0); assert.equal(p.score, 11);
});

test('contested pickup uses nearest player then stable FIFO slot; each gem has one winner', () => {
  const g = setup(), [a, b] = g.players;
  a.x = 300; b.x = 334; a.y = b.y = 300;
  gem(g, 'purple', { x: 317, y: 300 }); g.step(4010, 0);
  assert.equal(a.score, 5); assert.equal(b.score, 0); assert.equal(g.gems.length, 0);
  gem(g, 'red', { x: 320, y: 300 }); g.step(4020, 0); assert.equal(b.score, 2);
});

test('expired gems never score, and all server-selected spawn locations are safe and bounded', () => {
  const g = setup(); gem(g, 'purple', g.players[0], 4010); g.step(4010, 0); assert.equal(g.players[0].score, 0);
  const populated = setup({ initialGems: 8, fireCount: 3 });
  assert.equal(populated.gems.length, 8); assert.equal(populated.fires.length, 3);
  for (const e of [...populated.gems, ...populated.fires]) {
    assert.ok(e.x - e.radius >= 60 && e.x + e.radius <= 800 && e.y - e.radius >= 165 && e.y + e.radius <= 420);
    assert.ok(populated.players.every(p => distance(p, e) > p.radius + e.radius));
  }
  populated.step(11000, 0); assert.ok(populated.gems.every(e => e.expiresAt > 11000));
  for (let i = 0; i < 40; i++) populated.spawnGem(11000);
  assert.equal(populated.gems.length, 12);
});

test('fires move and bounce; damage, one-second stun, cooldown and zero clamp are authoritative', () => {
  const g = setup(), p = g.players[0]; p.score = 5; fire(g);
  g.step(4010, 0); assert.equal(p.score, 3); assert.equal(p.stunUntil, 5010); assert.equal(p.stats.fireHits, 1);
  g.setInput('alpha', { x: 1, y: 0 }, 4020); const x = p.x; g.step(4050, .1); assert.equal(p.x, x);
  g.step(5509, 0); assert.equal(p.score, 3); g.step(5510, 0); assert.equal(p.score, 1);
  g.step(7010, 0); assert.equal(p.score, 0);
  const f = g.fires[0]; f.x = 785; f.y = 250; f.vx = 75; f.vy = 30;
  g.step(7050, .1); assert.equal(f.x, 786); assert.equal(f.vx, -75); assert.equal(f.y, 253);
});

test('boots give 1.5x speed for five seconds and refresh without stacking', () => {
  const g = setup(), p = g.players[0]; power(g, 'boots'); g.step(4010, 0); assert.equal(p.bootsUntil, 9010);
  g.setInput('alpha', { x: 1, y: 0 }, 4100); const x = p.x; g.step(4200, .1); assert.equal(p.x - x, 27);
  power(g, 'boots'); g.step(5000, 0); assert.equal(p.bootsUntil, 10000); assert.equal(p.stats.boots, 2);
  g.setInput('alpha', { x: 1, y: 0 }, 10001); const expiredX = p.x; g.step(10001, .1); assert.equal(p.x - expiredX, 18);
});

test('ice refreshes a two-second freeze and tracks successful applications; both effects must expire', () => {
  const g = setup(), b = g.players[1]; power(g, 'ice'); g.step(4010, 0);
  assert.equal(b.freezeUntil, 6010); assert.equal(b.stats.frozen, 1);
  power(g, 'ice'); g.step(4500, 0); assert.equal(b.freezeUntil, 6500); assert.equal(b.stats.frozen, 2);
  b.stunUntil = 6600; g.setInput('beta', { x: -1, y: 0 }, 6500); const x = b.x;
  g.step(6550, .1); assert.equal(b.x, x); g.step(6600, .1); assert.equal(b.x, x - 18);
});

test('cheat gives 2x movement, 3x points, immunity, cleared effects and correct boots restoration', () => {
  const g = setup(), [a, b] = g.players;
  a.stunUntil = a.freezeUntil = 10000; a.bootsUntil = 9000;
  g.toggleCheat('alpha', 4001); assert.equal(a.stunUntil, 0); assert.equal(a.freezeUntil, 0); assert.equal(a.stats.usedCheat, true);
  g.setInput('alpha', { x: 1, y: 0 }, 4010); g.step(4010, .1); assert.equal(a.x, 246);
  g.clearInput(a); gem(g, 'purple'); fire(g); power(g, 'ice', b); g.step(4020, 0);
  assert.equal(a.score, 15); assert.equal(a.stats.purple, 1); assert.equal(a.stats.fireHits, 0); assert.equal(a.stats.frozen, 0); assert.equal(a.freezeUntil, 0);
  g.toggleCheat('alpha', 4030); g.fires = []; g.setInput('alpha', { x: 1, y: 0 }, 4040); g.step(4040, .1); assert.equal(a.x, 273);
  assert.equal(a.bootsUntil, 9000); assert.equal(a.stunUntil, 0); assert.equal(a.freezeUntil, 0);
  g.setInput('alpha', { x: 1, y: 0 }, 9001); g.step(9001, .1); assert.equal(a.x, 291);
});

test('target ends immediately, terminal transitions are idempotent and subsequent points are impossible', () => {
  const g = setup(), p = g.players[0]; p.score = 49; gem(g, 'purple'); gem(g, 'purple');
  g.step(4010, 0); assert.equal(g.phase, 'finished'); assert.equal(p.score, 54); assert.equal(g.result.winner, 'alpha');
  assert.equal(g.finish('time', 5000), false); g.step(5000, 1); assert.equal(p.score, 54); assert.equal(g.result.reason, 'target');
  assert.equal(g.setInput('alpha', { x: 1, y: 1 }, 5000), false);
});

test('deadline awards no further points and chooses correct higher score or draw', () => {
  for (const [a, b, winner] of [[10, 9, 'alpha'], [1, 9, 'beta'], [8, 8, null]]) {
    const g = setup(); g.players[0].score = a; g.players[1].score = b; gem(g, 'purple', g.players[0], g.endAt + 10);
    g.step(g.endAt, .1); assert.equal(g.result.winner, winner); assert.equal(g.players[0].score, a); assert.equal(g.result.reason, 'time');
  }
});

test('disconnect immediately clears movement and reconnect restores the same player state', () => {
  const g = setup(); g.setInput('alpha', { x: 1, y: 1 }, 4001); g.players[0].score = 7;
  g.disconnect('alpha', 4002); assert.deepEqual(g.players[0].input, { x: 0, y: 0 });
  g.step(4050, .1); assert.equal(g.players[0].x, 210); g.reconnect('alpha');
  assert.equal(g.players[0].connected, true); assert.equal(g.players[0].score, 7);
});

test('fresh matches reset every score, counter, input, effect, entity ID namespace and timing', () => {
  const old = setup(); old.toggleCheat('alpha', 4001); power(old, 'boots'); old.step(4010, 0); old.finish('leave', 5000, 'beta');
  const fresh = new Game(users, 6000);
  assert.notEqual(fresh.id, old.id); assert.equal(fresh.phase, 'loading'); assert.equal(fresh.startAt, undefined);
  for (const p of fresh.players) { assert.equal(p.score, 0); assert.equal(p.cheat, false); assert.equal(p.bootsUntil, 0); assert.equal(p.stats.usedCheat, false); assert.equal(p.stats.powers, 0); }
  assert.equal(fresh.gems.length, 0);
});
