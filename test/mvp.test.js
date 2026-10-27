import assert from 'node:assert/strict';
import test from 'node:test';

import { mvpFor } from '../src/mvp.js';

/** Participant minimal, dans l'ordre des statistiques qui comptent. */
function joueur(nom, poste, win, { k = 0, d = 0, a = 0, dmg = 0, gold = 0, vis = 0, ctrl = 0, mit = 0 }) {
  return {
    puuid: nom,
    nom,
    teamPosition: poste,
    win,
    teamId: win ? 100 : 200,
    kills: k,
    deaths: d,
    assists: a,
    totalDamageDealtToChampions: dmg,
    goldEarned: gold,
    visionScore: vis,
    detectorWardsPlaced: ctrl,
    damageSelfMitigated: mit,
  };
}

const POSTES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];

/**
 * Statistiques realistes et tres inegales d'un poste a l'autre : le support
 * touche la moitie de l'or de l'ADC et fait le quart de ses degats.
 */
const PROFILS = {
  TOP: { k: 5, d: 6, a: 4, dmg: 16000, gold: 10500, vis: 16, ctrl: 2, mit: 42000 },
  JUNGLE: { k: 6, d: 5, a: 8, dmg: 14000, gold: 11000, vis: 32, ctrl: 4, mit: 28000 },
  MIDDLE: { k: 8, d: 5, a: 6, dmg: 24000, gold: 12500, vis: 22, ctrl: 2, mit: 15000 },
  BOTTOM: { k: 9, d: 4, a: 6, dmg: 30000, gold: 14500, vis: 18, ctrl: 2, mit: 16000 },
  UTILITY: { k: 1, d: 7, a: 17, dmg: 7000, gold: 8200, vis: 70, ctrl: 12, mit: 13000 },
};

test('une partie miroir note les dix joueurs a 5, quel que soit leur role', () => {
  // Le test qui verrouille la neutralite de role. Chaque joueur egale trait
  // pour trait son vis-a-vis ; seuls les postes diffèrent entre eux. Un calcul
  // base sur la part de l'equipe donnerait ici 2/10 au support et 8/10 a l'ADC.
  const partie = POSTES.flatMap((poste) => [
    joueur(`${poste}-bleu`, poste, true, PROFILS[poste]),
    joueur(`${poste}-rouge`, poste, false, PROFILS[poste]),
  ]);

  for (const p of partie) {
    assert.equal(mvpFor(partie, p.puuid).score, 5, `${p.puuid} devrait valoir 5`);
  }
});

/** Partie realiste : un ADC qui porte, un tank en difficulte, un feeder. */
const PARTIE = [
  joueur('carry', 'BOTTOM', true, { k: 14, d: 3, a: 8, dmg: 32000, gold: 15000, vis: 20, ctrl: 2, mit: 18000 }),
  joueur('mid', 'MIDDLE', true, { k: 8, d: 5, a: 6, dmg: 24000, gold: 12500, vis: 22, ctrl: 2, mit: 15000 }),
  joueur('jungle', 'JUNGLE', true, { k: 5, d: 6, a: 12, dmg: 14000, gold: 11000, vis: 35, ctrl: 4, mit: 30000 }),
  joueur('tank', 'TOP', true, { k: 2, d: 7, a: 5, dmg: 11000, gold: 10000, vis: 18, ctrl: 2, mit: 48000 }),
  joueur('support', 'UTILITY', true, { k: 1, d: 6, a: 18, dmg: 7000, gold: 8500, vis: 72, ctrl: 12, mit: 14000 }),
  joueur('adc-adverse', 'BOTTOM', false, { k: 7, d: 8, a: 4, dmg: 26000, gold: 12000, vis: 18, ctrl: 2, mit: 16000 }),
  joueur('feeder', 'MIDDLE', false, { k: 2, d: 11, a: 3, dmg: 15000, gold: 9500, vis: 20, ctrl: 2, mit: 13000 }),
  joueur('jungle-adverse', 'JUNGLE', false, { k: 4, d: 7, a: 6, dmg: 13000, gold: 10000, vis: 30, ctrl: 3, mit: 26000 }),
  joueur('top-adverse', 'TOP', false, { k: 5, d: 6, a: 3, dmg: 16000, gold: 10500, vis: 16, ctrl: 2, mit: 40000 }),
  joueur('support-adverse', 'UTILITY', false, { k: 0, d: 9, a: 12, dmg: 6000, gold: 7500, vis: 65, ctrl: 9, mit: 12000 }),
];

