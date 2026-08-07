import { config, parsePlayerId } from './config.js';
import { getAccount, getLeagueEntries, getMatchIds, getMatchResult, getSummoner } from './riot.js';
import { profileIconUrl } from './ddragon.js';
import { ladderPoints } from './rank.js';
import { loadStore, updateStore } from './store.js';
import { formatDateFr, parseDateFr, startOfDay } from './time.js';
import { getArchivedDay, getLpDeltas, getPeak, recordRankSample } from './history.js';

/**
 * Compte les parties jouees depuis le dernier releve.
 *
 * Source principale : le delta des compteurs wins/losses de l'entree classee.
 * C'est exact, gratuit (l'appel a deja ete fait) et parfaitement aligne avec
 * la file dont on suit les LP.
 *
 * Repli : l'historique de parties, utilise quand les compteurs reculent
 * (reset de split/saison) ou qu'il n'y a pas encore de releve precedent.
 */
async function countGames(puuid, previous, current, now) {
  if (Number.isFinite(previous?.wins) && Number.isFinite(current.wins)) {
    const wins = current.wins - previous.wins;
    const losses = current.losses - previous.losses;
    if (wins >= 0 && losses >= 0) {
      return { wins, losses, total: wins + losses, source: 'ladder' };
    }
  }

  const since = previous?.takenAt ? Date.parse(previous.takenAt) : startOfDay(now, config.timezone);
  const ids = await getMatchIds(puuid, since);

  let wins = 0;
  let losses = 0;
  for (const id of ids) {
    const result = await getMatchResult(id, puuid);
    if (!result || result.remake) continue; // un remake ne compte pas au classement
    if (result.win) wins++;
    else losses++;
  }
  return { wins, losses, total: wins + losses, source: 'history', truncated: ids.length >= 100 };
}

/**
 * Icone de profil du joueur. Purement decorative : une panne du CDN ou de
 * Summoner-V4 ne doit jamais empecher le resume de partir.
 */
async function fetchIconUrl(puuid) {
  try {
    const summoner = await getSummoner(puuid);
    return await profileIconUrl(summoner?.profileIconId);
  } catch (err) {
    console.warn(`[icone] indisponible (${err.message})`);
    return null;
  }
}

async function collectPlayer(player, store, now) {
  const previous = store.players[player.key] ?? null;
  // gameName / tagLine sont conserves pour construire le lien op.gg au rendu.
  const base = { key: player.key, label: player.label, gameName: player.gameName, tagLine: player.tagLine };

  try {
    // Le puuid est stable : on ne le resout qu'une fois, puis on le met en cache.
    let puuid = previous?.puuid;
    if (!puuid) {
      const account = await getAccount(player.gameName, player.tagLine);
      if (!account) return { ...base, error: `Compte Riot "${player.label}" introuvable` };
      puuid = account.puuid;
    }

    const entries = await getLeagueEntries(puuid);
    const entry = entries.find((e) => e.queueType === config.queue) ?? null;

    const snapshot = {
      puuid,
      takenAt: now.toISOString(),
      tier: entry?.tier ?? null,
      rank: entry?.rank ?? null,
      leaguePoints: entry?.leaguePoints ?? null,
      wins: entry?.wins ?? null,
      losses: entry?.losses ?? null,
      ladder: ladderPoints(entry),
    };

    // Alimente la trajectoire de rang a chaque lecture du classement : c'est
    // la seule source possible du pic, Riot ne l'exposant nulle part. Purement
    // annexe, un echec ne doit pas faire echouer le resume.
    await recordRankSample({
      playerKey: player.key,
      playerLabel: player.label,
      entry,
      ladder: snapshot.ladder,
      sampledAt: now.getTime(),
    }).catch((err) => console.warn(`[pic] relevé impossible (${err.message})`));

    // On recalcule la position precedente depuis tier/rank/LP plutot que de
    // relire le champ `ladder` du fichier : celui-ci n'est qu'informatif et
    // deviendrait faux si la formule changeait ou si le fichier etait edite.
    const previousLadder = previous ? ladderPoints(previous) : null;
    const delta =
      Number.isFinite(previousLadder) && Number.isFinite(snapshot.ladder)
        ? snapshot.ladder - previousLadder
        : null;

    return {
      ...base,
      entry,
      snapshot,
      previous,
      delta,
      games: await countGames(puuid, previous, snapshot, now),
      iconUrl: await fetchIconUrl(puuid),
      // Lecture locale en SQLite : le resume quotidien peut donc l'afficher
      // pour tous les joueurs sans surcout d'appels Riot.
      peak: await getPeak(player.key).catch(() => null),
    };
  } catch (err) {
    // Un joueur en erreur ne doit pas faire sauter le resume des autres.
    return { ...base, error: err.message };
  }
}

