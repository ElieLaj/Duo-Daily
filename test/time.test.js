import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDateFr } from '../src/time.js';

test('convertit une date francaise en jour local, y compris aux changements d heure', () => {
  const winter = parseDateFr('06-08-2026', 'Europe/Paris');
  assert.equal(new Date(winter.start).toISOString(), '2026-08-05T22:00:00.000Z');
  assert.equal(new Date(winter.end).toISOString(), '2026-08-06T22:00:00.000Z');

  const shortDay = parseDateFr('29-03-2026', 'Europe/Paris');
  assert.equal(shortDay.end - shortDay.start, 23 * 60 * 60 * 1000);

  assert.throws(() => parseDateFr('31-02-2026', 'Europe/Paris'), /inexistante/);
  assert.throws(() => parseDateFr('2026-08-06', 'Europe/Paris'), /JJ-MM-AAAA/);
});
