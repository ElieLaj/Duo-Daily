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
];

/** Nombre de defaites consecutives a partir duquel le GIF part. */
export const GIF_STREAK_MIN = 4;

export function randomDefeatGif() {
  return DEFEAT_GIFS[Math.floor(Math.random() * DEFEAT_GIFS.length)];
}
