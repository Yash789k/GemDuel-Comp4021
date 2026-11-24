// The browser suite's private server supplies deterministic pickups in one rematch.
// Players still move, collect and fire through the normal UI and Socket.IO server.
const assert = require('node:assert/strict');

function observeCanvas() {
  const draw = CanvasRenderingContext2D.prototype.drawImage;
  window.drawnSprites = {};
  CanvasRenderingContext2D.prototype.drawImage = function(image, ...args) {
    if (image.src && this.canvas.id === 'arena') {
      const file = new URL(image.src).pathname.split('/').pop();
      const width = args.at(-2), height = args.at(-1);
      window.drawnSprites[file] = { width, height, smooth: this.imageSmoothingEnabled };
    }
    return draw.call(this, image, ...args);
  };
}

async function verifyPowerups(a, b, game, until) {
  const [shooter, rival] = game.players;
  // Keep the controlled pickup path free of unrelated random hazards.
  game.fires.length = 0;
  game.gems.length = 0;
  game.powers.length = 0;
  const time = Date.now();
  game.nextGemAt = game.nextPowerAt = time + 60000;
  function place(kind, x, y) {
    game.powers.push({ kind, id: 'test-' + kind + '-' + game.tick, x, y, radius: 14, expiresAt: time + 60000 });
  }
  const green = 'char-green.png', ember = 'char-ember.png';
  const drawn = (page, file) => page.evaluate(name => window.drawnSprites[name], file);
  for (const page of [a, b]) {
    await until(async () => (await drawn(page, green)) && (await drawn(page, ember)));
  }
  const normal = await drawn(a, ember);
  place('grapefruit', shooter.x + 80, shooter.y);
  place('laser', shooter.x + 145, shooter.y);
  await until(async () => (await drawn(a, 'grapefruit.png')) && (await drawn(b, 'laser.png')));
  const box = await a.locator('#arena').boundingBox();
  const mouseAt = (x, y) => a.mouse.move(box.x + box.width * x / 854, box.y + box.height * y / 480);
  const startX = shooter.x, startY = shooter.y;
  await mouseAt(startX, startY - 10);
  await a.mouse.down();
  await mouseAt(startX + 95, startY);
  await until(() => shooter.growthUntil > Date.now());
  for (const page of [a, b]) {
    await until(async () => {
      const spr = await drawn(page, ember);
      return spr.width === normal.width * 2 && spr.height === normal.height * 2 && !spr.smooth;
    });
    assert.equal((await drawn(page, green)).width, normal.width);
  }
  const reachProbe = id => ({ id, color: 'green', x: shooter.x, y: shooter.y + 52, radius: 12, expiresAt: time + 60000 });
  game.gems.push(reachProbe('grown-reach'));
  await until(() => shooter.stats.green > 0);
  const initialEnd = shooter.growthUntil;
  place('grapefruit', startX + 140, startY);
  await mouseAt(startX + 148, startY);
  await until(() => shooter.laserShots === 1 && shooter.growthUntil > initialEnd);
  await a.mouse.up();

  // The target changes position while the shot is in flight.
  await b.keyboard.down('w');
  await a.locator('#shoot-button').click();
  await until(() => game.projectiles.length === 1);
  const heading = game.projectiles[0].angle;
  await until(() => game.projectiles.length && Math.abs(heading - game.projectiles[0].angle) > .015);
  await b.keyboard.up('w');
  for (const page of [a, b]) await until(async () => !!await drawn(page, 'laser-bolt.png'));
  await b.locator('#vision-mask').waitFor({state:'visible'});
  assert.equal(await a.locator('#vision-mask').isVisible(), false);
  assert.equal(shooter.laserShots, 0);
  const locked = { x: rival.x, y: rival.y };
  await b.keyboard.down('d');
  await b.waitForTimeout(180);
  assert.deepEqual({ x: rival.x, y: rival.y }, locked);
  await until(() => rival.x > locked.x + 2);
  await b.keyboard.up('d');
  await b.locator('#vision-mask').waitFor({state:'hidden'});
  await until(async () => (await drawn(a, ember)).width === normal.width && (await drawn(b, ember)).width === normal.width);
  game.gems.push(reachProbe('normal-reach'));
  await a.waitForTimeout(120);
  assert.ok(game.gems.some(g => g.id === 'normal-reach'));
  // A shot across the longest side of the field misses before reaching the rival.
  shooter.x = 78;
  rival.x = 782;
  place('laser', shooter.x, shooter.y);
  await until(() => shooter.laserShots === 1);
  await a.keyboard.press('f');
  await until(() => game.projectiles.length === 1 && shooter.laserShots === 0);
  const previousVisionEnd = rival.visionUntil;
  await until(() => game.projectiles.length === 0);
  assert.equal(rival.visionUntil, previousVisionEnd);
  assert.equal(await b.locator('#vision-mask').isVisible(), false);
}

module.exports = { observeCanvas, verifyPowerups };
