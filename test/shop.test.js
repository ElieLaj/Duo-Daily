import assert from 'node:assert/strict';
import test from 'node:test';

import { config } from '../src/config.js';
import { buildShopMessage, lastRotation, nextRotation } from '../src/shop.js';
import { formatDateTimeFr } from '../src/time.js';

const ANCRE = '2026-09-30T00:00:00.000Z';
const d = (iso) => new Date(iso);

test('enchaine les rotations toutes les deux semaines depuis l ancre', () => {
  assert.equal(config.shopAnchor.toISOString(), ANCRE);

  // Avant l'ancre : rien n'a encore tourne, la prochaine est l'ancre elle-meme.
  assert.equal(lastRotation(d('2026-09-29T23:59:00Z')), null);
  assert.equal(nextRotation(d('2026-09-29T23:59:00Z')).toISOString(), ANCRE);

  // Pile a l'ancre : la rotation vient d'avoir lieu.
  assert.equal(lastRotation(d(ANCRE)).toISOString(), ANCRE);
  assert.equal(nextRotation(d(ANCRE)).toISOString(), '2026-10-14T00:00:00.000Z');

  // En plein cycle, la derniere ne bouge pas tant que la suivante n'est pas la.
  assert.equal(lastRotation(d('2026-10-13T23:59:00Z')).toISOString(), ANCRE);
  assert.equal(lastRotation(d('2026-10-14T00:00:00Z')).toISOString(), '2026-10-14T00:00:00.000Z');
});

test('garde l heure UTC au changement d heure, donc 02:00 puis 01:00 a Paris', () => {
  // Le cycle est ancre sur un instant absolu : l'heure locale affichee doit
  // reculer d'une heure une fois Paris repasse a UTC+1, fin octobre. Un calcul
  // qui tiendrait 02:00 locales decalerait la rotation d'une heure.
  const zone = 'Europe/Paris';
  assert.equal(formatDateTimeFr(d(ANCRE), zone), '30-09-2026 à 02:00');
  assert.equal(formatDateTimeFr(d('2026-10-14T00:00:00Z'), zone), '14-10-2026 à 02:00');
  assert.equal(formatDateTimeFr(d('2026-10-28T00:00:00Z'), zone), '28-10-2026 à 01:00');
});

test('annonce la rotation en cours et affiche la suivante', () => {
  const message = buildShopMessage(d(ANCRE));
  const embed = message.embeds[0].data;
  assert.match(embed.title, /boutique fantastique/i);
  assert.equal(embed.fields[0].name, 'Prochaine rotation');
  assert.equal(embed.fields[0].value, formatDateTimeFr(d('2026-10-14T00:00:00Z'), config.timezone));
});
