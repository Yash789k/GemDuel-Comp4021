'use strict';
// Tests for the late-game features: fire waves, Gem Frenzy, extra statistics
// and the all-time rank / games-played counters.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Game } = require('../server/game');
const { openStorage } = require('../server/storage');
const defaults = require('../server/config');
const users = [{ username: 'alpha', name: 'Alpha', avatar: 'fox' }, { username: 'beta', name: 'Beta', avatar: 'frog' }];
function setup(overrides = {}) {
  let seed = 1;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const game = new Game(users, 1000, { config: { ...defaults, initialGems: 0, ...overrides }, random });
  game.setReady('alpha', 1000); game.setReady('beta', 1000); game.step(4000, 0); // starts at 4000, ends at 124000
  return game;
}

test('one extra fire joins at 60 s and 30 s left, each announced once', () => {
  const g = setup();
  assert.equal(g.fires.length, 3);
  g.step(63000, 0); assert.equal(g.fires.length, 3);
  g.step(64000, 0); assert.equal(g.fires.length, 4);
  g.step(64100, 0); assert.equal(g.fires.length, 4);
  g.step(94000, 0); assert.equal(g.fires.length, 5);
  assert.equal(g.events.filter(e => e.type === 'wave').length, 2);
});

test('Gem Frenzy starts with 20 s left and doubles the gem spawn rate', () => {
  const g = setup({ fireCount: 0, maxGems: 100 });
  g.step(100000, 0);
  assert.equal(g.frenzy, false);
  g.step(104000, 0);
  assert.equal(g.frenzy, true);
  assert.equal(g.snapshot(104000).frenzy, true);
  assert.equal(g.events.filter(e => e.type === 'frenzy').length, 1);
  const before = g.gems.length;
  for (let t = 104000; t <= 105900; t += 25) g.step(t, 0);
  // 1.9 s / 325 ms = 5 spawns; the normal 650 ms rate would give only 2
  assert.equal(g.gems.length - before, 5);
});

test('statistics track points lost to fire, streaks, freezes landed and distance', () => {
  const g = setup({ fireCount: 0 });
  const [a, b] = g.players;
  for (let i = 0; i < 3; i++) { g.gems.push({ id: `g${i}`, color: 'green', x: a.x, y: a.y, radius: 12, expiresAt: 99999 }); g.step(4010 + i, 0); }
  assert.equal(a.stats.bestStreak, 3);
  a.score = 1;
  g.fires.push({ id: 'f', x: a.x, y: a.y, radius: 14, vx: 0, vy: 0 }); g.step(4100, 0);
  assert.equal(a.score, 0); assert.equal(a.stats.pointsLost, 1); assert.equal(a.streak, 0);
  assert.equal(g.events.find(e => e.type === 'fire').lost, 1);
  g.fires = [];
  g.powers.push({ id: 'ice', kind: 'ice', x: b.x, y: b.y, radius: 14, expiresAt: 99999 }); g.step(6000, 0);
  assert.equal(b.stats.freezesLanded, 1); assert.equal(a.stats.frozen, 1);
  const ev = g.events.find(e => e.type === 'power');
  assert.equal(ev.target, 'alpha'); assert.equal(ev.blocked, false);
  g.setInput('beta', { x: -1, y: 0 }, 6000); g.step(6100, .1);
  assert.ok(Math.abs(b.stats.distance - 18) < 1e-9);
});

test('leaderboard counts games and reports all-time ranks', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gemrush-rank-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const storage = await openStorage(dir);
  const players = [{ username: 'alpha', name: 'A', avatar: 'fox', score: 30 }, { username: 'beta', name: 'B', avatar: 'frog', score: 45 }];
  await storage.record({ matchId: 'm1', winner: 'beta', players });
  await storage.record({ matchId: 'm2', winner: null, players });
  assert.deepEqual(storage.top().map(r => [r.username, r.games]), [['beta', 2], ['alpha', 2]]);
  assert.deepEqual(storage.ranks(['alpha', 'beta', 'nobody']), { alpha: 2, beta: 1, nobody: 0 });
  assert.equal(storage.total(), 2);
});

test('legacy animals, Green Ranger and Ember Courier all have selectable sheets and icons', () => {
  const { validateRegistration, AVATARS } = require('../server/auth');
  const Characters = require('../public/scripts/characters');
  assert.deepEqual(new Set(AVATARS), new Set(['green', 'ember', 'fox', 'cat', 'frog', 'owl', 'bunny', 'bear', 'panda', 'penguin']));
  assert.equal(Characters.idFor(undefined), 'green');
  assert.equal(Characters.matchSheet([{ avatar: 'ember' }, { avatar: 'ember' }], 1), Characters.sheet('ember', true));
  const base = { username: 'tester', name: 'T', password: 'password1', confirmPassword: 'password1' };
  for (const avatar of AVATARS) {
    assert.equal(validateRegistration({ ...base, avatar }), null);
    for (const file of [`characters/char-${avatar}.png`, `characters/char-${avatar}-alt.png`, Characters.icon(avatar).slice('/assets/'.length)]) {
      assert.ok(require('node:fs').existsSync(path.join(__dirname, '..', 'public', 'assets', file)), file);
    }
  }
  assert.equal(validateRegistration({ ...base, avatar: 'dragon' }), 'Choose an approved avatar.');
});

test('legacy accounts and ranking rows without an avatar resolve to Green Ranger', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gemrush-legacy-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const identity = { username: 'old', name: 'Old player' };
  await fs.writeFile(path.join(dir, 'accounts.json'), JSON.stringify([{ ...identity, passwordHash: 'legacy' }]));
  await fs.writeFile(path.join(dir, 'leaderboard.json'), JSON.stringify({
    records: [{ ...identity, wins: 1, bestScore: 10 }], completed: []
  }));
  const store = await openStorage(dir);
  assert.equal(store.publicUser(store.find('old')).avatar, 'green');
  assert.equal(store.top()[0].avatar, 'green');
});
