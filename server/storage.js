'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const Characters = require('../public/scripts/characters');

// One serialized write queue per file. Publish the in-memory copy only after an
// atomic rename succeeds, so a failed disk write cannot masquerade as a save.
class JsonFile {
  constructor(filename, initial, validate) {
    this.filename = filename;
    this.initial = initial;
    this.validate = validate;
    this.tail = Promise.resolve();
  }
  async open() {
    await fs.mkdir(path.dirname(this.filename), { recursive: true });
    try {
      this.value = JSON.parse(await fs.readFile(this.filename, 'utf8'));
      if (!this.validate(this.value)) throw new Error('invalid data structure');
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Cannot read ${this.filename}: ${error.message}. Original file preserved.`);
      this.value = structuredClone(this.initial);
      await this.write(this.value);
    }
    return this;
  }
  async write(value) {
    const temporary = `${this.filename}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    await fs.rename(temporary, this.filename);
  }
  update(change) {
    const job = this.tail.then(async () => {
      const copy = structuredClone(this.value);
      const result = change(copy);
      await this.write(copy);
      this.value = copy;
      return result;
    });
    this.tail = job.catch(() => {});
    return job;
  }
}

async function openStorage(directory) {
  const accounts = await new JsonFile(path.join(directory, 'accounts.json'), [],
    value => Array.isArray(value) && value.every(u => u && typeof u.username === 'string' && typeof u.passwordHash === 'string' && typeof u.name === 'string' && (u.avatar == null || typeof u.avatar === 'string')) && new Set(value.map(u => u.username)).size === value.length).open();
  const rankings = await new JsonFile(path.join(directory, 'leaderboard.json'), { records: [], completed: [] },
    value => value && Array.isArray(value.records) && Array.isArray(value.completed) && value.completed.every(x => typeof x === 'string') && value.records.every(r => r && typeof r.username === 'string' && typeof r.name === 'string' && (r.avatar == null || typeof r.avatar === 'string') && Number.isInteger(r.bestScore) && r.bestScore >= 0 && Number.isInteger(r.wins) && r.wins >= 0)).open();
  const publicUser = user => ({ username: user.username, name: user.name, avatar: Characters.idFor(user.avatar) });
  const sorted = () => rankings.value.records.slice().sort((a, b) => b.bestScore - a.bestScore || b.wins - a.wins || (a.username < b.username ? -1 : a.username > b.username ? 1 : 0))
    .map(r => ({ ...r, avatar: Characters.idFor(r.avatar), games: r.games || 0 }));
  const top = () => sorted().slice(0, 10);
  // All-time position (1-based) of every listed player, for the results page.
  const ranks = usernames => Object.fromEntries(usernames.map(u => [u, sorted().findIndex(r => r.username === u) + 1]));
  return {
    accounts, rankings, publicUser, top, ranks,
    total: () => rankings.value.records.length,
    find: username => accounts.value.find(u => u.username === username),
    register: user => accounts.update(users => {
      if (users.some(u => u.username === user.username)) throw Object.assign(new Error('That username is already registered.'), { status: 409 });
      users.push(user);
      return publicUser(user);
    }),
    record: result => rankings.update(data => {
      if (data.completed.includes(result.matchId)) return false;
      for (const player of result.players) {
        let row = data.records.find(r => r.username === player.username);
        if (!row) { row = { ...publicUser(player), bestScore: 0, wins: 0 }; data.records.push(row); }
        row.bestScore = Math.max(row.bestScore, player.score);
        row.games = (row.games || 0) + 1;
        if (result.winner === player.username) row.wins++;
      }
      data.completed.push(result.matchId);
      return true;
    })
  };
}
module.exports = { openStorage, JsonFile };
