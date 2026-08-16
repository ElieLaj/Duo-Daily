import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from './config.js';

/**
 * GIFs de moquerie, affiches quand un joueur enchaine les defaites.
 *
 * L'URL est envoyee dans le CONTENU du message, pas dans un encart. Poser une
 * URL de media Tenor dans setImage semblait plus propre — pas de lien visible
 * — mais Discord n'arrive pas a charger ces medias par son proxy : l'encart
 * ressortait vide. Les URLs ci-dessous sont celles verifiees comme rendues
 * dans un contenu de message : pages Tenor (embed gifv) et medias directs
 * Klipy (embed image).
 *
 * Pour en ajouter un : coller l'URL dans Discord et verifier qu'un apercu
 * apparait. Laisser quelques secondes — l'apercu est genere apres coup.
 */
export const DEFEAT_GIFS = [
  'https://tenor.com/view/laughing-holding-laugh-gif-546198937645667256',
  'https://tenor.com/view/funny-gif-3717613948823709624',
  'https://tenor.com/view/smiling-friends-psychicpebbles-pim-smiling-friends-pim-mr-boss-gif-1373626090718171797',
  'https://tenor.com/view/lep-league-of-legends-feeding-smile-professional-gif-10256898',
  'https://tenor.com/view/jerry-meme-tom-and-jerry-meme-jerry-points-get-a-load-of-this-guy-this-guy-gif-11384860625931393733',
  'https://tenor.com/view/disappointed-meme-funny-ratio-black-gif-11008400595622414539',
  'https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExcnltNXgybDdkNzZ6NG41M2Q3YWhzaDBtN2JtZzkxMDY4a2ZxdTNjZCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/iJLCIxU8cx7fFM7zaS/giphy.gif',
  'https://static2.klipy.com/ii/bea85337777ad0e23e63683391435543/98/e2/bDq792YE.gif',
  'https://static2.klipy.com/ii/84b4c0b02782dda9051003f9e36484ec/56/f0/kshSP0tO.gif',
  'https://static2.klipy.com/ii/9ed0121ed465c12e1f3dda331ed33f0e/3e/90/7PYcGhJcogDru.gif',
  'https://static2.klipy.com/ii/4493325008d34b7bf8cd6813cd5c1619/ea/85/PNc9igj9SMtXhxy2m0D.gif',
  'https://static2.klipy.com/ii/925f17378dd1893b674a723c07535afe/21/cc/pFaC4957.gif'
];

/** Nombre de defaites consecutives a partir duquel le GIF part. */
export const GIF_STREAK_MIN = 4;

export function randomDefeatGif() {
  return DEFEAT_GIFS[Math.floor(Math.random() * DEFEAT_GIFS.length)];
}

/** GIFs de celebration tires quand un joueur atteint trois victoires de suite. */
export const WIN_STREAK_GIFS = [
  'https://tenor.com/view/bleh-gif-2484976909584170518',
  'https://tenor.com/view/faker-calling-faker-calling-faker-is-calling-goat-gif-84264726571740911',
  'https://tenor.com/view/pacha-perfect-emperors-new-groove-very-good-gif-5346522',
  'https://tenor.com/view/an-iq-too-high-crow-real-science-gif-2503924816758610181',
  'https://tenor.com/view/lebron-james-lebron-fire-lebron-pregame-lebron-fire-gif-6415202897721076578',
  'https://tenor.com/view/smug-daniel-craig-saturday-night-live-thats-right-yeah-gif-16611686',
  'https://static2.klipy.com/ii/8ce8357c78ea940b9c2015daf05ce1a5/95/3c/QdKtgbTS.gif',
  'https://static2.klipy.com/ii/d7aec6f6f171607374b2065c836f92f4/75/59/KRyoDMPk.gif',
  'https://tenor.com/view/hamster-pure-happiness-unicorn-rainbow-gif-12767925712391847557'
];

/**
 * Serie minimale pour declencher le GIF. Comme cote defaites, il repart a
 * chaque victoire tant que la serie tient : 3, puis 4, puis 5...
 */
export const WIN_STREAK_GIF_MIN = 3;

export function randomWinStreakGif(random = Math.random) {
  return WIN_STREAK_GIFS[Math.floor(random() * WIN_STREAK_GIFS.length)];
}

/**
 * Image dediee a certains joueurs, servie a la place du tirage aleatoire.
 *
 * Le fichier vit dans assets/ et est joint au message plutot que reference par
 * une URL : rien a heberger, et Discord affiche une piece jointe sans passer
 * par son proxy — ce qui evite l'echec de chargement rencontre avec les
 * medias distants.
 *
 * Cle = cle du joueur telle qu'elle figure dans PLAYERS ; valeur = nom de
 * fichier SANS extension, celle-ci etant cherchee parmi les formats courants.
 */
const OVERRIDES = {
  'Ronor#0101': 'didier',
  'jiji#lilya': 'didier',
};

const EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

/**
 * Recherche insensible a la casse, par parcours du dossier.
 *
 * Un simple existsSync('didier.png') suffirait sous Windows, dont le systeme
 * de fichiers ignore la casse — mais pas sous Linux, ou tourne le serveur :
 * un fichier nomme DIDIER.png n'y serait jamais trouve, et le bot retomberait
 * silencieusement sur le tirage aleatoire.
 *
 * @returns {string|null} chemin du fichier a joindre, ou null si le joueur n'a
 *   pas d'image dediee ou qu'aucun fichier ne correspond.
 */
export function defeatImageFor(playerKey) {
  const base = OVERRIDES[playerKey];
  if (!base) return null;

  const dossier = path.join(ROOT, 'assets');
  let fichiers;
  try {
    fichiers = fs.readdirSync(dossier);
  } catch {
    return null;
  }

  const cible = base.toLowerCase();
  const trouve = fichiers.find((nom) => {
    const ext = path.extname(nom).toLowerCase();
    return EXTENSIONS.includes(ext) && path.basename(nom, path.extname(nom)).toLowerCase() === cible;
  });
  return trouve ? path.join(dossier, trouve) : null;
}

/** Etat des images dediees, pour le journal de demarrage. */
export function defeatImageStatus() {
  return Object.entries(OVERRIDES).map(([key, base]) => ({
    key,
    base,
    chemin: defeatImageFor(key),
  }));
}
