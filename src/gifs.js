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
  'https://tenor.com/view/jerry-meme-tom-and-jerry-meme-jerry-points-get-a-load-of-this-guy-this-guy-gif-11384860625931393733',
  'https://tenor.com/view/disappointed-meme-funny-ratio-black-gif-11008400595622414539',
  'https://static2.klipy.com/ii/bea85337777ad0e23e63683391435543/98/e2/bDq792YE.gif',
  'https://static2.klipy.com/ii/84b4c0b02782dda9051003f9e36484ec/56/f0/kshSP0tO.gif',
  'https://static2.klipy.com/ii/9ed0121ed465c12e1f3dda331ed33f0e/3e/90/7PYcGhJcogDru.gif',
  'https://static2.klipy.com/ii/4493325008d34b7bf8cd6813cd5c1619/ea/85/PNc9igj9SMtXhxy2m0D.gif'
];

/** Nombre de defaites consecutives a partir duquel le GIF part. */
export const GIF_STREAK_MIN = 4;

export function randomDefeatGif() {
  return DEFEAT_GIFS[Math.floor(Math.random() * DEFEAT_GIFS.length)];
}
