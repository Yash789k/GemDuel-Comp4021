// Sprite factories and the Canvas draw/update loop are adapted from Lab 3.
// The renderer never decides hits, scores, movement speed or entity lifetimes.
// Visual effects (particles, shake, banners, ice, stars) are drawn here only.
const ArenaRenderer = function(canvas) {
  const ctx = canvas.getContext('2d');
  const sprites = new Map(), images = new Map(), firstSeen = new Map();
  let history = [], latest = null, bursts = [], particles = [], banners = [];
  let me = null, shakeUntil = 0, lastFrame = performance.now();
  const GEM_COLOURS = { green: '#6be571', red: '#f4606a', yellow: '#ffd75e', purple: '#c08cff' };
  const PLAYER_COLOURS = ['#b9ffad', '#ffbd90'];
  const resources = ['background.png', 'object_sprites.png', 'boots.svg', 'ice.svg'];
  const ready = Promise.all(resources.map(name => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { images.set(name, img); resolve(); };
    img.onerror = () => reject(new Error(`Could not load ${name}. Reload the page to retry.`));
    img.src = `/assets/${name}`;
  })));

  // Each player is drawn as the character matching their avatar. If both players
  // picked the same character, the second player uses its alternate colours.
  function sheetFor(player, index) {
    const same = latest.players.length === 2 && latest.players[0].avatar === latest.players[1].avatar;
    return `/assets/characters/char-${player.avatar}${same && index === 1 ? '-alt' : ''}.png`;
  }

  const snapshot = data => {
    if (latest && data.matchId !== latest.matchId) reset();
    if (latest && data.tick < latest.tick) return;
    latest = data; history.push(data); if (history.length > 10) history.shift();
  };
  const reset = () => { sprites.clear(); firstSeen.clear(); history = []; latest = null; bursts = []; particles = []; banners = []; shakeUntil = 0; };
  function interpolated(entity, group, now) {
    const target = now - 80;
    let before = history[0], after = latest;
    for (let i = 1; i < history.length; i++) {
      if (history[i].serverTime >= target) { before = history[i - 1]; after = history[i]; break; }
      before = history[i];
    }
    const key = group === 'players' ? 'username' : 'id';
    const a = before[group].find(e => e[key] === entity[key]);
    const b = after[group].find(e => e[key] === entity[key]);
    if (!a || !b) return entity;
    const span = after.serverTime - before.serverTime;
    const t = span > 0 ? Math.max(0, Math.min(1, (target - before.serverTime) / span)) : 1;
    return { ...entity, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  function sprite(key, create) { if (!sprites.has(key)) sprites.set(key, create()); return sprites.get(key); }

  /* ---------- particle helpers ---------- */
  function burst(x, y, colour, count, speed = 160, size = 4) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.35 + Math.random() * 0.65);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, life: 0.5 + Math.random() * 0.4, max: 0.9, colour, size: size * (0.6 + Math.random() * 0.6), gravity: 320 });
    }
  }
  function banner(text, colour, ms = 2200) { banners.push({ text, colour, start: performance.now(), ms }); }

  function draw(now, username) {
    if (!latest || !images.has('background.png')) return;
    me = username;
    const real = performance.now(), dt = Math.min(0.05, (real - lastFrame) / 1000);
    lastFrame = real;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    // Screen shake when the local player is hit by fire.
    if (real < shakeUntil) {
      const k = (shakeUntil - real) / 350 * 7;
      ctx.translate((Math.random() - .5) * k, (Math.random() - .5) * k);
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(images.get('background.png'), 0, 0, 854, 480);
    ctx.fillStyle = '#132c2820'; ctx.fillRect(0, 0, 854, 480);
    // Boundary follows the original Lab 3 game area (60,165)–(800,420).
    const frenzy = latest.frenzy && latest.phase === 'playing';
    ctx.strokeStyle = frenzy ? `rgba(255,215,94,${0.55 + 0.4 * Math.sin(real / 120)})` : '#e7f9bc70';
    ctx.lineWidth = frenzy ? 4 : 2; ctx.setLineDash(frenzy ? [] : [5, 8]);
    ctx.strokeRect(60, 165, 740, 255); ctx.setLineDash([]);
    if (frenzy) {
      ctx.fillStyle = `rgba(255,215,94,${0.06 + 0.04 * Math.sin(real / 150)})`; ctx.fillRect(60, 165, 740, 255);
      ctx.font = 'bold 13px Arial'; ctx.textAlign = 'right'; ctx.fillStyle = '#ffe9a0';
      ctx.fillText('💎 GEM FRENZY · gems spawn 2× faster', 795, 158);
    }

    // Big translucent countdown during the last 10 seconds.
    if (latest.phase === 'playing' && latest.endAt) {
      const left = Math.ceil((latest.endAt - now) / 1000);
      if (left <= 10 && left > 0) {
        const frac = ((latest.endAt - now) / 1000) % 1;
        ctx.save(); ctx.globalAlpha = 0.18 + 0.25 * frac; ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${110 + 40 * frac}px Pixel, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(left), 430, 295); ctx.restore();
      }
    }

    const active = new Set();
    for (const gem of latest.gems) {
      const key = `gem:${gem.id}`; active.add(key);
      if (!firstSeen.has(gem.id)) firstSeen.set(gem.id, real);
      const age = (real - firstSeen.get(gem.id)) / 1000;
      const s = sprite(key, () => Gem(ctx, gem.x, gem.y, gem.color));
      ctx.save();
      // Pop in when spawned, blink before vanishing.
      const k = age < 0.25 ? 0.3 + 0.7 * (age / 0.25) + 0.25 * Math.sin(age / 0.25 * Math.PI) : 1;
      ctx.translate(gem.x, gem.y); ctx.scale(k, k); ctx.translate(-gem.x, -gem.y);
      if (gem.expiresAt - now < 1300) ctx.globalAlpha = .6 + .4 * Math.sin(now / 110);
      if (gem.color === 'purple' || gem.color === 'yellow') {
        // Rare gems glow so they stand out as worth chasing.
        ctx.fillStyle = gem.color === 'purple' ? '#c08cff33' : '#ffd75e2a';
        ctx.beginPath(); ctx.arc(gem.x, gem.y, 18 + 3 * Math.sin(real / 160), 0, Math.PI * 2); ctx.fill();
      }
      s.update(now); s.draw(); ctx.restore();
    }
    for (const id of firstSeen.keys()) if (!active.has(`gem:${id}`)) firstSeen.delete(id);
    for (const fire of latest.fires) {
      const key = `fire:${fire.id}`; active.add(key);
      const p = interpolated(fire, 'fires', now);
      // Warm glow under each fire.
      ctx.fillStyle = `rgba(255,120,40,${0.18 + 0.08 * Math.sin(real / 90 + fire.x)})`;
      ctx.beginPath(); ctx.ellipse(p.x, p.y + 10, 22, 9, 0, 0, Math.PI * 2); ctx.fill();
      const s = sprite(key, () => Fire(ctx, p.x, p.y)); s.setXY(p.x, p.y); s.update(now); s.draw();
      if (Math.random() < dt * 6) particles.push({ x: p.x + (Math.random() - .5) * 12, y: p.y - 8, vx: (Math.random() - .5) * 20, vy: -50 - Math.random() * 30, life: .5, max: .5, colour: '#ffb347', size: 2.5, gravity: 0 });
    }
    for (const power of latest.powers) {
      const icon = images.get(`${power.kind}.svg`); if (!icon) continue;
      const bob = Math.sin(now / 180) * 3;
      ctx.fillStyle = power.kind === 'ice' ? '#b7f8ff66' : '#fff2a966';
      ctx.beginPath(); ctx.arc(power.x, power.y, 22 + Math.sin(now / 200) * 2, 0, Math.PI * 2); ctx.fill();
      // Orbiting sparkle
      const a = now / 300;
      ctx.fillStyle = '#ffffff'; ctx.fillRect(power.x + Math.cos(a) * 22 - 1.5, power.y + Math.sin(a) * 22 - 1.5, 3, 3);
      if (power.expiresAt - now < 2000) ctx.globalAlpha = .5 + .5 * Math.sin(now / 90);
      ctx.drawImage(icon, power.x - 15, power.y - 17 + bob, 30, 30);
      ctx.globalAlpha = 1;
    }

    // Players: work out where each name tag goes first so they never overlap.
    const views = latest.players.map((player, index) => ({ player, index, p: interpolated(player, 'players', now) }));
    ctx.font = 'bold 12px Arial';
    const tags = views.map(({ player, p }) => {
      const label = (player.username === username ? 'YOU · ' : '') + player.name;
      const width = Math.min(205, ctx.measureText(label).width + 14);
      return { label, width, x: Math.max(width / 2 + 4, Math.min(850 - width / 2, p.x)), y: p.y - 62 };
    });
    if (tags.length === 2 && Math.abs(tags[0].x - tags[1].x) < (tags[0].width + tags[1].width) / 2 + 4 && Math.abs(tags[0].y - tags[1].y) < 24) {
      const lower = views[0].p.y > views[1].p.y ? 0 : 1;
      tags[lower].y = views[lower].p.y + 26; // move the lower player's tag under their feet
    }
    views.sort((a, b) => a.p.y - b.p.y).forEach(({ player, index, p }) => {
      const key = `player:${player.username}`; active.add(key);
      const color = PLAYER_COLOURS[index];
      ctx.save();
      // Cheat aura: pulsing magenta/gold glow plus sparkles.
      if (p.cheat) {
        const r = 30 + 4 * Math.sin(real / 90);
        const g = ctx.createRadialGradient(p.x, p.y - 8, 6, p.x, p.y - 8, r);
        g.addColorStop(0, 'rgba(255,60,220,0)'); g.addColorStop(.65, 'rgba(255,60,220,.28)'); g.addColorStop(1, 'rgba(255,215,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y - 8, r, 0, Math.PI * 2); ctx.fill();
        if (Math.random() < dt * 20) particles.push({ x: p.x + (Math.random() - .5) * 30, y: p.y - 10 + (Math.random() - .5) * 30, vx: 0, vy: -30, life: .5, max: .5, colour: Math.random() < .5 ? '#ff3cdc' : '#ffe066', size: 3, gravity: 0 });
      }
      ctx.strokeStyle = p.cheat ? '#ff3cdc' : color; ctx.lineWidth = p.cheat ? 4 : 3;
      ctx.fillStyle = '#19392435'; ctx.beginPath(); ctx.ellipse(p.x, p.y + 10, 21, 9, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // Speed trail: dust puffs behind a fast-moving player.
      if ((p.bootsUntil > now || p.cheat) && p.moving && Math.random() < dt * 30) {
        particles.push({ x: p.x + (Math.random() - .5) * 10, y: p.y + 12, vx: (Math.random() - .5) * 30, vy: -10, life: .4, max: .4, colour: p.cheat ? '#ff9cf0' : '#ffe39a', size: 4, gravity: 0 });
      }
      if (!p.connected) ctx.globalAlpha = .5;
      const s = sprite(key, () => Player(ctx, p.x, p.y, sheetFor(player, index))); s.sync(p); s.update(now); s.draw();
      ctx.globalAlpha = 1;
      if (p.freezeUntil > now) drawIce(p, now);
      if (p.stunUntil > now) drawStars(p, now);
      const tag = tags[index];
      ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center';
      ctx.fillStyle = '#10232de8'; ctx.fillRect(tag.x - tag.width / 2, tag.y, tag.width, 20);
      ctx.fillStyle = color; ctx.fillText(tag.label, tag.x, tag.y + 14, tag.width - 10);
      ctx.restore();
    });
    for (const key of sprites.keys()) if (!active.has(key)) sprites.delete(key);

    // Particles
    particles = particles.filter(q => (q.life -= dt) > 0);
    for (const q of particles) {
      q.x += q.vx * dt; q.y += q.vy * dt; q.vy += q.gravity * dt;
      ctx.globalAlpha = Math.max(0, q.life / q.max); ctx.fillStyle = q.colour;
      ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
    }
    ctx.globalAlpha = 1;

    // Floating score texts
    bursts = bursts.filter(b => now - b.time < 900);
    for (const event of bursts) {
      const age = now - event.time;
      ctx.save(); ctx.globalAlpha = Math.max(0, 1 - age / 900); ctx.textAlign = 'center';
      const pop = age < 120 ? 1 + (120 - age) / 240 : 1;
      ctx.font = `bold ${Math.round(20 * pop)}px Arial`;
      ctx.fillStyle = event.colour || '#fff4bd'; ctx.strokeStyle = '#213a2d'; ctx.lineWidth = 4;
      ctx.strokeText(event.label, event.x, event.y - 30 - age / 35); ctx.fillText(event.label, event.x, event.y - 30 - age / 35); ctx.restore();
    }

    // Banners (new fire wave, Gem Frenzy, etc.)
    banners = banners.filter(b => real - b.start < b.ms);
    banners.forEach((b, i) => {
      const t = (real - b.start) / b.ms;
      const alpha = t < .1 ? t / .1 : t > .8 ? (1 - t) / .2 : 1;
      const y = 120 + i * 46 - (t < .1 ? (1 - t / .1) * 20 : 0);
      ctx.save(); ctx.globalAlpha = alpha; ctx.textAlign = 'center';
      ctx.font = 'bold 26px Arial';
      const w = ctx.measureText(b.text).width + 40;
      ctx.fillStyle = '#0d1922d9'; ctx.fillRect(427 - w / 2, y - 30, w, 42);
      ctx.strokeStyle = b.colour; ctx.lineWidth = 2; ctx.strokeRect(427 - w / 2, y - 30, w, 42);
      ctx.fillStyle = b.colour; ctx.fillText(b.text, 427, y);
      ctx.restore();
    });
    ctx.restore();
  }

  function drawIce(p, now) {
    // A translucent ice block with highlights; shakes slightly near the end.
    const left = p.freezeUntil - now, jitter = left < 400 ? (Math.random() - .5) * 3 : 0;
    const x = p.x - 22 + jitter, y = p.y - 34, w = 44, h = 50;
    ctx.save();
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, '#d8fbffcc'); g.addColorStop(.5, '#6de2ff99'); g.addColorStop(1, '#3fb4e0aa');
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#effeff'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
    ctx.beginPath(); ctx.moveTo(x + 6, y + 8); ctx.lineTo(x + 16, y + 18); ctx.moveTo(x + 28, y + 6); ctx.lineTo(x + 36, y + 14); ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center';
    ctx.fillText(`❄ ${(left / 1000).toFixed(1)}`, p.x, y - 4);
    ctx.restore();
  }

  function drawStars(p, now) {
    // Dizzy stars orbiting the head while stunned.
    ctx.save(); ctx.fillStyle = '#ffed6b'; ctx.font = 'bold 15px Arial'; ctx.textAlign = 'center';
    for (let k = 0; k < 3; k++) {
      const a = now / 160 + k * Math.PI * 2 / 3;
      ctx.fillText('★', p.x + Math.cos(a) * 18, p.y - 36 + Math.sin(a) * 5);
    }
    ctx.restore();
  }

  // Server events become visual effects here; sounds are played in app.js.
  function event(e) {
    const mine = e.username === me;
    if (e.type === 'collect') {
      const x = e.gemX ?? e.x, y = e.gemY ?? e.y, colour = GEM_COLOURS[e.color];
      burst(x, y, colour, e.points >= 5 ? 26 : 14, e.points >= 5 ? 200 : 150);
      bursts.push({ time: e.time, x, y, label: `+${e.points}`, colour });
      // Celebrate streak milestones only, to keep the arena readable.
      if (mine && (e.streak === 3 || e.streak % 5 === 0)) banner(`🔥 ${e.streak} gems in a row!`, '#b9ffad', 1300);
    } else if (e.type === 'fire') {
      burst(e.x, e.y, '#ff7a1a', 22, 190, 5); burst(e.x, e.y, '#ffd36b', 10, 120);
      bursts.push({ time: e.time, x: e.x, y: e.y, label: e.lost ? `−${e.lost}  OUCH!` : 'OUCH!', colour: '#ffb5a3' });
      if (mine) shakeUntil = performance.now() + 350;
    } else if (e.type === 'power' && e.kind === 'boots') {
      burst(e.x, e.y, '#ffe39a', 18, 160);
      bursts.push({ time: e.time, x: e.x, y: e.y, label: 'SPEED BOOTS!', colour: '#ffe39a' });
    } else if (e.type === 'power' && e.kind === 'ice') {
      burst(e.x, e.y, '#b7f8ff', 12, 140);
      if (e.blocked) bursts.push({ time: e.time, x: e.targetX, y: e.targetY, label: 'IMMUNE!', colour: '#ff9cf0' });
      else {
        burst(e.targetX, e.targetY, '#d8fbff', 26, 180, 5);
        bursts.push({ time: e.time, x: e.targetX, y: e.targetY, label: 'FROZEN!', colour: '#b7f8ff' });
      }
    } else if (e.type === 'wave') {
      banner('🔥 Another fire joins the glade!', '#ffb08a');
    } else if (e.type === 'frenzy') {
      banner('💎 GEM FRENZY! Final 20 seconds', '#ffe066', 2600);
    } else if (e.type === 'cheat' && mine) {
      burst(e.x, e.y, e.enabled ? '#ff3cdc' : '#cccccc', 24, 170);
    }
  }

  return { ready, snapshot, reset, draw, event };
};