/**
 * Construit le resume. N'ecrit rien : c'est `commitReport` qui deplace le point
 * de comparaison, et uniquement une fois le message reellement publie.
 */
function archivedStats(matches) {
  return matches.reduce(
    (stats, match) => {
      if (match.remake) return stats;
      stats.total++;
      if (match.win) stats.wins++;
      else stats.losses++;
      return stats;
    },
    { total: 0, wins: 0, losses: 0 },
  );
}

function selectedPeriod(dateInput) {
  const period = parseDateFr(dateInput, config.timezone);
  if (period.start > Date.now()) throw new Error('Impossible de demander un récapitulatif dans le futur');
  return period;
}

async function archivedPlayer(player, period, withMatches = false) {
  const archived = await getArchivedDay(player.key, period.start, period.end);
  const games = archivedStats(archived.matches);
  const base = {
    key: player.key,
    label: player.label,
    gameName: player.gameName,
    tagLine: player.tagLine,
    entry: archived.entry,
    rankUnknown: !archived.entry,
    delta: archived.delta,
    games,
    historical: true,
    measuredGames: archived.measuredGames,
  };
  return withMatches ? { ...base, matches: annotateStreaks(archived.matches) } : base;
}

export async function buildReport(dateInput = null) {
  if (dateInput) {
    const period = selectedPeriod(dateInput);
    const players = [];
    for (const player of config.players) players.push(await archivedPlayer(player, period));
    return {
      at: new Date(period.end - 1),
      dateLabel: period.label,
      comparedTo: null,
      historical: true,
      players,
    };
  }

  const store = await loadStore();
  const now = new Date();

  const players = [];
  for (const player of config.players) {
    players.push(await collectPlayer(player, store, now));
  }

  const comparedTo = players.find((p) => p.previous?.takenAt)?.previous?.takenAt ?? store.lastReportAt;

  return {
    at: now,
    dateLabel: formatDateFr(now, config.timezone),
    comparedTo: comparedTo ? new Date(comparedTo) : null,
    players,
  };
}

/**
 * Parties de la file suivie jouees depuis minuit local, de la plus recente a la
 * plus ancienne (ordre renvoye par Riot).
 * @param {number} limit plafond de detail : chaque partie coute un appel API.
 */
async function fetchTodayMatches(puuid, now, limit = 10) {
  const ids = await getMatchIds(puuid, startOfDay(now, config.timezone));
  const matches = [];
  for (const id of ids.slice(0, limit)) {
    const result = await getMatchResult(id, puuid);
    if (result) matches.push(result);
  }
  return { matches, truncated: ids.length > limit };
}

/**
 * Annote chaque partie du nombre de victoires consecutives a ce moment-la.
 *
 * @param {Array} matches de la plus recente a la plus ancienne (ordre Riot).
 * @param {number} seed serie deja en cours avant la plus ancienne partie de la
 *   liste. Vaut 0 pour une fenetre journaliere : une serie commencee la veille
 *   n'est alors pas comptee, ce qui reste coherent avec l'intitule "du jour".
 */
export function annotateStreaks(matches, seed = 0, lossSeed = 0) {
  let streak = seed;
  let lossStreak = lossSeed;
  for (let i = matches.length - 1; i >= 0; i--) {
    // Un remake ne casse aucune des deux series et n'en fait progresser aucune.
    if (!matches[i].remake) {
      if (matches[i].win) {
        streak += 1;
        lossStreak = 0;
      } else {
        lossStreak += 1;
        streak = 0;
      }
    }
    matches[i].streak = streak;
    matches[i].lossStreak = lossStreak;
  }
  return matches;
}

