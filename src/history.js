import fs from 'node:fs/promises';
import path from 'node:path';
// better-sqlite3 plutot que node:sqlite : ce dernier n'existe pas avant Node
// 22.5, ce qui rend le bot ininstallable sur un hebergeur bloque en Node 20.
// L'API utilisee ici est identique (prepare/run/get/all, exec, close), le
// portage se limite donc a cet import et a l'instanciation.
import Database from 'better-sqlite3';

import { config } from './config.js';
import { loadStore } from './store.js';
import { formatDateFr } from './time.js';

let database = null;
let databasePath = null;

function migrateSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS matches (
      player_key TEXT NOT NULL,
      player_label TEXT NOT NULL,
      puuid TEXT,
      match_id TEXT NOT NULL,
      queue_id INTEGER,
      queue_type TEXT,
      ended_at INTEGER,
      observed_at INTEGER NOT NULL,
      champion_name TEXT,
      kills INTEGER,
      deaths INTEGER,
      assists INTEGER,
      cs INTEGER,
      duration_sec INTEGER,
      win INTEGER,
      remake INTEGER,
      lp_delta INTEGER,
      lp_delta_games INTEGER,
      tier_after TEXT,
      rank_after TEXT,
      league_points_after INTEGER,
      ladder_after INTEGER,
      source TEXT NOT NULL DEFAULT 'live',
      PRIMARY KEY (player_key, match_id)
    );

    CREATE INDEX IF NOT EXISTS matches_player_ended_at
      ON matches (player_key, ended_at DESC);
    CREATE INDEX IF NOT EXISTS matches_ended_at
      ON matches (ended_at DESC);

    -- Trajectoire de rang : un releve par changement de position sur l'echelle.
    -- Riot n'expose aucun pic ni historique de rang, la seule facon d'en avoir
    -- un est de l'echantillonner soi-meme au fil du temps.
    CREATE TABLE IF NOT EXISTS rank_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_key TEXT NOT NULL,
      player_label TEXT,
      queue_id INTEGER NOT NULL,
      tier TEXT,
      rank TEXT,
      league_points INTEGER,
      ladder INTEGER NOT NULL,
      sampled_at INTEGER NOT NULL,
      -- 'auto'   : releve par le bot
      -- 'manual' : pic declare a la main, pour les rangs atteints avant le suivi
      source TEXT NOT NULL DEFAULT 'auto'
    );

    CREATE INDEX IF NOT EXISTS rank_samples_peak
      ON rank_samples (player_key, queue_id, ladder DESC);
    CREATE INDEX IF NOT EXISTS rank_samples_time
      ON rank_samples (player_key, queue_id, sampled_at DESC);

    -- Correspondance compte Riot -> membre Discord, pour pouvoir mentionner
    -- reellement le joueur concerne dans les annonces.
    CREATE TABLE IF NOT EXISTS player_links (
      player_key TEXT PRIMARY KEY,
      discord_id TEXT NOT NULL,
      linked_by TEXT,
      linked_at INTEGER NOT NULL
    );
  `);

  // Migration additive pour une base creee avant le stockage explicite de la
  // file. Les anciennes lignes viennent toutes de la file alors configuree.
  const columns = new Set(db.prepare('PRAGMA table_info(matches)').all().map((column) => column.name));
  if (!columns.has('queue_id')) db.exec('ALTER TABLE matches ADD COLUMN queue_id INTEGER');
  if (!columns.has('queue_type')) db.exec('ALTER TABLE matches ADD COLUMN queue_type TEXT');
  db.prepare('UPDATE matches SET queue_id = ?, queue_type = ? WHERE queue_id IS NULL').run(
    config.queueId,
    config.queue,
  );
}

async function openDatabase() {
  if (database && databasePath === config.historyPath) return database;
  if (database) database.close();

  await fs.mkdir(path.dirname(config.historyPath), { recursive: true });
  database = new Database(config.historyPath);
  databasePath = config.historyPath;
  migrateSchema(database);
  return database;
}

function migrateRecentLp(db, store) {
  const migrationKey = 'json_recent_lp_v1';
  const insert = db.prepare(`
    INSERT OR IGNORE INTO matches (
      player_key, player_label, puuid, match_id, queue_id, queue_type, observed_at,
      lp_delta, lp_delta_games, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'json_migration')
  `);

  let imported = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    // Le controle est dans la transaction : deux processus demarrant ensemble
    // (bot principal et --now) ne peuvent pas executer la migration deux fois.
    if (db.prepare('SELECT 1 FROM metadata WHERE key = ?').get(migrationKey)) {
      db.exec('COMMIT');
      return 0;
    }
    for (const [playerKey, state] of Object.entries(store.live ?? {})) {
      for (const sample of state.recentLp ?? []) {
        if (!sample?.id || !Number.isFinite(sample.delta)) continue;
        const result = insert.run(
          playerKey,
          playerKey.replace('#', ' #'),
          state.puuid ?? store.players?.[playerKey]?.puuid ?? null,
          sample.id,
          config.queueId,
          config.queue,
          Date.now(),
          sample.delta,
        );
        imported += Number(result.changes);
      }
    }
    db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)').run(
      migrationKey,
      JSON.stringify({ completedAt: new Date().toISOString(), imported }),
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return imported;
}

/**
 * Amorce la trajectoire de rang avec les positions deja enregistrees dans les
 * parties archivees, pour ne pas repartir de zero alors que la donnee existe.
 */
function migrateLadderSamples(db) {
  const migrationKey = 'rank_samples_from_matches_v1';
  let imported = 0;

  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare('SELECT 1 FROM metadata WHERE key = ?').get(migrationKey)) {
      db.exec('COMMIT');
      return 0;
    }
    const rows = db.prepare(`
      SELECT player_key, player_label, queue_id, tier_after, rank_after,
             league_points_after, ladder_after, ended_at, observed_at
      FROM matches
      WHERE ladder_after IS NOT NULL
      ORDER BY COALESCE(ended_at, observed_at) ASC
    `).all();

    const insert = db.prepare(`
      INSERT INTO rank_samples
        (player_key, player_label, queue_id, tier, rank, league_points, ladder, sampled_at, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'auto')
    `);
    for (const row of rows) {
      insert.run(
        row.player_key,
        row.player_label,
        row.queue_id ?? config.queueId,
        row.tier_after,
        row.rank_after,
        row.league_points_after,
        row.ladder_after,
        row.ended_at ?? row.observed_at,
      );
      imported++;
    }
    db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)').run(
      migrationKey,
      JSON.stringify({ completedAt: new Date().toISOString(), imported }),
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return imported;
}

/** Cree la base et importe une seule fois les donnees encore presentes ailleurs. */
export async function initializeHistory(store = null) {
  const db = await openDatabase();
  const imported = migrateRecentLp(db, store ?? (await loadStore()));
  const samples = migrateLadderSamples(db);
  return { path: config.historyPath, imported, samples };
}

/**
 * Enregistre une position sur l'echelle.
 *
 * Les releves identiques au precedent sont ignores : sonder toutes les 3
 * minutes remplirait sinon la table de doublons, alors qu'on veut une
 * trajectoire, pas un journal de sondages. Une declaration manuelle est
 * toujours ecrite, puisqu'elle porte une date differente du releve courant.
 *
 * @returns {Promise<boolean>} true si un releve a ete ajoute.
 */
export async function recordRankSample({
  playerKey,
  playerLabel = null,
  entry,
  ladder,
  source = 'auto',
  sampledAt = Date.now(),
}) {
  if (!Number.isFinite(ladder)) return false;
  const db = await openDatabase();

  if (source === 'auto') {
    const dernier = db.prepare(`
      SELECT ladder FROM rank_samples
      WHERE player_key = ? AND queue_id = ? AND source = 'auto'
      ORDER BY sampled_at DESC LIMIT 1
    `).get(playerKey, config.queueId);
    if (dernier && dernier.ladder === ladder) return false;
  }

  db.prepare(`
    INSERT INTO rank_samples
      (player_key, player_label, queue_id, tier, rank, league_points, ladder, sampled_at, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    playerKey,
    playerLabel,
    config.queueId,
    entry?.tier ?? null,
    entry?.rank ?? null,
    entry?.leaguePoints ?? null,
    ladder,
    sampledAt,
    source,
  );
  return true;
}

