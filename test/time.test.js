import assert from 'node:assert/strict';
import test from 'node:test';

import { dayOfWeek, formatDateFr, parseDateFr, patchWeekStart, startOfDayPlus, weekStartOf } from '../src/time.js';

test('dayOfWeek renvoie le bon jour en heure locale', () => {
  // 2026-10-19 est un lundi ; 2026-10-21 un mercredi ; 2026-10-25 un dimanche.
  assert.equal(dayOfWeek(new Date('2026-10-19T12:00:00Z'), 'Europe/Paris'), 1, 'lundi');
  assert.equal(dayOfWeek(new Date('2026-10-21T12:00:00Z'), 'Europe/Paris'), 3, 'mercredi');
  assert.equal(dayOfWeek(new Date('2026-10-25T12:00:00Z'), 'Europe/Paris'), 0, 'dimanche');
});

test('patchWeekStart remonte au mercredi precedent, jamais au jour meme si mercredi', () => {
  // Oct 20 2026 = mardi → Oct 21 = mercredi, Oct 22 = jeudi, Oct 27 = mardi.

  // Mercredi 21 oct. 2026 soir : le cycle de patch a commencé le mer. 14 oct.
  const mercredi = new Date('2026-10-21T21:00:00Z'); // 23 h Paris (CEST +2)
  const debut = patchWeekStart(mercredi, 'Europe/Paris');
  // Mercredi 14 oct. minuit Paris (CEST) = 2026-10-13T22:00:00Z
  assert.equal(new Date(debut).toISOString(), '2026-10-13T22:00:00.000Z', 'recule 7 jours si mercredi');

  // Jeudi 22 oct. : cycle commencé le mer. 21 oct. (hier)
  const jeudi = new Date('2026-10-22T12:00:00Z');
  const debutJeudi = patchWeekStart(jeudi, 'Europe/Paris');
  // Mercredi 21 oct. minuit Paris (CEST) = 2026-10-20T22:00:00Z
  assert.equal(new Date(debutJeudi).toISOString(), '2026-10-20T22:00:00.000Z', 'mercredi de cette semaine si jeudi');

  // Mardi 27 oct. : cycle commencé le mer. 21 oct.
  const mardi = new Date('2026-10-27T12:00:00Z');
  const debutMardi = patchWeekStart(mardi, 'Europe/Paris');
  // CET après changement DST (25 oct.) : 21 oct. minuit Paris (CEST) = 20T22:00Z
  assert.equal(new Date(debutMardi).toISOString(), '2026-10-20T22:00:00.000Z', 'mercredi precedent si mardi');
});

test('convertit une date francaise en jour local, y compris aux changements d heure', () => {
  const winter = parseDateFr('06-08-2026', 'Europe/Paris');
  assert.equal(new Date(winter.start).toISOString(), '2026-08-05T22:00:00.000Z');
  assert.equal(new Date(winter.end).toISOString(), '2026-08-06T22:00:00.000Z');

  const shortDay = parseDateFr('29-03-2026', 'Europe/Paris');
  assert.equal(shortDay.end - shortDay.start, 23 * 60 * 60 * 1000);

  assert.throws(() => parseDateFr('31-02-2026', 'Europe/Paris'), /inexistante/);
  assert.throws(() => parseDateFr('2026-08-06', 'Europe/Paris'), /JJ-MM-AAAA/);
});

test('weekStartOf ramene au mercredi de la semaine, le mercredi inclus', () => {
  const zone = 'Europe/Paris';
  const debut = (iso) => formatDateFr(new Date(weekStartOf(new Date(iso), zone)), zone);

  // Mercredi 21-10-2026 : il ouvre sa propre semaine, il ne recule pas.
  assert.equal(debut('2026-10-21T12:00:00+02:00'), '21-10-2026');
  // Jeudi, puis mardi suivant : meme semaine, meme mercredi.
  assert.equal(debut('2026-10-22T12:00:00+02:00'), '21-10-2026');
  assert.equal(debut('2026-10-27T12:00:00+01:00'), '21-10-2026');
  // Le mercredi suivant bascule sur la semaine d'apres.
  assert.equal(debut('2026-10-28T12:00:00+01:00'), '28-10-2026');
});

test('startOfDayPlus compte en jours calendaires, pas en tranches de 24 h', () => {
  const zone = 'Europe/Paris';
  const mercredi = weekStartOf(new Date('2026-10-21T12:00:00+02:00'), zone);
  const fin = startOfDayPlus(new Date(mercredi), 7, zone);

  // Cette semaine contient le passage a l'heure d'hiver du 25 octobre : elle
  // dure 169 h. Ajouter 7 x 24 h retomberait le 27 a 23:00, soit un jour trop
  // tot, et le bilan perdrait le dernier mardi.
  assert.equal(formatDateFr(new Date(fin), zone), '28-10-2026');
  assert.equal(fin - mercredi, 169 * 60 * 60 * 1000);

  // Une semaine ordinaire fait bien 168 h.
  const ordinaire = weekStartOf(new Date('2026-11-04T12:00:00+01:00'), zone);
  assert.equal(startOfDayPlus(new Date(ordinaire), 7, zone) - ordinaire, 168 * 60 * 60 * 1000);
});
