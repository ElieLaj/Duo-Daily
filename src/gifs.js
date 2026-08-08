/**
 * GIFs de moquerie, affiches quand un joueur enchaine les defaites.
 *
 * URLs de media DIRECTES (.gif), et non des pages Tenor ou Klipy. C'est ce qui
 * permet de les poser dans un encart via setImage : l'image s'affiche seule,
 * sans le lien en clair au-dessus. Une URL de page ne fonctionnerait pas —
 * setImage exige une image, et Discord ne genere l'apercu d'une page que
 * depuis le contenu d'un message, ou l'URL reste visible.
 *
 * Pour en ajouter un : ouvrir le GIF sur Tenor, clic droit sur l'image >
 * « Copier l'adresse de l'image ». L'URL doit finir par .gif.
 */
export const DEFEAT_GIFS = [
  'https://media1.tenor.com/m/B5R9CjcQ07gAAAAC/laughing-holding-laugh.gif',
  'https://media1.tenor.com/m/M5eeMI-sp7gAAAAC/funny.gif',
  'https://media1.tenor.com/m/nf8ma3H42sUAAAAC/jerry-meme-tom-and-jerry-meme.gif',
  'https://media1.tenor.com/m/mMWyBEdFyMsAAAAC/disappointed-meme.gif',
  'https://static2.klipy.com/ii/bea85337777ad0e23e63683391435543/98/e2/bDq792YE.gif',
  'https://static2.klipy.com/ii/84b4c0b02782dda9051003f9e36484ec/56/f0/kshSP0tO.gif',
  'https://static2.klipy.com/ii/9ed0121ed465c12e1f3dda331ed33f0e/3e/90/7PYcGhJcogDru.gif',
];

/** Nombre de defaites consecutives a partir duquel le GIF part. */
export const GIF_STREAK_MIN = 4;

export function randomDefeatGif() {
  return DEFEAT_GIFS[Math.floor(Math.random() * DEFEAT_GIFS.length)];
}
