import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

/**
 * Journal fichier ecrit par l'application elle-meme.
 *
 * L'alternative (rediriger la sortie via `cmd /c node ... >> bot.log`) oblige
 * le planificateur de taches a lancer cmd.exe : il ne controle alors que ce
 * processus, et `Stop-ScheduledTask` laisse node orphelin, ce qui empeche les
 * relances suivantes. En ecrivant ici, la tache lance node directement.
 */

const LOG_DIR = path.join(ROOT, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'bot.log');
const PREVIOUS_FILE = path.join(LOG_DIR, 'bot.log.1');
const MAX_BYTES = 2 * 1024 * 1024;

// Windows PowerShell 5.1 lit un fichier sans BOM en ANSI : les accents
// deviennent illisibles. Le BOM lui fait detecter l'UTF-8 tout seul.
const BOM = '﻿';

let stream = null;

function rotate() {
  try {
    if (fs.statSync(LOG_FILE).size < MAX_BYTES) return;
    fs.rmSync(PREVIOUS_FILE, { force: true });
    fs.renameSync(LOG_FILE, PREVIOUS_FILE);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`[logger] rotation impossible : ${err.message}`);
  }
}

function append(prefix, args) {
  if (!stream) return;
  const text = args
    .map((a) => (typeof a === 'string' ? a : a instanceof Error ? (a.stack ?? a.message) : JSON.stringify(a)))
    .join(' ');
  stream.write(`${prefix} ${text}\n`);
}

/**
 * Duplique la sortie console vers logs/bot.log.
 * On intercepte console.* plutot que d'exposer un logger a importer partout :
 * les avertissements emis par riot.js, store.js ou ddragon.js sont ainsi
 * captures sans les modifier.
 */
export function initLogger() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    rotate();
    const fresh = !fs.existsSync(LOG_FILE) || fs.statSync(LOG_FILE).size === 0;
    stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
    if (fresh) stream.write(BOM);
  } catch (err) {
    console.error(`[logger] journal fichier indisponible (${err.message}), sortie console seule`);
    return;
  }

  // L'horodatage est ajoute ici, une seule fois, pour la console comme pour le
  // fichier : les appelants passent juste leur message.
  for (const level of ['log', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      const prefix = `[${new Date().toISOString()}]${level === 'log' ? '' : ' ' + level.toUpperCase()}`;
      original(prefix, ...args);
      append(prefix, args);
    };
  }
}

/** Message applicatif, vers la console et le journal. */
export function log(...args) {
  console.log(...args);
}
