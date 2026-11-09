import assert from 'node:assert/strict';
import test from 'node:test';

import { extractMatchResult } from '../src/riot.js';

/** Participant minimal : seuls le camp, le poste et le champion comptent ici. */
function joueur(puuid, teamId, teamPosition, championName) {
  return { puuid, teamId, teamPosition, championName, kills: 1, deaths: 1, assists: 1, win: teamId === 100 };
}

// Ordre volontairement melange, comme le JSON de Riot ne garantit rien.
const PARTIE = {
  metadata: { matchId: 'EUW1_test' },
  info: {
    gameDuration: 1800,
    gameEndTimestamp: 1000,
    participants: [
      joueur('bleu-supp', 100, 'UTILITY', 'Nami'),
      joueur('rouge-mid', 200, 'MIDDLE', 'Viktor'),
      joueur('bleu-top', 100, 'TOP', 'Ornn'),
      joueur('rouge-adc', 200, 'BOTTOM', 'Ezreal'),
      joueur('bleu-adc', 100, 'BOTTOM', 'Ashe'),
      joueur('rouge-top', 200, 'TOP', 'Mordekaiser'),
      joueur('bleu-jgl', 100, 'JUNGLE', 'JarvanIV'),
      joueur('rouge-supp', 200, 'UTILITY', 'Leona'),
      joueur('bleu-mid', 100, 'MIDDLE', 'Ahri'),
      joueur('rouge-jgl', 200, 'JUNGLE', 'Vi'),
    ],
  },
};

test('la composition sort dans l ordre des roles, alliés d abord', () => {
  const vu = extractMatchResult(PARTIE, 'bleu-top');
  assert.deepEqual(vu.composition.allies, ['Ornn', 'JarvanIV', 'Ahri', 'Ashe', 'Nami']);
  assert.deepEqual(vu.composition.adverses, ['Mordekaiser', 'Vi', 'Viktor', 'Ezreal', 'Leona']);

  // « Allié » dépend du joueur demandé : vu d'en face, les camps s'inversent.
  const enFace = extractMatchResult(PARTIE, 'rouge-jgl');
  assert.deepEqual(enFace.composition.allies, ['Mordekaiser', 'Vi', 'Viktor', 'Ezreal', 'Leona']);
  assert.deepEqual(enFace.composition.adverses, ['Ornn', 'JarvanIV', 'Ahri', 'Ashe', 'Nami']);
});

test('sans teamPosition, la composition garde l ordre du JSON', () => {
  // Vieilles parties et files particulières : le poste est vide. Un ordre
  // arbitraire reste préférable à une ligne absente.
  const sansPoste = {
    metadata: { matchId: 'EUW1_sans_poste' },
    info: {
      gameDuration: 1800,
      participants: PARTIE.info.participants.map((p) => ({ ...p, teamPosition: '' })),
    },
  };
  const vu = extractMatchResult(sansPoste, 'bleu-top');
  assert.deepEqual(vu.composition.allies, ['Nami', 'Ornn', 'Ashe', 'JarvanIV', 'Ahri']);
  assert.equal(vu.composition.adverses.length, 5);
});