const notes = Object.fromEntries(PARTIE.map((p) => [p.puuid, mvpFor(PARTIE, p.puuid)]));

test('classe une partie realiste dans l ordre attendu', () => {
  const score = (nom) => notes[nom].score;

  // La note mesure l'ecart avec son vis-a-vis, et rien d'autre. Le mid qui a
  // ecrase un 2/11/3 passe donc devant le 14/3/8 qui affrontait un adversaire
  // correct. C'est la definition assumee, pas un accident : si cette ligne
  // casse, c'est qu'une mesure absolue est revenue dans le calcul — et il faut
  // alors reverifier le test miroir, que toute mesure absolue fait tomber.
  assert.ok(score('mid') > score('carry'), `mid ${score('mid')} vs carry ${score('carry')}`);
  // Les deux restent dans le haut du bareme : ils ont tous deux gagne leur duel.
  assert.ok(score('carry') > 7, `carry ${score('carry')}`);

  // Le support et le tank ne doivent pas etre punis pour leur role : tous
  // deux au-dessus du feeder, et le support au-dessus de la moyenne puisqu'il
  // domine son vis-a-vis.
  assert.ok(score('support') > 5.5, `support ${score('support')}`);
  assert.ok(score('tank') > score('feeder'), `tank ${score('tank')} vs feeder ${score('feeder')}`);
  assert.ok(score('feeder') < 3, `feeder ${score('feeder')}`);

  // Le bareme doit s'etaler : un calcul trop lisse tasse tout entre 4 et 6.
  const tous = PARTIE.map((p) => notes[p.puuid].score);
  assert.ok(Math.max(...tous) - Math.min(...tous) > 4, `etalement ${Math.min(...tous)}–${Math.max(...tous)}`);
});

test('decerne un MVP chez les gagnants et un ACE chez les perdants', () => {
  const badges = (camp) => PARTIE.filter((p) => p.win === camp).map((p) => notes[p.puuid].badge);
  assert.deepEqual(badges(true).filter(Boolean), ['MVP']);
  assert.deepEqual(badges(false).filter(Boolean), ['ACE']);
  // Le meilleur de chaque camp, pas le meilleur des dix : un perdant garde son
  // ACE meme quand sa note depasse celle de plusieurs gagnants.
  assert.equal(notes['mid'].badge, 'MVP');
  assert.equal(notes['top-adverse'].badge, 'ACE');
});

test('sacre ACE le meilleur de son equipe battue, quel que soit son rang general', () => {
  // Un perdant qui surnage largement sur ses coequipiers, mais que plusieurs
  // gagnants devancent au classement des dix. Il reste ACE : la distinction se
  // joue dans son camp, pas sur le classement general.
  const fort = { k: 12, d: 4, a: 5, dmg: 31000, gold: 14500, vis: 26, ctrl: 4, mit: 17000 };
  const sombre = { k: 0, d: 10, a: 2, dmg: 7000, gold: 7800, vis: 12, ctrl: 0, mit: 15000 };
  const partie = [
    ...POSTES.map((poste) => joueur(`${poste}-bleu`, poste, true, PROFILS[poste])),
    joueur('rescape', 'MIDDLE', false, fort),
    ...POSTES.filter((x) => x !== 'MIDDLE').map((x) => joueur(`${x}-rouge`, x, false, sombre)),
  ];

  const tous = partie.map((p) => ({ p, ...mvpFor(partie, p.puuid) })).sort((a, b) => b.score - a.score);
  const rang = tous.findIndex((x) => x.p.puuid === 'rescape') + 1;

  assert.ok(rang > 1, `le rescape devrait etre devance au general, il est ${rang}e`);
  assert.equal(mvpFor(partie, 'rescape').badge, 'ACE');
  // Et il est bien le seul de son camp a l'obtenir.
  const aces = partie.filter((p) => !p.win && mvpFor(partie, p.puuid).badge);
  assert.deepEqual(aces.map((p) => p.puuid), ['rescape']);
});

