/**
 * Verification de version, a importer EN PREMIER dans index.js.
 *
 * Cette branche s'appuie sur better-sqlite3 plutot que sur node:sqlite, pour
 * fonctionner la ou l'hebergeur impose Node 20. Le minimum descend donc a la
 * version la plus basse acceptee par better-sqlite3.
 *
 * Ne doit dependre d'aucun autre module du projet, sous peine de declencher
 * un import fautif avant sa propre verification.
 */

const MINIMUM = [20, 0, 0];

function tropAncien(actuel, minimum) {
  for (let i = 0; i < minimum.length; i++) {
    if ((actuel[i] ?? 0) > minimum[i]) return false;
    if ((actuel[i] ?? 0) < minimum[i]) return true;
  }
  return false;
}

const actuel = process.versions.node.split('.').map(Number);

if (tropAncien(actuel, MINIMUM)) {
  console.error(
    `\nNode ${process.versions.node} est trop ancien pour ce bot.\n` +
      `Version minimale : ${MINIMUM.join('.')}.\n\n` +
      `L'historique des parties utilise better-sqlite3, qui publie des binaires\n` +
      `precompiles pour Node 20, 22, 23 et 24.\n`,
  );
  process.exit(1);
}
