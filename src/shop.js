import { EmbedBuilder } from 'discord.js';

import { config } from './config.js';
import { formatDateTimeFr } from './time.js';

/**
 * Rotation de la boutique fantastique : un cycle fixe, ancre sur une rotation
 * connue plutot que decrit par un horaire recurrent.
 *
 * Une expression cron ne sait pas exprimer "toutes les deux semaines" : elle
 * raisonne par jour du mois ou jour de la semaine, et les deux derivent des
 * qu'un mois compte cinq semaines. L'ancre plus la periode, elle, reste juste
 * indefiniment.
 *
 * Le calcul porte sur des instants absolus, pas sur une heure locale. La
 * rotation de reference — 30 septembre 2026, 02:00 UTC+2 — est un horaire UTC
 * fixe : son heure a Paris recule donc a 01:00 au passage a l'heure d'hiver.
 * Ajouter quatorze jours en millisecondes est exact pour cette raison, la ou
 * ce serait faux s'il fallait tenir une heure locale constante.
 */

const JOUR_MS = 24 * 60 * 60 * 1000;

const periodeMs = () => config.shopPeriodDays * JOUR_MS;

/**
 * Derniere rotation survenue, au plus tard a `now`.
 * @returns {Date|null} null tant que l'ancre elle-meme est dans le futur.
 */
export function lastRotation(now = new Date()) {
  const ancre = config.shopAnchor.getTime();
  const ecart = now.getTime() - ancre;
  if (ecart < 0) return null;
  return new Date(ancre + Math.floor(ecart / periodeMs()) * periodeMs());
}

/** Prochaine rotation, strictement apres `now`. */
export function nextRotation(now = new Date()) {
  const ancre = config.shopAnchor.getTime();
  const ecart = now.getTime() - ancre;
  if (ecart < 0) return new Date(ancre);
  return new Date(ancre + (Math.floor(ecart / periodeMs()) + 1) * periodeMs());
}

/**
 * Annonce d'une rotation.
 *
 * L'heure affichee est convertie dans le fuseau configure : c'est le seul
 * rendu qui reste juste des deux cotes du changement d'heure, ou la meme
 * rotation UTC tombe a 02:00 puis a 01:00.
 */
export function buildShopMessage(rotation) {
  const suivante = nextRotation(rotation);
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('🛍️ La boutique fantastique a changé')
    .setDescription('De nouveaux skins sont disponibles.')
    .addFields({
      name: 'Prochaine rotation',
      value: formatDateTimeFr(suivante, config.timezone),
      inline: false,
    });
  return { embeds: [embed] };
}
