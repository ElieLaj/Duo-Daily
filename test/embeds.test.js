import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMatchMessage, carriedLine } from '../src/embeds.js';

const player = { key: 'Joueur#EUW', label: 'Joueur #EUW', gameName: 'Joueur', tagLine: 'EUW' };
const partie = (over) => ({
  championName: 'Jinx', win: true, remake: false,
  kills: 1, deaths: 9, assists: 2, cs: 140, durationSec: 1800,
  streak: 0, lossStreak: 0, ...over,
});

test('repere une victoire au KDA sous 1', () => {
  // 3 pour 9 morts : porte.
  assert.equal(carriedLine(partie({ kills: 1, deaths: 9, assists: 2 })), true);
  // Pile a 1 : ce n'est plus sous 1.
  assert.equal(carriedLine(partie({ kills: 2, deaths: 4, assists: 2 })), false);
  // Une defaite au meme KDA ne declenche rien : la vanne porte sur le contraste.
  assert.equal(carriedLine(partie({ win: false })), false);
  // Zero mort rend le KDA infini — surtout pas une division par zero.
  assert.equal(carriedLine(partie({ kills: 0, deaths: 0, assists: 0 })), false);
  // Un remake n'a porte personne.
  assert.equal(carriedLine(partie({ remake: true })), false);
});

test('ping le joueur porte par son equipe', () => {
  const message = buildMatchMessage({
    player,
    match: partie(),
    entry: { tier: 'DIAMOND', rank: 'II', leaguePoints: 68 },
    delta: 18,
    links: new Map([[player.key, '123456789']]),
  });

  assert.match(message.content, /<@123456789> a int mais s'est fait carry/);
  // La mention doit figurer dans la liste blanche, sinon elle s'affiche sans
  // notifier personne — ce qui viderait la ligne de son interet.
  assert.deepEqual(message.allowedMentions.users, ['123456789']);
  assert.deepEqual(message.allowedMentions.parse, []);
});

test('nomme quand meme le joueur non lie, sans rien pinger', () => {
  const message = buildMatchMessage({
    player, match: partie(), entry: null, delta: 18,
  });
  assert.match(message.content, /a int mais s'est fait carry/);
  assert.deepEqual(message.allowedMentions.users, []);
});

test('se tait sur une victoire propre', () => {
  const message = buildMatchMessage({
    player,
    match: partie({ kills: 12, deaths: 2, assists: 7 }),
    entry: null, delta: 18,
  });
  assert.equal(message.content, undefined);
});
