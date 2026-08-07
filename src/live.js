import { config } from './config.js';
import { getAccount, getLeagueEntries, getMatchIds, getMatchResult } from './riot.js';
import { divisionIndex, ladderPoints, rankLabel } from './rank.js';
import { loadStore, updateStore } from './store.js';
import { archiveFinishedGames, hasHistoryMarker, recordRankSample, setHistoryMarker } from './history.js';
import { formatDateFr, startOfDay } from './time.js';

/**
 * Surveillance des parties terminees.
 *
 * Interroge periodiquement l'historique de chaque joueur suivi et signale les
 * parties apparues depuis le dernier passage.
 *
 * L'etat vit dans `store.live`, strictement separe de `store.players` qui porte
 * le point de comparaison du resume quotidien : cette boucle ne doit jamais
 * decaler le delta de LP que le resume du soir doit encore afficher.
 */

// Fenetre de recherche : au-dela, une partie est trop ancienne pour etre
// annoncee comme "vient de se terminer" (bot arrete plusieurs heures).
const LOOKBACK_MS = 6 * 3600 * 1000;

// Plafond d'annonces par joueur et par passage, pour qu'un rattrapage apres une
// longue coupure ne deverse pas dix messages d'un coup.
const MAX_ANNOUNCES = 3;

/** Etat live d'un joueur, jamais melange aux instantanes du resume quotidien. */
function liveStateOf(store, key) {
  return store.live?.[key] ?? null;
}

/**
 * Cherche les parties terminees depuis le dernier passage.
 * @returns {Promise<Array>} les parties a annoncer, de la plus ancienne a la
 *   plus recente ; vide au premier passage (on se contente de memoriser le
 *   point de depart pour ne pas annoncer un historique deja ancien).
 */
