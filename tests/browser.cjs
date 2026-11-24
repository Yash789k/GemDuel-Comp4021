'use strict';
// Optional browser QA. Uses an isolated data directory and real UI/keyboard input.
// Server state is observed for assertions/navigation, never modified by this test.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createGameServer } = require('../game_server');
let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
catch { console.error('Optional browser test needs Playwright: npm install --no-save playwright; npx playwright install chromium'); process.exit(1); }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return; await delay(50); }
  throw new Error('Browser assertion timed out');
}

(async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gemrush-browser-'));
  const output = path.resolve(__dirname, '../test-output'); await fs.mkdir(output, { recursive: true });
  const server = await createGameServer({ dataDir });
  const address = await server.listen(0, '127.0.0.1'); const base = `http://127.0.0.1:${address.port}`;
  let browser; const errors = [], failures = [], checks = [];
  const passed = label => { checks.push(label); console.log('PASS', label); };
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const contexts = await Promise.all([browser.newContext({ viewport: { width: 1366, height: 900 } }), browser.newContext({ viewport: { width: 1366, height: 900 } })]);
    const [a, b] = await Promise.all(contexts.map(context => context.newPage()));
    for (const page of [a, b]) {
      page.on('pageerror', e => errors.push(e.message));
      page.on('response', response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
      page.on('requestfailed', request => { if (!request.failure()?.errorText.includes('ABORTED')) failures.push(request.url()); });
    }
    await Promise.all([a.goto(base), b.goto(base)]);
    const audio = await a.evaluate(async () => {
      return Promise.all(['background.mp3', 'collect.mp3', 'gameover.mp3', 'fire-hit.wav', 'power-up.wav', 'countdown.mp3', 'go.mp3', 'freeze.mp3', 'cheat.mp3', 'win.mp3'].map(name => new Promise((resolve, reject) => {
        const sound = new Audio(`/assets/${name}`);
        const timer = setTimeout(() => reject(new Error(`Audio load timed out: ${name}`)), 5000);
        sound.oncanplay = () => { clearTimeout(timer); resolve({ name, duration: sound.duration }); };
        sound.onerror = () => { clearTimeout(timer); reject(new Error(`Audio decode failed: ${name}`)); };
        sound.load();
      })));
    });
    assert.ok(audio.every(sound => sound.duration > 0)); passed('all ten bundled audio files decode to playable media');
    await a.screenshot({ path: path.join(output, 'home.png'), fullPage: true });
    await a.locator('#rules-button').click(); assert.equal(await a.locator('#rules-dialog').isVisible(), true); await a.locator('#close-rules').click();
    async function register(page, username, name, avatar) {
      await page.locator('#register-tab').click();
      await page.locator('#register-username').fill(username); await page.locator('#register-name').fill(name);
      await page.locator(`label:has(input[value="${avatar}"])`).click();
      await page.locator('#register-password').fill('browser-password'); await page.locator('#register-confirm').fill('browser-password');
      await page.locator('#register-form button').click();
      await until(async () => (await page.locator('#auth-message').textContent()).includes('Account created'));
      await page.locator('#signin-password').fill('browser-password'); await page.locator('#signin-form button').click();
      await page.locator('#lobby-panel').waitFor({ state: 'visible' }); await until(() => page.locator('#find-button').isEnabled());
    }
    await register(a, 'browser_alice', 'Jade Runner', 'fox'); await register(b, 'browser_bob', 'Amber Scout', 'owl');
    await until(async () => await a.locator('#online-players li').count() === 2);
    await a.reload(); await a.locator('#lobby-panel').waitFor({ state: 'visible' }); await until(() => a.locator('#find-button').isEnabled());
    assert.equal(await a.locator('#my-name').textContent(), 'Jade Runner');
    passed('registration, avatar selection, sign-in, presence, rules and reload session');
    await a.locator('#find-button').click(); await a.locator('#cancel-button').waitFor({ state: 'visible' });
    await a.locator('#cancel-button').click(); await a.locator('#find-button').waitFor({ state: 'visible' });
    await a.locator('#find-button').click(); await b.locator('#find-button').click();
    await until(() => [...server.manager.matches.values()].some(g => g.phase === 'countdown'));
    const game = [...server.manager.matches.values()][0]; const originalX = game.players[0].x;
    await a.keyboard.press('d'); assert.equal(game.players[0].x, originalX);
    await until(() => game.phase === 'playing'); await a.locator('#arena-overlay').waitFor({ state: 'hidden' });
    assert.equal(await a.locator('#game-time').textContent(), await b.locator('#game-time').textContent());
    passed('FIFO pairing, cancellation, shared countdown and blocked pre-start movement');
    await a.keyboard.down('d'); await delay(300); await a.keyboard.up('d');
    assert.ok(game.player('browser_alice').x > originalX + 20);
    const bX = game.player('browser_bob').x; await b.keyboard.down('ArrowLeft'); await delay(220); await b.keyboard.up('ArrowLeft');
    assert.ok(game.player('browser_bob').x < bX);
    await a.keyboard.down('d'); await delay(100); await a.evaluate(() => window.dispatchEvent(new Event('blur')));
    const stopped = game.player('browser_alice').x; await delay(250); assert.ok(Math.abs(game.player('browser_alice').x - stopped) < 8); await a.keyboard.up('d');
    await a.keyboard.down('c'); await a.keyboard.down('c'); await delay(250); await a.keyboard.up('c');
    assert.equal(game.player('browser_alice').cheat, true); assert.equal(await b.locator('#player-zero .effects').textContent(), 'CHEAT MODE ON');
    await a.keyboard.press('c'); await delay(250); assert.equal(game.player('browser_alice').cheat, false);
    await a.keyboard.press('c'); await delay(250); assert.equal(game.player('browser_alice').cheat, true);
    await a.screenshot({ path: path.join(output, 'gameplay.png'), fullPage: true });
    await b.screenshot({ path: path.join(output, 'opponent.png'), fullPage: true });
    passed('WASD, arrow keys, blur clearing, C repeat suppression and cheat visibility in both browsers');
    const id = game.id, endAt = game.endAt; await a.reload(); await a.locator('#game-view').waitFor({ state: 'visible' });
    await until(() => game.player('browser_alice').connected);
    assert.equal(server.manager.membership.get('browser_alice').id, id); assert.equal(game.endAt, endAt);
    await a.locator('#mute-button').click(); const mute = await a.locator('#mute-button').textContent();
    await a.reload(); await a.locator('#game-view').waitFor({ state: 'visible' }); assert.equal(await a.locator('#mute-button').textContent(), mute);
    await a.locator('#mute-button').click();
    passed('active-match reload/reconnection and mute preference persistence');
    // Follow real server-spawned gems using keyboard commands only. There is no
    // score injection, test route, teleport, synthetic pickup or instant-win hook.
    const held = new Set();
    async function steer(x, y) {
      const wanted = new Set([...(x < -8 ? ['a'] : x > 8 ? ['d'] : []), ...(y < -8 ? ['w'] : y > 8 ? ['s'] : [])]);
      for (const key of [...held]) if (!wanted.has(key)) { await a.keyboard.up(key); held.delete(key); }
      for (const key of wanted) if (!held.has(key)) { await a.keyboard.down(key); held.add(key); }
    }
    const start = Date.now();
    while (game.phase === 'playing' && Date.now() - start < 65000) {
      const p = game.player('browser_alice');
      const candidates = game.gems.slice().sort((x, y) => Math.hypot(x.x - p.x, x.y - p.y) - Math.hypot(y.x - p.x, y.y - p.y));
      if (candidates[0]) await steer(candidates[0].x - p.x, candidates[0].y - p.y); else await steer(0, 0);
      await delay(60);
    }
    await steer(0, 0); assert.equal(game.phase, 'finished'); assert.equal(game.result.reason, 'target'); assert.equal(game.result.winner, 'browser_alice');
    await a.locator('#results-view').waitFor({ state: 'visible' }); await b.locator('#results-view').waitFor({ state: 'visible' });
    assert.equal(await a.locator('#result-title').textContent(), 'You win!'); assert.equal(await b.locator('#result-title').textContent(), 'Good duel.');
    assert.ok(game.result.players[0].score >= 50); assert.equal(await a.locator('#stats-body tr').count(), 17);
    assert.equal(await a.locator('#leaderboard li').count(), 2);
    assert.equal(await a.locator('#stats-body').textContent(), await b.locator('#stats-body').textContent());
    await a.screenshot({ path: path.join(output, 'results.png'), fullPage: true });
    passed(`real gem collection to target win (${game.result.players[0].score} points), shared statistics and saved leaderboard`);
    await a.locator('#rematch-button').click(); await until(async () => (await a.locator('#rematch-status').textContent()).includes('Waiting for opponent'));
    await b.locator('#rematch-button').click(); await until(() => server.manager.membership.get('browser_alice')?.phase === 'playing');
    const rematch = server.manager.membership.get('browser_alice'); assert.notEqual(rematch.id, game.id);
    assert.equal(rematch.players[0].score, 0); assert.equal(rematch.players[0].cheat, false); assert.equal(rematch.players[0].stats.gems, 0);
    await a.locator('#leave-button').click(); await a.locator('#results-view').waitFor({ state: 'visible' }); await b.locator('#results-view').waitFor({ state: 'visible' });
    assert.equal(rematch.result.reason, 'leave'); assert.equal(rematch.result.winner, 'browser_bob');
    // A second rematch exercises the same listeners and animation loop again.
    await a.locator('#rematch-button').click(); await b.locator('#rematch-button').click();
    await until(() => server.manager.membership.get('browser_alice')?.phase === 'playing');
    const third = server.manager.membership.get('browser_alice'); assert.notEqual(third.id, rematch.id);
    await a.keyboard.press('c'); await until(() => third.player('browser_alice').cheat);
    await delay(250); assert.equal(third.player('browser_alice').cheat, true);
    await b.locator('#leave-button').click(); await a.locator('#results-view').waitFor({ state: 'visible' });
    await a.locator('#rematch-button').click(); await b.locator('#home-button').click(); await b.locator('#lobby-panel').waitFor({ state: 'visible' });
    await until(() => a.locator('#rematch-button').isDisabled());
    await a.locator('#home-button').click(); await a.locator('#lobby-panel').waitFor({ state: 'visible' });
    await a.locator('#signout-button').click(); await a.locator('#auth-panel').waitFor({ state: 'visible' });
    assert.equal(await a.locator('#notice').isVisible(), false);
    passed('two rematches, fresh state, immediate forfeits, rematch cancellation, home and sign-out');
    await a.setViewportSize({ width: 1280, height: 720 });
    await a.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await a.screenshot({ path: path.join(output, 'laptop.png'), fullPage: true });
    await a.setViewportSize({ width: 390, height: 844 });
    await a.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await a.screenshot({ path: path.join(output, 'narrow.png'), fullPage: true });
    passed('laptop and narrow layout without horizontal overflow');
    assert.deepEqual(errors, []); assert.deepEqual(failures, []);
    passed('all resources loaded; no uncaught browser errors or failed HTTP resources');
    await fs.writeFile(path.join(output, 'browser-results.json'), JSON.stringify({ passed: true, checks, errors, failures }, null, 2));
  } catch (error) {
    await fs.writeFile(path.join(output, 'browser-results.json'), JSON.stringify({ passed: false, checks, error: error.stack, errors, failures }, null, 2));
    throw error;
  } finally { await browser?.close(); await server.close(); await fs.rm(dataDir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
