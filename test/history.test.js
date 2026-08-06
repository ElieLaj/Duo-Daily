import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { config } from '../src/config.js';
import {
  archiveFinishedGames,
  closeHistory,
  getArchivedDay,
  getLpDeltas,
  initializeHistory,
  listArchivedDates,
} from '../src/history.js';

test('migre le JSON puis archive les parties sans doublon', async () => {
  const originalPath = config.historyPath;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-elo-history-'));
  config.historyPath = path.join(directory, 'history.sqlite');

  try {
    const store = {
      players: { 'Joueur#EUW': { puuid: 'puuid-1' } },
      live: {
        'Joueur#EUW': {
          puuid: 'puuid-1',
          recentLp: [{ id: 'EUW1_ancien', delta: -18 }],
        },
      },
    };

    assert.equal((await initializeHistory(store)).imported, 1);
    assert.equal((await initializeHistory(store)).imported, 0);
    assert.equal((await getLpDeltas('Joueur#EUW', ['EUW1_ancien'])).get('EUW1_ancien'), -18);

    const player = { key: 'Joueur#EUW', label: 'Joueur #EUW' };
    const entry = { tier: 'GOLD', rank: 'II', leaguePoints: 42 };
    const records = [
      {
        player,
        puuid: 'puuid-1',
        entry,
        ladder: 1342,
        delta: 24,
        deltaGames: 0,
        match: {
          matchId: 'EUW1_lot_1', endedAt: 1000, championName: 'Lux',
          kills: 2, deaths: 3, assists: 8, cs: 140, durationSec: 1800,
          win: false, remake: false,
        },
      },
      {
        player,
        puuid: 'puuid-1',
        entry,
        ladder: 1342,
        delta: 24,
        deltaGames: 2,
        match: {
          matchId: 'EUW1_lot_2', endedAt: 2000, championName: 'Ahri',
          kills: 9, deaths: 2, assists: 7, cs: 201, durationSec: 1900,
          win: true, remake: false,
        },
      },
    ];

    const first = await archiveFinishedGames(records);
    assert.equal(first.size, 2);
    assert.equal((await archiveFinishedGames(records)).size, 0);
    assert.equal((await getLpDeltas('Joueur#EUW', ['EUW1_lot_2'])).size, 0);

    const exact = structuredClone(records[1]);
    exact.match.matchId = 'EUW1_exact';
    exact.delta = 21;
    exact.deltaGames = 1;
    await archiveFinishedGames([exact]);
    assert.equal((await getLpDeltas('Joueur#EUW', ['EUW1_exact'])).get('EUW1_exact'), 21);

    closeHistory();
    const db = new DatabaseSync(config.historyPath, { readOnly: true });
    const row = db.prepare('SELECT * FROM matches WHERE match_id = ?').get('EUW1_lot_2');
    assert.equal(row.champion_name, 'Ahri');
    assert.equal(row.lp_delta, 24);
    assert.equal(row.lp_delta_games, 2);
    assert.equal(row.win, 1);
    assert.equal(row.queue_id, 420);
    assert.equal(db.prepare('SELECT count(*) AS count FROM matches').get().count, 4);
    db.close();

    const day = await getArchivedDay('Joueur#EUW', 0, 3000);
    assert.equal(day.matches.length, 3);
    assert.equal(day.delta, 45);
    assert.equal(day.measuredGames, 3);
    assert.equal(day.entry.tier, 'GOLD');
    assert.deepEqual(await listArchivedDates('Joueur#EUW'), ['01-01-1970']);
  } finally {
    closeHistory();
    config.historyPath = originalPath;
    await fs.rm(directory, { recursive: true, force: true });
  }
});