test('ne distingue qu un seul joueur par camp en cas d egalite', () => {
  // La partie miroir met les cinq joueurs d'une equipe a 5,0 pile. Une
  // comparaison a Math.max donnerait cinq MVP et cinq ACE.
  const partie = POSTES.flatMap((poste) => [
    joueur(`${poste}-bleu`, poste, true, PROFILS[poste]),
    joueur(`${poste}-rouge`, poste, false, PROFILS[poste]),
  ]);

  for (const camp of [true, false]) {
    const badges = partie.filter((p) => p.win === camp).map((p) => mvpFor(partie, p.puuid).badge);
    assert.deepEqual(badges.filter(Boolean), [camp ? 'MVP' : 'ACE']);
  }
});

test('departage deux performances identiques au meilleur KDA', () => {
  // Deux joueurs d'un meme camp rigoureusement a egalite de ratio : seul le
  // KDA les separe. Sans ce depart, le badge tombait sur le premier de la
  // liste, ce qui ne reflete rien.
  const stats = (k, d, a) => ({ k, d, a, dmg: 20000, gold: 12000, vis: 24, ctrl: 3, mit: 20000 });
  const partie = [
    // Meme profil, mais le mid meurt deux fois moins que le top.
    joueur('top-bleu', 'TOP', true, stats(6, 8, 6)),
    joueur('mid-bleu', 'MIDDLE', true, stats(6, 4, 6)),
    joueur('top-rouge', 'TOP', false, stats(6, 8, 6)),
    joueur('mid-rouge', 'MIDDLE', false, stats(6, 4, 6)),
  ];

  // Chacun egale son vis-a-vis : les quatre ratios valent 1,0, donc 5,0.
  for (const p of partie) assert.equal(mvpFor(partie, p.puuid).score, 5);

  // Le badge revient au meilleur KDA de chaque camp, soit les mid (3,0 contre 1,5).
  assert.equal(mvpFor(partie, 'mid-bleu').badge, 'MVP');
  assert.equal(mvpFor(partie, 'top-bleu').badge, null);
  assert.equal(mvpFor(partie, 'mid-rouge').badge, 'ACE');
  assert.equal(mvpFor(partie, 'top-rouge').badge, null);
});

test('reste entre 0 et 10 aux extremes', () => {
  const ecrase = [
    joueur('dieu', 'MIDDLE', true, { k: 30, d: 0, a: 20, dmg: 90000, gold: 25000, vis: 90, ctrl: 20, mit: 60000 }),
    ...POSTES.filter((x) => x !== 'MIDDLE').map((x) => joueur(`${x}-bleu`, x, true, PROFILS[x])),
    ...POSTES.map((x) => joueur(`${x}-rouge`, x, false, { k: 0, d: 12, a: 0, dmg: 0, gold: 2000, vis: 0, ctrl: 0, mit: 0 })),
  ];
  const haut = mvpFor(ecrase, 'dieu').score;
  const bas = mvpFor(ecrase, 'MIDDLE-rouge').score;
  assert.ok(haut > 9 && haut <= 10, `haut ${haut}`);
  assert.ok(bas >= 0 && bas < 1, `bas ${bas}`);
});