/**
 * Resume d'un seul joueur, enrichi du detail de ses parties du jour.
 *
 * @param {string} input soit la cle d'un joueur suivi, soit un Riot ID libre
 *   "Pseudo#TAG". Un joueur non suivi est consulte sans etre ajoute a PLAYERS
 *   ni ecrit dans le fichier d'instantanes : cette fonction ne persiste rien.
 */
export async function buildPlayerDetail(input, dateInput = null) {
  const player = config.players.find((p) => p.key === input) ?? parsePlayerId(input);

  if (dateInput) {
    const period = selectedPeriod(dateInput);
    const archived = await archivedPlayer(player, period, true);
    return {
      ...archived,
      player,
      at: new Date(period.end - 1),
      dateLabel: period.label,
      selectedDate: true,
      truncated: false,
      previous: null,
    };
  }

  const store = await loadStore();
  const now = new Date();
  const summary = await collectPlayer(player, store, now);

  const detail = {
    ...summary,
    player,
    at: now,
    dateLabel: formatDateFr(now, config.timezone),
    matches: [],
    truncated: false,
  };
  if (summary.error) return detail;

  const { matches, truncated } = await fetchTodayMatches(summary.snapshot.puuid, now);

  // Variations de LP relevees en direct par la surveillance. SQLite ne les
  // plafonne plus aux 30 dernieres parties ; Riot ne permet toujours pas de
  // recuperer a posteriori les parties passees pendant que le bot etait coupe.
  const releves = await getLpDeltas(player.key, matches.map((match) => match.matchId));
  for (const match of matches) match.lpDelta = releves.get(match.matchId);

  // Le pic ne remonte qu'au debut du suivi, sauf declaration manuelle.
  const peak = await getPeak(player.key).catch(() => null);

  return { ...detail, matches: annotateStreaks(matches), truncated, peak };
}

/**
 * Pose la reference de comparaison des joueurs qui n'en ont pas encore.
 *
 * Un joueur ajoute a PLAYERS entre deux resumes n'a aucun instantane : son
 * premier resume affiche alors "premiere mesure" au lieu d'une variation, alors
 * meme que le bot connait deja son rang. En posant la reference des son ajout,
 * le resume suivant montre sa progression depuis le debut du suivi.
 *
 * Ne s'execute qu'une fois par joueur, puisqu'il a ensuite un instantane.
 */
export async function primeDailySnapshots() {
  const store = await loadStore();
  const nouveaux = config.players.filter((player) => !store.players[player.key]);
  if (!nouveaux.length) return [];

  const now = new Date();
  const references = {};

  for (const player of nouveaux) {
    try {
      // Appels reseau hors du verrou d'ecriture du store.
      let puuid = store.live?.[player.key]?.puuid;
      if (!puuid) {
        const account = await getAccount(player.gameName, player.tagLine);
        if (!account) continue;
        puuid = account.puuid;
      }
      const entries = await getLeagueEntries(puuid);
      const entry = entries.find((e) => e.queueType === config.queue) ?? null;
      references[player.key] = {
        puuid,
        takenAt: now.toISOString(),
        tier: entry?.tier ?? null,
        rank: entry?.rank ?? null,
        leaguePoints: entry?.leaguePoints ?? null,
        wins: entry?.wins ?? null,
        losses: entry?.losses ?? null,
        ladder: ladderPoints(entry),
      };
    } catch (err) {
      console.warn(`[résumé] référence initiale de ${player.label} impossible (${err.message})`);
    }
  }

  const poses = Object.keys(references);
  if (poses.length) {
    await updateStore((s) => {
      s.players = { ...s.players, ...references };
    });
  }
  return poses;
}

/**
 * Fixe le nouveau point de comparaison.
 *
 * A n'appeler qu'apres publication reussie : enregistrer avant l'envoi ferait
 * disparaitre du diff toute la progression accumulee des qu'un envoi echoue
 * (salon inaccessible, coupure reseau), sans aucun message pour la montrer.
 */
export async function commitReport(report) {
  await updateStore((store) => {
    for (const player of report.players) {
      // Un joueur en erreur n'a pas d'instantane : on conserve le sien pour que
      // sa progression reapparaisse au prochain resume reussi.
      if (player.snapshot) store.players[player.key] = player.snapshot;
    }
    store.lastReportAt = report.at.toISOString();
  });
}
