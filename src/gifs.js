/**
 * GIFs de moquerie, postes quand un joueur enchaine les defaites.
 *
 * L'URL est envoyee dans un message a part plutot que dans l'encart : un
 * embed ne sait afficher qu'une image directe, alors que ce sont des pages
 * Tenor/Klipy. Seul Discord peut en tirer un apercu, et uniquement depuis le
 * contenu d'un message.
 */
export const DEFEAT_GIFS = [
  'https://klipy.com/gifs/laughing-cat-9',
  'https://klipy.com/gifs/ishowspeed-try-not-to-laugh',
  'https://klipy.com/gifs/ishowspeed-laugh-6',
  'https://tenor.com/view/laughing-holding-laugh-gif-546198937645667256',
  'https://tenor.com/view/funny-gif-3717613948823709624',
  'https://tenor.com/view/jerry-meme-tom-and-jerry-meme-jerry-points-get-a-load-of-this-guy-this-guy-gif-11384860625931393733',
  'https://tenor.com/view/disappointed-meme-funny-ratio-black-gif-11008400595622414539',
];

/** Nombre de defaites consecutives a partir duquel le GIF part. */
export const GIF_STREAK_MIN = 4;

export function randomDefeatGif() {
  return DEFEAT_GIFS[Math.floor(Math.random() * DEFEAT_GIFS.length)];
}
