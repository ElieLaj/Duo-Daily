import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Chemin explicite : `dotenv/config` chercherait .env dans le repertoire courant,
// qui n'est pas forcement celui du projet quand le bot est lance au demarrage
// de Windows par le planificateur de taches.
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

const QUEUE_IDS = {
  RANKED_SOLO_5x5: 420,
  RANKED_FLEX_SR: 440,
};

function str(name, fallback = '') {
  return (process.env[name] ?? '').trim() || fallback;
}

/**
 * Analyse un Riot ID "Pseudo#TAG".
 * Sert aussi bien a PLAYERS qu'a la saisie libre de la commande /joueur.
 */
export function parsePlayerId(entry, source = 'Riot ID') {
  // On tolere "Pseudo #TAG" avec des espaces autour du #, comme ecrit dans Discord.
  const match = /^(.+?)\s*#\s*(.+)$/.exec(String(entry ?? '').trim());
  if (!match) {
    throw new Error(
      `${source} : "${entry}" n'est pas au format Pseudo#TAG.` +
        (source === 'PLAYERS'
          ? `\nPense aux guillemets dans .env : PLAYERS="Pseudo#TAG,Autre#TAG" — sans eux, ` +
            `dotenv coupe la valeur au premier "#".`
          : ''),
    );
  }
  const gameName = match[1].trim();
  const tagLine = match[2].trim();
  return { gameName, tagLine, key: `${gameName}#${tagLine}`, label: `${gameName} #${tagLine}` };
}

function parsePlayers(raw) {
  const players = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => parsePlayerId(entry, 'PLAYERS'));
  if (!players.length) throw new Error('PLAYERS ne contient aucun joueur');
  return players;
}

function parseDailyTime(raw) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!match) throw new Error(`DAILY_TIME "${raw}" invalide (format attendu HH:MM)`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error(`DAILY_TIME "${raw}" hors plage`);
  return { hour, minute };
}

const queue = str('QUEUE', 'RANKED_SOLO_5x5');
if (!QUEUE_IDS[queue]) {
  throw new Error(`QUEUE "${queue}" inconnue (valeurs possibles : ${Object.keys(QUEUE_IDS).join(', ')})`);
}

export const config = {
  discordToken: str('DISCORD_TOKEN'),
  channelId: str('DISCORD_CHANNEL_ID'),
  guildId: str('DISCORD_GUILD_ID'),

  riotKey: str('RIOT_API_KEY'),
  platform: str('RIOT_PLATFORM', 'euw1'),
  region: str('RIOT_REGION', 'europe'),
  rateLimits: str('RIOT_RATE_LIMITS', '20:1,100:120'),
  rateSafety: Number(str('RIOT_RATE_SAFETY', '0.9')),

  // Aucun joueur par défaut : la liste est propre à chaque installation, et
  // des Riot ID réels n'ont rien à faire dans le code publié.
  players: parsePlayers(str('PLAYERS')),
  queue,
  queueId: QUEUE_IDS[queue],

  // "clean" : LP en gros + pastille 🟢/🔴, couleur portée par la barre latérale.
  // "ansi"  : texte réellement coloré, mais encadré comme un bloc de code.
  lpStyle: str('LP_STYLE', 'clean') === 'ansi' ? 'ansi' : 'clean',
  // "none" (défaut) : pas d'emblème de rang. "thumbnail" : vignette à droite.
  // "image" : emblème pleine largeur.
  emblemStyle: ['thumbnail', 'image'].includes(str('EMBLEM_STYLE', 'none')) ? str('EMBLEM_STYLE') : 'none',

  dailyTime: parseDailyTime(str('DAILY_TIME', '23:00')),
  timezone: str('TIMEZONE', 'Europe/Paris'),
  catchUp: str('CATCH_UP', 'true') !== 'false',

  // Surveillance des parties terminées, indépendante du résumé quotidien.
  liveCheck: str('LIVE_CHECK', 'true') !== 'false',
  liveIntervalMin: Math.max(1, Number(str('LIVE_INTERVAL_MIN', '3')) || 3),
  // Salon dédié aux annonces de partie ; à défaut, celui du résumé.
  liveChannelId: str('LIVE_CHANNEL_ID') || str('DISCORD_CHANNEL_ID'),
  // Ancienneté minimale, en jours, du pic battu pour que le record soit
  // annoncé. Sans ce seuil, un joueur qui grimpe déclencherait la mention à
  // chaque victoire. 0 = annoncer chaque dépassement.
  peakAnnounceDays: Math.max(0, Number(str('PEAK_ANNOUNCE_DAYS', '7')) || 0),

  // Rôles mentionnés lors d'une montée de rang : noms ou identifiants séparés
  // par des virgules. Vide = aucune mention.
  promotionRoles: str('PROMOTION_ROLE', 'Goat')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean),

  storePath: path.join(ROOT, 'data', 'snapshots.json'),
  historyPath: path.join(ROOT, 'data', 'history.sqlite'),
};

/** Verifie les variables necessaires au mode demande, avec un message actionnable. */
export function assertConfig({ discord = true } = {}) {
  const missing = [];
  if (!config.riotKey) missing.push('RIOT_API_KEY');
  if (discord && !config.discordToken) missing.push('DISCORD_TOKEN');
  if (discord && !config.channelId) missing.push('DISCORD_CHANNEL_ID');
  if (missing.length) {
    throw new Error(
      `Variable(s) manquante(s) dans .env : ${missing.join(', ')}\n` +
        `Copie .env.example vers .env et remplis-les.`,
    );
  }
  if (!Number.isFinite(config.rateSafety) || config.rateSafety <= 0 || config.rateSafety > 1) {
    throw new Error('RIOT_RATE_SAFETY doit etre un nombre entre 0 et 1 (ex. 0.9)');
  }
}
