/**
 * Point d'entree a la racine.
 *
 * Le code vit dans src/. Ce fichier existe parce que la plupart des
 * hebergeurs lancent `index.js` par defaut : sans lui, il faudrait penser a
 * pointer leur "fichier principal" sur src/index.js, et un oubli se traduit
 * par un demarrage qui echoue sans raison evidente.
 *
 * Les arguments de ligne de commande (--now, --dry-run) sont lus depuis
 * process.argv, donc ils fonctionnent par ce chemin comme par l'autre.
 */
import './src/index.js';
