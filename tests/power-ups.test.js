'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../server/game');
const defaults = require('../server/config');

const users = [
  { username: 'first', name: 'First', avatar: 'fox' },
  { username: 'second', name: 'Second', avatar: 'owl' }
];
function duel(overrides = {}) {
  const config = { ...defaults, initialGems: 0, maxGems: 0, fireCount: 0, ...overrides };
  const game = new Game(users, 0, { config });
  for (const user of users) game.setReady(user.username, 0);
  game.step(3000, 0);
  return game;
}
function pickup(game, kind, now) {
  const { x, y } = game.players[0];
  game.powers.push({ kind, id: 'fixture', x, y, radius: 14, expiresAt: now + 500 });
  game.step(now, 0);
}

test('the four power-ups can each spawn using the existing spawn system', () => {
  const game = duel();
  for (const [index, kind] of ['boots', 'ice', 'grapefruit', 'laser'].entries()) {
    game.powers.length = 0;
    game.random = () => (index + .5) / 4;
    game.spawnPower(4200);
    assert.equal(game.powers[0].kind, kind);
    assert.equal(game.powers[0].expiresAt, 14200);
  }
});

test('grapefruit doubles gem reach around the player, refreshes and expires at exactly five seconds', () => {
  const g = duel(), [p, rival] = g.players;
  const bodyRadius = p.radius;
  const gemReach = p.radius + 12;
  const addGem = offset => g.gems.push({ id: 'probe', color: 'green', x: p.x + offset, y: p.y, radius: 12, expiresAt: 30000 });
  addGem(gemReach + 1); g.step(3010, 0); assert.equal(p.score, 0);
  pickup(g, 'grapefruit', 3100);
  addGem(-gemReach * 2); addGem(gemReach * 2 + 1);
  g.step(3110, 0); assert.equal(p.score, 2); assert.equal(p.growthUntil, 8100);
  assert.equal(p.radius, bodyRadius); assert.equal(rival.growthUntil, 0);
  assert.equal(g.snapshot(3110).players[0].growthUntil, 8100);
  const distantIce = { x: p.x + 32, y: p.y, radius: 14, kind: 'ice', expiresAt: 30000 };
  g.powers.push(distantIce);
  assert.equal(g.eligible(distantIce, 3110), undefined);
  pickup(g, 'grapefruit', 6100);
  g.step(6101, 0); assert.equal(p.score, 2); assert.equal(p.growthUntil, 11100);
  assert.equal(p.stats.grapefruit, 2); assert.equal(p.stats.powers, 2);
  addGem(gemReach + 1); g.step(11099, 0); assert.equal(p.score, 3);
  addGem(gemReach + 1); g.step(11100, 0); assert.equal(p.score, 3);
  assert.equal(g.gems.length, 2);
});

test('each laser pickup adds one shot and shots cannot target their owner', () => {
  const g = duel(), [owner, target] = g.players;
  assert.equal(g.shoot(owner.username, 3010), false);
  pickup(g, 'laser', 3020); pickup(g, 'laser', 3030);
  assert.equal(owner.laserShots, 2); assert.equal(owner.stats.laser, 2);
  assert.equal(g.shoot(owner.username, 3040), true);
  assert.equal(g.shoot(owner.username, 3040), true);
  assert.equal(g.shoot(owner.username, 3040), false);
  const { projectiles } = g.snapshot(3040);
  assert.equal(projectiles.length, 2);
  assert.notEqual(projectiles[0].id, projectiles[1].id);
  assert.equal(projectiles[0].x, owner.x);
  assert.equal(projectiles[0].target, target.username);
  g.step(3050, .01);
  assert.equal(owner.laserLockUntil, 0); assert.equal(owner.visionUntil, 0);
});

test('homing laser follows a moving opponent and applies timed movement and sight effects to the target only', () => {
  const g = duel(), [owner, target] = g.players;
  pickup(g, 'laser', 3010); g.shoot(owner.username, 3020);
  g.step(3120, .1);
  const first = g.snapshot(3120).projectiles[0];
  assert.equal(first.angle, 0);
  assert.equal(first.x - owner.x, defaults.speed * .1);
  assert.equal(first.expiresAt, 3020 + 3000); assert.equal(first.y, owner.y);
  g.setInput(target.username, { x: 0, y: 1 }, 3120); g.step(3220, .1);
  assert.ok(g.projectiles[0].angle > 0);
  assert.ok(g.projectiles[0].y > first.y);
  g.setInput(target.username, { x: 0, y: 0 }, 3220);
  let t = 3220;
  while (g.projectiles.length && t < 6020) { t += 20; g.step(t, .02); }
  assert.equal(g.projectiles.length, 0);
  assert.equal(g.events.filter(e => e.type === 'laser-hit').length, 1);
  assert.equal(target.laserLockUntil, t + 1000); assert.equal(target.visionUntil, t + 2000);
  assert.equal(owner.laserLockUntil, 0); assert.equal(owner.visionUntil, 0);
  const x = target.x;
  g.setInput(target.username, { x: 1, y: 0 }, t + 999);
  g.step(t + 999, .05); assert.equal(target.x, x);
  g.step(t + 1000, .05); assert.equal(target.x, x + 9);
  assert.ok(target.visionUntil > t + 1000);
});

test('a laser expires before hit resolution at its lifetime boundary', () => {
  const g = duel({ laserLifetime: 100 }); const [owner, target] = g.players;
  pickup(g, 'laser', 3010); g.shoot(owner.username, 3020);
  g.step(3119, .09); assert.equal(g.projectiles.length, 1);
  g.step(3120, 2); assert.equal(g.projectiles.length, 0);
  assert.equal(target.visionUntil, 0);
  assert.equal(g.events.some(e => e.type === 'laser-hit'), false);
});

test('finishing or restarting clears all transient power-up and projectile state', () => {
  const g = duel(), [p, other] = g.players;
  pickup(g, 'grapefruit', 3010); pickup(g, 'laser', 3020); pickup(g, 'laser', 3030);
  g.shoot(p.username, 3040); other.laserLockUntil = 4040; other.visionUntil = 5040;
  assert.equal(g.projectiles.length, 1); assert.equal(p.laserShots, 1);
  g.finish('leave', 3050, other.username);
  for (const game of [g, duel()]) {
    const state = game.snapshot(3050);
    assert.deepEqual(state.projectiles, []);
    for (const player of state.players) {
      for (const key of ['growthUntil', 'laserShots', 'laserLockUntil', 'visionUntil']) assert.equal(player[key], 0);
    }
  }
  assert.equal(g.result.players[0].stats.grapefruit, 1);
  assert.equal(g.result.players[0].stats.laser, 2);
  assert.equal(g.shoot(p.username, 3060), false);
});