async function pollPlayer(player, store) {
  const previous = liveStateOf(store, player.key);

  // Un joueur tout juste ajoute a PLAYERS n'a encore ni etat live ni instantane
  // quotidien : on resout son puuid une fois, puis on le met en cache. Sans ça
  // il resterait invisible jusqu'au prochain resume quotidien.
  let puuid = previous?.puuid ?? store.players?.[player.key]?.puuid;
  if (!puuid) {
    const account = await getAccount(player.gameName, player.tagLine);
    if (!account) return { announces: [], state: previous };
    puuid = account.puuid;
  }

  // Un appel peut retourner jusqu'a 100 IDs au meme cout. Le plafond de trois
  // ne concerne que les messages Discord, pas les donnees a conserver.
  const ids = await getMatchIds(puuid, Date.now() - LOOKBACK_MS, 100);

  // "Deja amorce" : au moins un passage a eu lieu pour ce joueur. Le repli sur
  // lastMatchId couvre les etats ecrits avant l'introduction du drapeau.
  const primed = Boolean(previous?.primed || previous?.lastMatchId);
  const state = { ...previous, puuid, primed: true, checkedAt: new Date().toISOString() };

  // Riot renvoie du plus recent au plus ancien.
  const seenIndex = previous?.lastMatchId ? ids.indexOf(previous.lastMatchId) : -1;
  const fresh = seenIndex >= 0 ? ids.slice(0, seenIndex) : ids;
  const positionBouge = ids.length > 0 && ids[0] !== previous?.lastMatchId;

  // Rien de neuf : ni relecture du rang, ni ecriture. C'est le cas courant.
  if (!positionBouge && primed) return { announces: [], state };

  // Le rang est relu AU MEME INSTANT que la position dans l'historique. Les
  // relever separement laisse une fenetre pendant laquelle des parties non
  // annoncees font varier les LP : leur variation serait ensuite absorbee par
  // la premiere partie annoncee, qui afficherait un chiffre couvrant plus
  // qu'elle-meme (une defaite pouvant ainsi afficher un gain).
  const entries = await getLeagueEntries(puuid);
  const entry = entries.find((e) => e.queueType === config.queue) ?? null;
  const ladder = ladderPoints(entry);
  const delta = Number.isFinite(previous?.ladder) && Number.isFinite(ladder) ? ladder - previous.ladder : null;

  // Trajectoire de rang : c'est ici qu'elle est la plus fine, puisque le rang
  // est relu exactement quand la position dans l'historique bouge.
  await recordRankSample({
    playerKey: player.key,
    playerLabel: player.label,
    entry,
    ladder,
  }).catch((err) => console.warn(`[pic] relevé impossible (${err.message})`));

  // Montee de rang : on compare les paliers, pas les LP. Le palier precedent
  // provient du meme releve que la reference de LP, donc la comparaison porte
  // bien sur l'intervalle annonce.
  const paliers = { avant: divisionIndex(previous ?? null), apres: divisionIndex(entry) };
  const promotion =
    Number.isFinite(paliers.avant) && Number.isFinite(paliers.apres) && paliers.apres > paliers.avant
      ? { depuis: rankLabel(previous), vers: rankLabel(entry) }
      : null;

  if (ids.length) state.lastMatchId = ids[0];
  state.ladder = ladder;
  state.tier = entry?.tier ?? null;
  state.rank = entry?.rank ?? null;
  state.leaguePoints = entry?.leaguePoints ?? null;

  // Premier passage : on memorise position et reference sans rien annoncer,
  // pour ne pas deverser un historique deja ancien.
  if (!primed || !fresh.length) return { announces: [], state };

  // Le plafond concerne Discord, pas l'historique : toute partie detectee est
  // chargee puis archivee, meme si seules les trois plus recentes sont postees.
  const toArchive = [...fresh].reverse(); // du plus ancien au plus recent
  const matches = [];
  for (const id of toArchive) {
    const result = await getMatchResult(id, puuid);
    if (result) matches.push(result);
  }
  if (!matches.length) return { announces: [], state };

  // La serie est cumulee dans l'etat persiste plutot que recalculee : elle
  // traverse ainsi les jours et les redemarrages, sans relire l'historique.
  let streak = previous?.streak ?? 0;
  for (const match of matches) {
    if (!match.remake) streak = match.win ? streak + 1 : 0;
    match.streak = streak;
  }
  state.streak = streak;

  const records = matches.map((match, index) => ({
    player,
    match,
    entry,
    puuid,
    ladder,
    delta,
    // Nombre de parties couvertes par `delta`. Le rang n'etant relu qu'une
    // fois par lot, la variation n'est portee que par la plus recente ; 0
    // signale les autres, qui ne peuvent revendiquer aucun chiffre.
    deltaGames: index === matches.length - 1 ? fresh.length : 0,
    // La promotion, comme la variation, n'est portee que par la plus recente.
    promotion: index === matches.length - 1 ? promotion : null,
    skipped: Math.max(0, matches.length - MAX_ANNOUNCES),
  }));

  return {
    records,
    announces: records.slice(-MAX_ANNOUNCES),
    state,
  };
}

/**
 * Un passage complet sur tous les joueurs suivis.
 * @returns {Promise<Array>} les parties a annoncer, tous joueurs confondus.
 */
export async function pollFinishedGames() {
  const store = await loadStore();
  const announces = [];
  const records = [];
  const states = {};

  for (const player of config.players) {
    try {
      const result = await pollPlayer(player, store);
      announces.push(...result.announces);
      records.push(...(result.records ?? []));
      if (result.state) states[player.key] = result.state;
    } catch (err) {
      // Un joueur en echec ne doit pas interrompre la surveillance des autres.
      console.warn(`[live] ${player.label} : ${err.message}`);
    }
  }

  // La base est commitee avant le curseur JSON. Une coupure entre les deux
  // rejouera le lot sans creer de doublon grace a la cle joueur/match.
  const inserted = await archiveFinishedGames(records);
  if (Object.keys(states).length) {
    await updateStore((s) => {
      s.live = { ...(s.live ?? {}), ...states };
    });
  }
  return announces.filter(({ player, match }) => inserted.has(`${player.key}\u0000${match.matchId}`));
}

