import { config } from './config.js';

/**
 * Correspondance plateforme Riot -> region op.gg.
 * op.gg utilise ses propres codes, distincts des plateformes de l'API.
 */
const OPGG_REGION = {
  euw1: 'euw',
  eun1: 'eune',
  na1: 'na',
  kr: 'kr',
  br1: 'br',
  jp1: 'jp',
  la1: 'lan',
  la2: 'las',
  oc1: 'oce',
  tr1: 'tr',
  ru: 'ru',
  ph2: 'ph',
  sg2: 'sg',
  th2: 'th',
  tw2: 'tw',
  vn2: 'vn',
  me1: 'me',
};

/**
 * Profil op.gg du joueur.
 * Format attendu : https://op.gg/fr/lol/summoners/euw/Pseudo-TAG
 */
export function opggUrl(gameName, tagLine) {
  const region = OPGG_REGION[config.platform.toLowerCase()] ?? config.platform.toLowerCase();
  // Les espaces d'un pseudo deviennent %20 ; le tiret separe pseudo et tag.
  const slug = `${encodeURIComponent(gameName)}-${encodeURIComponent(tagLine)}`;
  return `https://op.gg/fr/lol/summoners/${region}/${slug}`;
}
