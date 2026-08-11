import assert from 'node:assert/strict';
import test from 'node:test';

import { buildWinStreakGifMessage } from '../src/embeds.js';
import { WIN_STREAK_GIFS, randomWinStreakGif } from '../src/gifs.js';

const player = { key: 'Joueur#EUW', label: 'Joueur #EUW', gameName: 'Joueur', tagLine: 'EUW' };

test('choisit uniquement un GIF de celebration configure', () => {
  assert.equal(randomWinStreakGif(() => 0), WIN_STREAK_GIFS[0]);
  assert.equal(randomWinStreakGif(() => 0.999999), WIN_STREAK_GIFS.at(-1));
});

test('envoie le GIF seulement au passage exact a trois victoires', () => {
  const message = buildWinStreakGifMessage(
    player,
    { win: true, remake: false, streak: 3 },
    new Map([[player.key, '123456789']]),
  );
  assert.match(message.content, /3 victoires d'affilée/);
  assert.match(message.content, /<@123456789>/);
  assert.ok(WIN_STREAK_GIFS.some((url) => message.content.endsWith(url)));
  assert.deepEqual(message.allowedMentions, { users: ['123456789'], roles: [], parse: [] });

  assert.equal(buildWinStreakGifMessage(player, { win: true, remake: false, streak: 2 }), null);
  assert.equal(buildWinStreakGifMessage(player, { win: true, remake: false, streak: 4 }), null);
  assert.equal(buildWinStreakGifMessage(player, { win: false, remake: false, streak: 3 }), null);
  assert.equal(buildWinStreakGifMessage(player, { win: true, remake: true, streak: 3 }), null);
});
