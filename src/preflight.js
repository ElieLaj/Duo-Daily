/**
 * Verification de version, a importer EN PREMIER dans index.js.
 *
 * `node:sqlite` n'existe pas avant Node 22.5 et reste derriere le drapeau
 * --experimental-sqlite jusqu'a Node 23.3. Sur une version trop ancienne,
 * l'import echoue avec un ERR_UNKNOWN_BUILTIN_MODULE qui ne dit pas quoi
 * faire. Les modules ES etant evalues dans l'ordre de declaration, ce fichier
 * s'execute avant l'import de history.js et peut donc expliquer le probleme
 * a la place du message brut.
 *
 * Ne doit dependre d'aucun autre module du projet, sous peine de declencher
 * l'import fautif avant sa propre verification.
 */

const MINIMUM = [23, 4, 0];

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
      `Version minimale : ${MINIMUM.join('.')} (Node 24 LTS recommandé).\n\n` +
      `L'historique des parties utilise node:sqlite, intégré à Node depuis la\n` +
      `version 22.5 et disponible sans drapeau depuis la 23.4.\n\n` +
      `Sur un hébergeur, choisis explicitement Node 24 : « dernière version »\n` +
      `désigne parfois la dernière LTS d'une branche plus ancienne.\n`,
  );
  process.exit(1);
}
