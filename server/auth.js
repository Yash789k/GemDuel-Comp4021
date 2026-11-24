'use strict';
const argon2 = require('argon2');
const session = require('express-session');
const { randomBytes } = require('node:crypto');
// Each avatar is also the player's in-game character (public/assets/characters).
const Characters = require('../public/scripts/characters');
const AVATARS = Object.keys(Characters.names);

// Adapted from game_room/game_server.js: same routes, Argon2 and session flow.
// Passwords are deliberately neither trimmed nor logged.
function validateRegistration(body) {
  if (!body || !/^[A-Za-z0-9_]{3,20}$/.test(typeof body.username === 'string' ? body.username : '')) return 'Username must be 3–20 letters, numbers or underscores.';
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 24) return 'Display name must be 1–24 characters.';
  if (!AVATARS.includes(body.avatar)) return 'Choose an approved avatar.';
  if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) return 'Password must be 8–128 characters.';
  if (body.confirmPassword !== body.password) return 'Passwords do not match.';
  return null;
}

function setupAuth(app, storage, onSignout) {
  const store = new session.MemoryStore();
  const sessions = session({
    store,
    name: 'gemrush.sid', secret: process.env.SESSION_SECRET || randomBytes(32).toString('hex'),
    resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 24 * 60 * 60 * 1000 }
  });
  sessions.store = store;
  app.use(sessions);
  app.use(['/register', '/signin', '/validate', '/signout'], (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  // Small, bounded limiter for costly password operations; no third-party service.
  const attempts = new Map();
  const limit = (req, res, next) => {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    const entry = attempts.get(req.ip) || { count: 0, until: now + 60000 };
    entry.count++;
    attempts.set(req.ip, entry);
    if (entry.count > 40 || attempts.size > 10000) return res.status(429).json({ error: 'Too many attempts. Please wait a minute.' });
    next();
  };
  app.post('/register', limit, async (req, res) => {
    const error = validateRegistration(req.body);
    if (error) return res.status(400).json({ error });
    const { username, name, avatar, password } = req.body;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await storage.register({ username: username.toLowerCase(), name: name.trim(), avatar, passwordHash });
    res.status(201).json({ success: true });
  });
  app.post('/signin', limit, async (req, res) => {
    const { username, password } = req.body || {};
    const user = typeof username === 'string' ? storage.find(username.toLowerCase()) : null;
    if (typeof password !== 'string' || password.length < 8 || password.length > 128 || !user || !await argon2.verify(user.passwordHash, password)) return res.status(401).json({ error: 'Incorrect username or password.' });
    // Invalidate sockets attached to the old session before switching identity.
    if (req.session.user) onSignout(req.sessionID);
    await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    req.session.user = storage.publicUser(user);
    await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
    res.json({ user: req.session.user });
  });
  app.get('/validate', (req, res) => res.json({ user: req.session.user || null }));
  app.post('/signout', async (req, res) => {
    onSignout(req.sessionID);
    await new Promise((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
    res.clearCookie('gemrush.sid').json({ success: true });
  });
  return sessions;
}
module.exports = { setupAuth, validateRegistration, AVATARS };
