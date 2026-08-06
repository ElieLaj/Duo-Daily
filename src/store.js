import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const EMPTY = { version: 1, lastReportAt: null, players: {} };

/** Charge l'etat persiste. Un fichier absent ou corrompu redemarre a zero. */
export async function loadStore() {
  try {
    const raw = await fs.readFile(config.storePath, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...EMPTY, ...parsed, players: { ...parsed.players } };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[store] ${path.basename(config.storePath)} illisible (${err.message}), on repart d'un etat vide`);
    }
    return structuredClone(EMPTY);
  }
}

/**
 * Ecriture atomique : on ecrit dans un fichier temporaire puis on le renomme.
 * Une coupure de courant pendant l'ecriture ne peut donc pas laisser un JSON
 * tronque, ce qui ferait perdre tout l'historique des LP.
 */
/**
 * Serialise les cycles lecture-modification-ecriture.
 *
 * Deux boucles ecrivent desormais dans le meme fichier : le resume quotidien
 * (champ `players`) et la surveillance des parties (champ `live`). Sans cette
 * file, un `await` de l'une pourrait s'intercaler entre le load et le save de
 * l'autre, et la derniere ecriture ecraserait la premiere.
 */
let writeQueue = Promise.resolve();

export function updateStore(mutate) {
  const run = writeQueue.then(async () => {
    const store = await loadStore();
    const result = await mutate(store);
    await saveStore(store);
    return result;
  });
  writeQueue = run.catch(() => {});
  return run;
}

export async function saveStore(store) {
  await fs.mkdir(path.dirname(config.storePath), { recursive: true });
  const tmp = `${config.storePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), 'utf8');
  await fs.rename(tmp, config.storePath);
}
