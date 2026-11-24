'use strict';
// Express + the same HTTP server's Socket.IO follows the hand_game lab.
const express = require('express');
const { createServer } = require('node:http');
const { Server } = require('socket.io');
const path = require('node:path');
const { setupAuth } = require('./server/auth');
const { openStorage } = require('./server/storage');
const { Matchmaking } = require('./server/matchmaking');

async function createGameServer(options = {}) {
  const storage = await openStorage(options.dataDir || path.join(__dirname, 'data'));
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '8kb' }));
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    // Same-origin POSTs and cookies; also permit non-browser protocol tests.
    if (req.method === 'POST' && req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.headers.host) return res.status(403).json({ error: 'Use the same game server for this request.' }); }
      catch { return res.status(403).json({ error: 'Invalid origin.' }); }
    }
    next();
  });
  let manager;
  const sessions = setupAuth(app, storage, id => manager?.signout(id));
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    maxHttpBufferSize: 8192,
    allowRequest: (req, done) => {
      if (!req.headers.origin) return done(null, true);
      try { done(null, new URL(req.headers.origin).host === req.headers.host); }
      catch { done(null, false); }
    }
  });
  manager = new Matchmaking(io, storage, sessions, options);
  app.get('/leaderboard', (req, res) => res.json({ leaderboard: storage.top() }));
  app.get('/README.html', (req, res) => res.sendFile(path.join(__dirname, 'README.html')));
  app.get('/VERIFICATION.html', (req, res) => res.sendFile(path.join(__dirname, 'VERIFICATION.html')));
  app.get('/CREDITS.txt', (req, res) => res.sendFile(path.join(__dirname, 'CREDITS.txt')));
  app.use(express.static(path.join(__dirname, 'public')));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status || 500;
    if (status >= 500) console.error('Request failed:', error.message);
    res.status(status).json({ error: status >= 500 ? 'Server could not complete the request. Please try again.' : error.message });
  });
  return { app, httpServer, io, manager, storage,
    listen: (port = 8000, host = '0.0.0.0') => new Promise((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(port, host, () => { httpServer.removeListener('error', reject); resolve(httpServer.address()); });
    }),
    close: async () => { await manager.close(); await new Promise(resolve => io.close(resolve)); }
  };
}
if (require.main === module) {
  createGameServer().then(async server => {
    await server.listen(8000);
    console.log('Gem Rush Duel is ready at http://localhost:8000');
    const stop = async () => { await server.close(); process.exit(0); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { createGameServer };
