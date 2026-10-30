import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGroupMatchMessage,
  buildMatchMessage,
  buildMessages,
  carriedLine,
  mvpMoyenne,
} from '../src/embeds.js';

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

test('moyenne des notes : remakes et parties non notees exclus', () => {
  const p = (over) => ({ win: true, remake: false, ...over });
  // La moyenne brute traine le bruit du flottant — 8.4 et 3.2 donnent
  // 5.800000000000001. L'affichage l'arrondit au dixieme, le test aussi.
  const arrondi = (r) => (r ? { moyenne: Math.round(r.moyenne * 10) / 10, parties: r.parties } : r);

  // Une partie archivee avant la colonne mvp_score n'a pas de note. La compter
  // zero tirerait la moyenne vers le bas sans raison.
  assert.deepEqual(
    arrondi(mvpMoyenne([p({ mvpScore: 8.4 }), p({ mvpScore: 3.2 }), p({ mvpScore: null })])),
    { moyenne: 5.8, parties: 2 },
  );

  // Un remake ne compte pas, meme note.
  assert.deepEqual(
    arrondi(mvpMoyenne([p({ mvpScore: 6 }), p({ mvpScore: 9.9, remake: true })])),
    { moyenne: 6, parties: 1 },
  );

  // Les parties relevees en direct portent la note sous `mvp`, les archivees
  // sous `mvpScore` : les deux formes doivent etre acceptees.
  assert.deepEqual(arrondi(mvpMoyenne([p({ mvp: { score: 7 } }), p({ mvpScore: 5 })])), { moyenne: 6, parties: 2 });

  // Rien a moyenner : null, pour que l'affichage omette la ligne.
  assert.equal(mvpMoyenne([]), null);
  assert.equal(mvpMoyenne([p({ mvpScore: null })]), null);
  assert.equal(mvpMoyenne(undefined), null);
});

test('le bilan de la semaine masque les joueurs sans partie', () => {
  const joueur = (nom, total, over = {}) => ({
    key: `${nom}#EUW`, label: `${nom} #EUW`, gameName: nom, tagLine: 'EUW',
    entry: { tier: 'GOLD', rank: 'II', leaguePoints: 40 },
    delta: 0, games: { total, wins: total, losses: 0 }, samples: [], ...over,
  });
  const players = [
    joueur('Actif', 9),
    joueur('Absent', 0),
    joueur('Casse', 0, { error: 'Compte Riot introuvable' }),
  ];
  const noms = (report) =>
    buildMessages(report).flatMap((m) => m.embeds).map((e) => e.data.author?.name).filter(Boolean);

  // Sur la semaine : l'absent disparaît, l'erreur reste — la masquer ferait
  // passer un échec de récupération pour une semaine sans jeu.
  assert.deepEqual(noms({ dateLabel: 'semaine du 05-08-2026', weekly: true, players, totals: null }),
    ['Actif #EUW', 'Casse #EUW']);

  // Le résumé du jour continue d'afficher tout le monde.
  assert.deepEqual(noms({ dateLabel: '20-10-2026', players, totals: null }),
    ['Actif #EUW', 'Absent #EUW', 'Casse #EUW']);
});

test('le pied de page du groupe nomme la file reellement jouee', () => {
  const joueurs = [
    { player: { key: 'A#EUW', label: 'A #EUW' }, match: { championName: 'Ashe', kills: 5, deaths: 2, assists: 7, cs: 200, durationSec: 1800, win: true } },
    { player: { key: 'B#EUW', label: 'B #EUW' }, match: { championName: 'Nami', kills: 1, deaths: 3, assists: 19, cs: 40, durationSec: 1800, win: true } },
  ];

  // Un duo dans la file principale passe par le meme encart que la flex.
  const principale = buildGroupMatchMessage({ players: joueurs, win: true });
  assert.equal(principale.embeds[0].data.footer.text, 'Classée Solo/Duo');

  const flex = buildGroupMatchMessage({ players: joueurs, win: true, queue: 'RANKED_FLEX_SR' });
  assert.equal(flex.embeds[0].data.footer.text, 'Classée Flexible');
});