/**
 * Meilleure position connue, releves automatiques et declarations manuelles
 * confondues. `null` tant qu'aucun releve n'existe pour ce joueur.
 */
export async function getPeak(playerKey) {
  const db = await openDatabase();
  const row = db.prepare(`
    SELECT tier, rank, league_points, ladder, sampled_at, source
    FROM rank_samples
    WHERE player_key = ? AND queue_id = ?
    ORDER BY ladder DESC, sampled_at ASC
    LIMIT 1
  `).get(playerKey, config.queueId);
  if (!row) return null;
  return {
    entry: { tier: row.tier, rank: row.rank, leaguePoints: row.league_points },
    ladder: row.ladder,
    sampledAt: row.sampled_at,
    manual: row.source === 'manual',
  };
}

const UPSERT_MATCH = `
  INSERT INTO matches (
    player_key, player_label, puuid, match_id, queue_id, queue_type, ended_at, observed_at,
    champion_name, kills, deaths, assists, cs, duration_sec, win, remake,
    lp_delta, lp_delta_games, tier_after, rank_after, league_points_after,
    ladder_after, source
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live')
  ON CONFLICT (player_key, match_id) DO UPDATE SET
    player_label = excluded.player_label,
    puuid = COALESCE(excluded.puuid, matches.puuid),
    queue_id = excluded.queue_id,
    queue_type = excluded.queue_type,
    ended_at = COALESCE(excluded.ended_at, matches.ended_at),
    champion_name = COALESCE(excluded.champion_name, matches.champion_name),
    kills = COALESCE(excluded.kills, matches.kills),
    deaths = COALESCE(excluded.deaths, matches.deaths),
    assists = COALESCE(excluded.assists, matches.assists),
    cs = COALESCE(excluded.cs, matches.cs),
    duration_sec = COALESCE(excluded.duration_sec, matches.duration_sec),
    win = COALESCE(excluded.win, matches.win),
    remake = COALESCE(excluded.remake, matches.remake),
    lp_delta = COALESCE(matches.lp_delta, excluded.lp_delta),
    lp_delta_games = COALESCE(matches.lp_delta_games, excluded.lp_delta_games),
    tier_after = COALESCE(matches.tier_after, excluded.tier_after),
    rank_after = COALESCE(matches.rank_after, excluded.rank_after),
    league_points_after = COALESCE(matches.league_points_after, excluded.league_points_after),
    ladder_after = COALESCE(matches.ladder_after, excluded.ladder_after),
    source = 'live'
`;

