'use strict';
const { randomUUID } = require('node:crypto');
const defaults = require('./config');
const powerKinds = ['boots', 'ice', 'grapefruit', 'laser'];
const zeroInput = () => ({ x: 0, y: 0 });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Numeric circle geometry replaces the lab's Canvas-dependent BoundingBox.
// Rendering retains the lab modules; all movement and collection run here.
class Game {
  constructor(users, now, { config = defaults, random = Math.random } = {}) {
    this.config = config;
    this.random = random;
    this.id = randomUUID();
    this.phase = 'loading';
    this.createdAt = now;
    this.tick = 0;
    this.nextId = 0;
    this.events = [];
    this.gems = [];
    this.fires = [];
    this.powers = [];
    this.dropsUntilLaser = config.firstLaserByDrop;
    this.projectiles = [];
    this.ready = new Set();
    this.rematch = new Set();
    this.departed = new Set();
    this.players = users.map((user, index) => ({
      ...user, x: index === 0 ? 210 : 650, y: 295, radius: config.radius,
      facing: index === 0 ? 'Right' : 'Left', moving: false, connected: true,
      score: 0, input: zeroInput(), inputAt: 0, bootsUntil: 0,
      growthUntil: 0, laserShots: 0, laserLockUntil: 0, visionUntil: 0,
      stunUntil: 0, freezeUntil: 0, fireUntil: 0, cheat: false,
      stats: { green: 0, red: 0, yellow: 0, purple: 0, gems: 0, boots: 0, ice: 0, grapefruit: 0, laser: 0, powers: 0, fireHits: 0, pointsLost: 0, frozen: 0, freezesLanded: 0, bestStreak: 0, distance: 0, usedCheat: false }, streak: 0
    }));
  }
  player(username) { return this.players.find(p => p.username === username); }
  event(type, player, now, extra = {}) {
    this.events.push({ id: `${this.id}:event:${++this.nextId}`, matchId: this.id, type, username: player?.username, time: now, x: player?.x, y: player?.y, ...extra });
  }
  setReady(username, now) {
    if (this.phase !== 'loading' || !this.player(username)) return;
    this.ready.add(username);
    if (this.ready.size === 2) {
      this.phase = 'countdown';
      this.startAt = now + this.config.countdown;
      this.endAt = this.startAt + this.config.duration;
    }
  }
  setInput(username, input, now) {
    if (this.phase !== 'playing' || now >= this.endAt || !input || ![-1, 0, 1].includes(input.x) || ![-1, 0, 1].includes(input.y)) return false;
    const player = this.player(username);
    if (!player?.connected) return false;
    player.input = { x: input.x, y: input.y };
    player.inputAt = now;
    return true;
  }
  clearInput(player) { player.input = zeroInput(); player.moving = false; }
  toggleCheat(username, now) {
    if (this.phase !== 'playing' || now >= this.endAt) return;
    const player = this.player(username);
    if (!player) return;
    player.cheat = !player.cheat;
    if (player.cheat) {
      player.stats.usedCheat = true;
      player.stunUntil = player.freezeUntil = 0;
    }
    this.event('cheat', player, now, { enabled: player.cheat });
  }
  clamp(body) {
    const b = this.config.bounds;
    body.x = Math.max(b.left + body.radius, Math.min(b.right - body.radius, body.x));
    body.y = Math.max(b.top + body.radius, Math.min(b.bottom - body.radius, body.y));
  }
  spot(radius) {
    const b = this.config.bounds;
    const occupied = [...this.players, ...this.fires, ...this.gems, ...this.powers];
    const safe = point => occupied.every(other => distance(point, other) > radius + other.radius + 16);
    for (let n = 0; n < 60; n++) {
      const point = { x: b.left + radius + this.random() * (b.right - b.left - radius * 2), y: b.top + radius + this.random() * (b.bottom - b.top - radius * 2) };
      if (safe(point)) return point;
    }
    // Deterministic bounded fallback: skip a spawn if the grid is fully occupied.
    for (let y = b.top + radius; y <= b.bottom - radius; y += 35) {
      for (let x = b.left + radius; x <= b.right - radius; x += 35) if (safe({ x, y })) return { x, y };
    }
    return null;
  }
  spawnGem(now) {
    if (this.gems.length >= this.config.maxGems) return;
    const point = this.spot(12);
    if (!point) return;
    const roll = this.random();
    const color = roll < .5 ? 'green' : roll < .75 ? 'red' : roll < .9 ? 'yellow' : 'purple';
    this.gems.push({ id: `g${++this.nextId}`, ...point, radius: 12, color, expiresAt: now + this.config.gemLifetime });
  }
  spawnPower(now) {
    if (this.powers.length >= this.config.maxPowers) return;
    const point = this.spot(14);
    if (!point) return;
    // Count successful placements so a full arena cannot consume a guaranteed laser.
    const kind = this.dropsUntilLaser === 1 ? 'laser' : powerKinds[Math.floor(this.random() * powerKinds.length)];
    if (kind === 'laser') this.dropsUntilLaser = this.config.maxDropsBetweenLasers + 1;
    else this.dropsUntilLaser--;
    this.powers.push({ id: `p${++this.nextId}`, ...point, radius: 14, kind, expiresAt: now + this.config.powerLifetime });
  }
  addFire() {
    const point = this.spot(14);
    if (!point) return false;
    const angle = this.random() * Math.PI * 2;
    this.fires.push({ id: `f${++this.nextId}`, ...point, radius: 14, vx: Math.cos(angle) * 75, vy: Math.sin(angle) * 75 });
    return true;
  }
  start(now) {
    this.phase = 'playing';
    this.waves = 0; this.frenzy = false;
    for (let i = 0; i < this.config.fireCount; i++) this.addFire();
    for (let i = 0; i < this.config.initialGems; i++) this.spawnGem(now);
    this.nextGemAt = now + this.config.gemInterval;
    this.nextPowerAt = now + this.config.powerInterval;
  }
  resolvePlayers() {
    const [a, b] = this.players;
    // Split penetration, clamp to walls, then repeat. This transfers the remaining
    // displacement to the unblocked body at a wall instead of trapping either one.
    for (let i = 0; i < 12; i++) {
      const d = distance(a, b), overlap = a.radius + b.radius - d;
      if (overlap < .001) break;
      const nx = d ? (b.x - a.x) / d : 1, ny = d ? (b.y - a.y) / d : 0;
      a.x -= nx * overlap / 2; a.y -= ny * overlap / 2;
      b.x += nx * overlap / 2; b.y += ny * overlap / 2;
      this.clamp(a); this.clamp(b);
    }
  }
  shoot(username, now) {
    const owner = this.player(username);
    if (this.phase !== 'playing' || now >= this.endAt || !owner?.connected || !owner.laserShots) return false;
    const target = this.players.find(p => p !== owner);
    const angle = Math.atan2(target.y - owner.y, target.x - owner.x);
    owner.laserShots--;
    this.event('laser-fired', owner, now, { angle });
    this.projectiles.push({
      id: `l${++this.nextId}`, owner: username, target: target.username,
      x: owner.x, y: owner.y, angle, expiresAt: now + this.config.laserLifetime
    });
    return true;
  }
  advanceProjectiles(now, dt) {
    const travel = this.config.speed * dt; // Always the ordinary walking speed, independent of boosts.
    this.projectiles = this.projectiles.filter(bolt => {
      if (now >= bolt.expiresAt) return false;
      const target = this.player(bolt.target);
      if (target.connected) {
        bolt.angle = Math.atan2(target.y - bolt.y, target.x - bolt.x);
        // Look along this step before moving: fast bolts cannot skip through the target.
        if (distance(bolt, target) <= target.radius + travel) {
          target.laserLockUntil = now + this.config.laserLockDuration;
          target.visionUntil = now + this.config.laserVisionDuration;
          target.moving = false;
          this.event('laser-hit', target, now, { owner: bolt.owner });
          return false;
        }
      }
      bolt.x += Math.cos(bolt.angle) * travel;
      bolt.y += Math.sin(bolt.angle) * travel;
      return true;
    });
  }
  eligible(entity, now, allowExtendedGemReach = false) {
    // Contested pickups: nearest eligible body wins; exact distance ties use the
    // original FIFO match slot. One server removes the entity exactly once.
    return this.players.filter(p => {
      if (!p.connected || p.stunUntil > now || p.freezeUntil > now) return false;
      // Double the complete center-to-center gem reach, leaving every other body unchanged.
      const reach = p.radius + entity.radius;
      const growingForGem = allowExtendedGemReach && p.growthUntil > now;
      return distance(p, entity) <= (growingForGem ? reach * 2 : reach);
    })
      .sort((a, b) => distance(a, entity) - distance(b, entity) || this.players.indexOf(a) - this.players.indexOf(b))[0];
  }
  step(now, dt = this.config.step / 1000) {
    if (this.phase === 'countdown' && now >= this.startAt) this.start(now);
    if (this.phase !== 'playing') return;
    // Check the deadline before collision/scoring, including after event-loop lag.
    if (now >= this.endAt) { this.finish('time', now); return; }
    this.tick++;
    for (const p of this.players) {
      if (!p.connected || now - p.inputAt > this.config.inputTimeout) this.clearInput(p);
      const { x, y } = p.input, length = Math.hypot(x, y);
      p.moving = length > 0 && p.stunUntil <= now && p.freezeUntil <= now && p.laserLockUntil <= now;
      if (p.moving) {
        // Adapted lab directional movement, now normalized and based on time.
        const speed = this.config.speed * (p.cheat ? 2 : p.bootsUntil > now ? 1.5 : 1);
        const ox = p.x, oy = p.y;
        p.x += x / length * speed * dt; p.y += y / length * speed * dt;
        p.facing = x < 0 ? 'Left' : x > 0 ? 'Right' : y < 0 ? 'Up' : 'Down';
        this.clamp(p);
        p.stats.distance += Math.hypot(p.x - ox, p.y - oy);
      }
    }
    this.resolvePlayers();
    this.advanceProjectiles(now, dt);
    const remaining = this.endAt - now;
    const waves = (this.config.fireWaves || []).filter(t => remaining <= t).length;
    while (this.waves < waves) {
      this.waves++;
      if (this.addFire()) this.event('wave', null, now, { fires: this.fires.length });
    }
    if (!this.frenzy && this.config.frenzyAt && remaining <= this.config.frenzyAt) {
      this.frenzy = true;
      this.event('frenzy', null, now);
      this.nextGemAt = Math.min(this.nextGemAt, now);
    }
    for (const fire of this.fires) {
      fire.x += fire.vx * dt; fire.y += fire.vy * dt;
      const b = this.config.bounds;
      if (fire.x < b.left + fire.radius || fire.x > b.right - fire.radius) fire.vx *= -1;
      if (fire.y < b.top + fire.radius || fire.y > b.bottom - fire.radius) fire.vy *= -1;
      this.clamp(fire);
      for (const p of this.players) {
        if (p.connected && !p.cheat && now >= p.fireUntil && distance(p, fire) <= p.radius + fire.radius) {
          const lost = Math.min(2, p.score);
          p.score -= lost; p.stunUntil = now + this.config.stunDuration;
          p.fireUntil = now + this.config.fireCooldown; p.stats.fireHits++; p.stats.pointsLost += lost; p.moving = false;
          p.streak = 0;
          this.event('fire', p, now, { lost });
        }
      }
    }
    this.gems = this.gems.filter(g => g.expiresAt > now);
    this.powers = this.powers.filter(p => p.expiresAt > now);
    for (const gem of [...this.gems]) {
      const p = this.eligible(gem, now, true);
      if (!p) continue;
      this.gems.splice(this.gems.indexOf(gem), 1);
      const points = this.config.gemValues[gem.color] * (p.cheat ? 3 : 1);
      p.score += points; p.stats[gem.color]++; p.stats.gems++;
      p.streak++; p.stats.bestStreak = Math.max(p.stats.bestStreak, p.streak);
      this.event('collect', p, now, { points, color: gem.color, gemX: gem.x, gemY: gem.y, streak: p.streak });
      if (p.score >= this.config.target) { this.finish('target', now, p.username); return; }
    }
    for (const power of [...this.powers]) {
      const p = this.eligible(power, now);
      if (!p) continue;
      this.powers.splice(this.powers.indexOf(power), 1);
      p.stats[power.kind]++; p.stats.powers++;
      let extra = {};
      if (power.kind === 'boots') p.bootsUntil = now + this.config.bootsDuration;
      else if (power.kind === 'grapefruit') p.growthUntil = now + this.config.growthDuration;
      else if (power.kind === 'laser') p.laserShots++;
      else if (power.kind === 'ice') {
        const opponent = this.players.find(other => other !== p);
        if (!opponent.cheat) { opponent.freezeUntil = now + this.config.freezeDuration; opponent.stats.frozen++; opponent.moving = false; opponent.streak = 0; p.stats.freezesLanded++; }
        extra = { target: opponent.username, targetX: opponent.x, targetY: opponent.y, blocked: opponent.cheat };
      }
      this.event('power', p, now, { kind: power.kind, ...extra });
    }
    if (now >= this.nextGemAt) { this.spawnGem(now); this.nextGemAt = now + (this.frenzy ? this.config.frenzyInterval : this.config.gemInterval); }
    if (now >= this.nextPowerAt) { this.spawnPower(now); this.nextPowerAt = now + this.config.powerInterval; }
  }
  disconnect(username, now) {
    const p = this.player(username);
    if (!p) return;
    p.connected = false; p.disconnectedAt = now; this.clearInput(p);
  }
  reconnect(username) {
    const p = this.player(username);
    if (p) { p.connected = true; delete p.disconnectedAt; this.clearInput(p); }
  }
  clearEffects() {
    this.projectiles.length = 0;
    for (const p of this.players) {
      this.clearInput(p);
      p.growthUntil = p.laserShots = p.laserLockUntil = p.visionUntil = 0;
      p.bootsUntil = p.stunUntil = p.freezeUntil = p.fireUntil = 0;
      p.cheat = false;
    }
  }
  finish(reason, now, winner) {
    if (this.phase === 'finished' || this.phase === 'cancelled') return false;
    if (winner === undefined) {
      const [a, b] = this.players;
      winner = a.score === b.score ? null : a.score > b.score ? a.username : b.username;
    }
    this.phase = 'finished'; this.finishedAt = now;
    this.clearEffects();
    this.result = {
      matchId: this.id, reason, winner, endedAt: now,
      players: this.players.map(p => ({ username: p.username, name: p.name, avatar: p.avatar, score: p.score, stats: { ...p.stats, distance: Math.round(p.stats.distance) }, outcome: winner === null ? 'draw' : winner === p.username ? 'win' : 'loss' }))
    };
    return true;
  }
  snapshot(now) {
    return { matchId: this.id, phase: this.phase, tick: this.tick, serverTime: now, startAt: this.startAt || null, endAt: this.endAt || null, target: this.config.target, frenzy: !!this.frenzy,
      players: this.players.map(({ input, inputAt, ...p }) => ({ ...p, stats: { ...p.stats, distance: Math.round(p.stats.distance) } })),
      gems: this.gems.map(g => ({ ...g })), fires: this.fires.map(f => ({ ...f })), powers: this.powers.map(p => ({ ...p })),
      projectiles: this.projectiles.map(bolt => ({ ...bolt })) };
  }
}
module.exports = { Game, distance };