/**
 * Premier demarrage SQLite : enrichit l'historique avec les parties du jour
 * deja franchies par le curseur JSON de l'ancienne version. Les parties plus
 * recentes que ce curseur restent au passage live normal, donc annoncables.
 */
export async function backfillTodayHistory() {
  const now = new Date();
  const dateLabel = formatDateFr(now, config.timezone);
  const marker = `backfill_day_${dateLabel}`;
  if (await hasHistoryMarker(marker)) return 0;

  const store = await loadStore();
  const records = [];
  let failures = 0;

  for (const player of config.players) {
    try {
      const previous = store.live?.[player.key] ?? null;
      let puuid = previous?.puuid ?? store.players?.[player.key]?.puuid;
      if (!puuid) {
        const account = await getAccount(player.gameName, player.tagLine);
        if (!account) continue;
        puuid = account.puuid;
      }

      const ids = await getMatchIds(puuid, startOfDay(now, config.timezone), 100);
      const cursorIndex = previous?.lastMatchId ? ids.indexOf(previous.lastMatchId) : -1;
      const archivedIds = cursorIndex >= 0 ? ids.slice(cursorIndex) : ids;
      if (!archivedIds.length) continue;

      const matches = [];
      for (const id of [...archivedIds].reverse()) {
        const match = await getMatchResult(id, puuid);
        if (match) matches.push(match);
      }

      const lpByMatch = new Map((previous?.recentLp ?? []).map((item) => [item.id, item.delta]));
      const canAttachCurrentRank = archivedIds[0] === ids[0];
      let entry = null;
      let ladder = null;
      if (canAttachCurrentRank) {
        const entries = await getLeagueEntries(puuid);
        entry = entries.find((item) => item.queueType === config.queue) ?? null;
        ladder = ladderPoints(entry);
      }

      matches.forEach((match, index) => {
        const savedDelta = lpByMatch.get(match.matchId);
        records.push({
          player,
          match,
          entry,
          puuid,
          ladder,
          delta: savedDelta,
          deltaGames: Number.isFinite(savedDelta) ? 1 : 0,
          rankSnapshot: canAttachCurrentRank && index === matches.length - 1,
        });
      });
    } catch (err) {
      failures++;
      console.warn(`[history] rattrapage de ${player.label} impossible (${err.message})`);
    }
  }

  await archiveFinishedGames(records);
  if (!failures) {
    await setHistoryMarker(marker, { completedAt: new Date().toISOString(), matches: records.length });
  }
  return records.length;
}

/**
 * Resout le puuid des joueurs qui n'en ont pas encore, au demarrage.
 *
 * La reference de LP n'est deliberement PAS amorcee ici : elle doit etre
 * relevee au meme instant que la position dans l'historique, ce dont se charge
 * le premier passage de `pollPlayer`. Reprendre celle d'un instantane
 * quotidien plus ancien creerait un decalage, et les parties jouees entre les
 * deux relevés verraient leur variation absorbee par la premiere annonce.
 */
export async function primeLiveState() {
  const store = await loadStore();
  const amorces = {};

  for (const player of config.players) {
    const live = store.live?.[player.key] ?? {};
    let puuid = live.puuid ?? store.players?.[player.key]?.puuid;
    if (puuid) continue;

    try {
      // Appel reseau hors du verrou d'ecriture du store.
      const account = await getAccount(player.gameName, player.tagLine);
      if (!account) continue;
      puuid = account.puuid;
    } catch (err) {
      console.warn(`[live] amorçage de ${player.label} impossible (${err.message})`);
      continue;
    }
    amorces[player.key] = { ...live, puuid };
  }

  if (Object.keys(amorces).length) {
    await updateStore((s) => {
      s.live = { ...(s.live ?? {}), ...amorces };
    });
  }
}