/**
 * Archive un lot avant d'avancer le curseur JSON. La cle composite rend un
 * second passage sans danger apres un redemarrage au milieu d'un cycle.
 * @returns {Promise<Set<string>>} cles joueur/match absentes avant ce passage.
 */
export async function archiveFinishedGames(records) {
  if (!records.length) return new Set();
  const db = await openDatabase();
  const exists = db.prepare('SELECT 1 FROM matches WHERE player_key = ? AND match_id = ?');
  const upsert = db.prepare(UPSERT_MATCH);
  const inserted = new Set();

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const record of records) {
      const { player, match, entry, delta, deltaGames } = record;
      const key = `${player.key}\u0000${match.matchId}`;
      if (!exists.get(player.key, match.matchId)) inserted.add(key);
      const hasMeasuredDelta = deltaGames > 0 && Number.isFinite(delta);
      const hasRankSnapshot = Boolean(record.rankSnapshot || hasMeasuredDelta);
      upsert.run(
        player.key,
        player.label,
        record.puuid ?? null,
        match.matchId,
        config.queueId,
        config.queue,
        Number.isFinite(match.endedAt) ? match.endedAt : null,
        Date.now(),
        match.championName ?? null,
        match.kills ?? null,
        match.deaths ?? null,
        match.assists ?? null,
        match.cs ?? null,
        match.durationSec ?? null,
        match.win == null ? null : Number(Boolean(match.win)),
        match.remake == null ? null : Number(Boolean(match.remake)),
        hasMeasuredDelta ? delta : null,
        hasMeasuredDelta ? deltaGames : null,
        hasRankSnapshot ? entry?.tier ?? null : null,
        hasRankSnapshot ? entry?.rank ?? null : null,
        hasRankSnapshot ? entry?.leaguePoints ?? null : null,
        hasRankSnapshot && Number.isFinite(record.ladder) ? record.ladder : null,
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return inserted;
}

/** Variations connues, sans plafond de 30 parties. */
export async function getLpDeltas(playerKey, matchIds) {
  if (!matchIds.length) return new Map();
  const db = await openDatabase();
  const find = db.prepare(
    'SELECT lp_delta, lp_delta_games FROM matches WHERE player_key = ? AND match_id = ? AND queue_id = ?',
  );
  const result = new Map();
  for (const matchId of matchIds) {
    const row = find.get(playerKey, matchId, config.queueId);
    // Un delta mesure sur plusieurs parties est conserve pour les futurs
    // agregats, mais ne doit pas etre presente comme celui d'une seule partie.
    if (row?.lp_delta_games === 1 && Number.isFinite(row.lp_delta)) result.set(matchId, row.lp_delta);
  }
  return result;
}

function matchFromRow(row) {
  return {
    matchId: row.match_id,
    endedAt: row.ended_at,
    championName: row.champion_name,
    kills: row.kills,
    deaths: row.deaths,
    assists: row.assists,
    cs: row.cs,
    durationSec: row.duration_sec,
    win: row.win == null ? null : Boolean(row.win),
    remake: row.remake == null ? null : Boolean(row.remake),
    lpDelta: row.lp_delta_games === 1 ? row.lp_delta ?? undefined : undefined,
  };
}

/** Donnees archivees d'un joueur sur un seul jour local. */
export async function getArchivedDay(playerKey, startMs, endMs) {
  const db = await openDatabase();
  const rows = db.prepare(`
    SELECT * FROM matches
    WHERE player_key = ? AND queue_id = ? AND ended_at >= ? AND ended_at < ?
    ORDER BY ended_at DESC
  `).all(playerKey, config.queueId, startMs, endMs);

  const rank = db.prepare(`
    SELECT tier_after, rank_after, league_points_after
    FROM matches
    WHERE player_key = ? AND queue_id = ? AND ended_at < ? AND tier_after IS NOT NULL
    ORDER BY ended_at DESC
    LIMIT 1
  `).get(playerKey, config.queueId, endMs);

  const measured = db.prepare(`
    SELECT SUM(lp_delta) AS delta, SUM(lp_delta_games) AS games
    FROM matches
    WHERE player_key = ? AND queue_id = ? AND ended_at >= ? AND ended_at < ? AND lp_delta IS NOT NULL
  `).get(playerKey, config.queueId, startMs, endMs);

  return {
    matches: rows.map(matchFromRow),
    entry: rank
      ? {
          tier: rank.tier_after,
          rank: rank.rank_after,
          leaguePoints: rank.league_points_after,
        }
      : null,
    delta: Number.isFinite(measured?.delta) ? measured.delta : undefined,
    measuredGames: Number(measured?.games ?? 0),
  };
}

/** Dates ayant au moins une partie archivee, de la plus recente a la plus ancienne. */
export async function listArchivedDates(playerKey = null, limit = 25) {
  const db = await openDatabase();
  const rows = playerKey
    ? db.prepare(`
        SELECT ended_at FROM matches
        WHERE player_key = ? AND queue_id = ? AND ended_at IS NOT NULL
        ORDER BY ended_at DESC
        LIMIT 5000
      `).all(playerKey, config.queueId)
    : db.prepare(`
        SELECT ended_at FROM matches
        WHERE queue_id = ? AND ended_at IS NOT NULL
        ORDER BY ended_at DESC
        LIMIT 5000
      `).all(config.queueId);

  const dates = [];
  const seen = new Set();
  for (const row of rows) {
    const label = formatDateFr(new Date(row.ended_at), config.timezone);
    if (seen.has(label)) continue;
    seen.add(label);
    dates.push(label);
    if (dates.length >= limit) break;
  }
  return dates;
}

export async function hasHistoryMarker(key) {
  const db = await openDatabase();
  return Boolean(db.prepare('SELECT 1 FROM metadata WHERE key = ?').get(key));
}

export async function setHistoryMarker(key, value = {}) {
  const db = await openDatabase();
  db.prepare(`
    INSERT INTO metadata (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value
  `).run(key, JSON.stringify(value));
}

/**
 * Agregats de la journee, tous joueurs confondus.
 *
 * Calcules sur les parties archivees, donc sur ce que le bot a reellement
 * observe : une partie jouee pendant un arret du bot n'y figure pas.
 */
export async function getDayTotals(startMs, endMs) {
  const db = await openDatabase();
  const rows = db.prepare(`
    SELECT player_key, player_label, win, remake, duration_sec, kills, deaths, assists
    FROM matches
    WHERE queue_id = ? AND ended_at >= ? AND ended_at < ?
    ORDER BY player_key, ended_at ASC
  `).all(config.queueId, startMs, endMs);

  let games = 0;
  let seconds = 0;
  const parJoueur = new Map();

  for (const row of rows) {
    if (row.remake) continue; // un remake n'a pas compte au classement
    games++;
    seconds += row.duration_sec ?? 0;

    const stats = parJoueur.get(row.player_key) ?? {
      label: row.player_label,
      wins: 0,
      losses: 0,
      // Series les plus longues de la journee, et non series en cours.
      bestWin: 0,
      bestLoss: 0,
      currentWin: 0,
      currentLoss: 0,
      games: 0,
      kills: 0,
      deaths: 0,
      assists: 0,
    };
    stats.games++;
    stats.kills += row.kills ?? 0;
    stats.deaths += row.deaths ?? 0;
    stats.assists += row.assists ?? 0;
    if (row.win) {
      stats.wins++;
      stats.currentWin++;
      stats.currentLoss = 0;
      stats.bestWin = Math.max(stats.bestWin, stats.currentWin);
    } else {
      stats.losses++;
      stats.currentLoss++;
      stats.currentWin = 0;
      stats.bestLoss = Math.max(stats.bestLoss, stats.currentLoss);
    }
    parJoueur.set(row.player_key, stats);
  }

  const meilleure = (champ) =>
    [...parJoueur.entries()]
      .map(([key, s]) => ({ key, label: s.label, longueur: s[champ] }))
      .filter((s) => s.longueur >= 2)
      .sort((a, b) => b.longueur - a.longueur)[0] ?? null;

  const liste = [...parJoueur.entries()].map(([key, s]) => ({
    key,
    label: s.label,
    games: s.games,
    kills: s.kills,
    deaths: s.deaths,
    assists: s.assists,
    // Une mort de moins ne doit pas valoir un KDA infini : sans mort, on
    // compte comme s'il y en avait eu une, convention usuelle du "KDA parfait".
    kda: (s.kills + s.assists) / Math.max(1, s.deaths),
  }));
  const top = (compare) => (liste.length ? liste.reduce(compare) : null);

  return {
    games,
    seconds,
    joueurs: parJoueur.size,
    meilleureSerieVictoires: meilleure('bestWin'),
    meilleureSerieDefaites: meilleure('bestLoss'),
    plusDeParties: top((a, b) => (b.games > a.games ? b : a)),
    meilleurKda: top((a, b) => (b.kda > a.kda ? b : a)),
    plusDeMorts: top((a, b) => (b.deaths > a.deaths ? b : a)),
  };
}

/** Associe un joueur suivi a un membre Discord. Remplace une liaison existante. */
export async function setPlayerLink(playerKey, discordId, linkedBy = null) {
  const db = await openDatabase();
  db.prepare(`
    INSERT INTO player_links (player_key, discord_id, linked_by, linked_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (player_key) DO UPDATE SET
      discord_id = excluded.discord_id,
      linked_by = excluded.linked_by,
      linked_at = excluded.linked_at
  `).run(playerKey, discordId, linkedBy, Date.now());
}

/** @returns {Promise<boolean>} true si une liaison existait. */
export async function removePlayerLink(playerKey) {
  const db = await openDatabase();
  return Number(db.prepare('DELETE FROM player_links WHERE player_key = ?').run(playerKey).changes) > 0;
}

/** @returns {Promise<Map<string,string>>} cle joueur -> identifiant Discord. */
export async function getPlayerLinks() {
  const db = await openDatabase();
  return new Map(
    db.prepare('SELECT player_key, discord_id FROM player_links').all().map((r) => [r.player_key, r.discord_id]),
  );
}

export function closeHistory() {
  if (database) database.close();
  database = null;
  databasePath = null;
}