test('tolere les champs absents et les postes manquants', () => {
  // Vieilles parties et files particulieres : ni teamPosition, ni visionScore,
  // ni detectorWardsPlaced. Le calcul doit retomber sur la moyenne adverse
  // plutot que de produire NaN.
  const brut = [
    { puuid: 'a', teamId: 100, win: true, kills: 10, deaths: 2, assists: 5, totalDamageDealtToChampions: 20000 },
    { puuid: 'b', teamId: 100, win: true, kills: 2, deaths: 8, assists: 1 },
    { puuid: 'c', teamId: 200, win: false, kills: 3, deaths: 6, assists: 2, totalDamageDealtToChampions: 9000 },
  ];
  for (const p of brut) {
    const r = mvpFor(brut, p.puuid);
    assert.ok(Number.isFinite(r.score), `${p.puuid} -> ${r.score}`);
  }
  assert.ok(mvpFor(brut, 'a').score > mvpFor(brut, 'b').score);
});

test('renvoie le rang parmi les dix joueurs', () => {
  // mid ecrase le feeder : 1er des dix, MVP. carry 2e. top-adverse gagne son
  // duel contre tank et remonte jusqu'au 4e rang general, tout en etant ACE.
  assert.equal(notes['mid'].rang, 1);
  assert.equal(notes['mid'].badge, 'MVP');
  assert.equal(notes['carry'].rang, 2);
  assert.equal(notes['top-adverse'].rang, 4);
  assert.equal(notes['top-adverse'].badge, 'ACE');
  // Le rang est sur dix : les rangs de tous les joueurs couvrent 1 a 10 sans doublon.
  const tousRangs = PARTIE.map((p) => notes[p.puuid].rang).sort((a, b) => a - b);
  assert.deepEqual(tousRangs, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('renvoie null quand il n y a rien a noter', () => {
  assert.equal(mvpFor(PARTIE, 'inconnu'), null);
  // Zero kill, zero mort, zero assistance : le joueur n'etait pas la.
  const absent = PARTIE.map((p) =>
    p.puuid === 'carry' ? { ...p, kills: 0, deaths: 0, assists: 0 } : p,
  );
  assert.equal(mvpFor(absent, 'carry'), null);
  assert.ok(mvpFor(absent, 'mid').score > 0);
  assert.equal(mvpFor([], 'a'), null);
  assert.equal(mvpFor(undefined, 'a'), null);
  // Une seule equipe : aucun vis-a-vis, donc aucune note possible.
  assert.equal(mvpFor([PARTIE[0], PARTIE[1]], 'carry'), null);
});

test('un KDA nettement moins bon ne passe pas devant grace aux degats', () => {
  // Chiffres reels (EUW1_8027564610). La Seraphine en 2/10/14 passait ACE
  // devant la Sejuani en 4/6/12 : meme total de kills + assists, des morts qui
  // ne pesaient que 20 %, et ses degats comme sa vision battaient la Nami d'en
  // face pendant que la Sejuani affrontait le meilleur joueur de la partie.
  const partie = [
    joueur('ekko', 'JUNGLE', true, { k: 14, d: 7, a: 7, dmg: 39013, gold: 13305, vis: 48, ctrl: 2 }),
    joueur('nami', 'UTILITY', true, { k: 1, d: 6, a: 25, dmg: 11620, gold: 8907, vis: 65, ctrl: 7 }),
    joueur('sejuani', 'JUNGLE', false, { k: 4, d: 6, a: 12, dmg: 23481, gold: 10481, vis: 23, ctrl: 1 }),
    joueur('seraphine', 'UTILITY', false, { k: 2, d: 10, a: 14, dmg: 14501, gold: 7871, vis: 71, ctrl: 9 }),
  ];

  assert.equal(mvpFor(partie, 'sejuani').badge, 'ACE');
  assert.equal(mvpFor(partie, 'seraphine').badge, null);
  assert.ok(
    mvpFor(partie, 'sejuani').score > mvpFor(partie, 'seraphine').score,
    `sejuani ${mvpFor(partie, 'sejuani').score} vs seraphine ${mvpFor(partie, 'seraphine').score}`,
  );
});
