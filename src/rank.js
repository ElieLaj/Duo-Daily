/**
 * Conversion rang -> position absolue sur l'echelle classee.
 *
 * Indispensable pour calculer une difference de LP correcte a travers les
 * promotions : passer de Diamant III 93 LP a Diamant II 12 LP est un GAIN de
 * +19 LP, alors qu'une soustraction naive des `leaguePoints` donnerait -81.
 */

const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND'];
const APEX_TIERS = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];
const DIVISIONS = { IV: 0, III: 1, II: 2, I: 3 };

// Maitre / Grand Maitre / Challenger partagent une seule echelle de LP continue
// au-dessus de Diamant I : on leur donne donc la meme base.
const APEX_BASE = TIERS.length * 400;

const TIER_FR = {
  IRON: 'Fer',
  BRONZE: 'Bronze',
  SILVER: 'Argent',
  GOLD: 'Or',
  PLATINUM: 'Platine',
  EMERALD: 'Émeraude',
  DIAMOND: 'Diamant',
  MASTER: 'Maître',
  GRANDMASTER: 'Grand Maître',
  CHALLENGER: 'Challenger',
};

/** Position absolue sur l'echelle, ou null si non classe / tier inconnu. */
export function ladderPoints(entry) {
  if (!entry?.tier) return null;
  const tier = entry.tier.toUpperCase();
  const lp = Number(entry.leaguePoints) || 0;
  if (APEX_TIERS.includes(tier)) return APEX_BASE + lp;
  const index = TIERS.indexOf(tier);
  if (index < 0) return null;
  return index * 400 + (DIVISIONS[entry.rank] ?? 0) * 100 + lp;
}

// Palier occupe sur l'echelle, LP exclus : Fer IV = 0 ... Diamant I = 27,
// puis Maitre 28, Grand Maitre 29, Challenger 30.
const APEX_INDEX = { MASTER: 28, GRANDMASTER: 29, CHALLENGER: 30 };

/**
 * Index du palier (tier + division), sans les LP.
 *
 * Comparer deux index dit s'il y a eu montee ou descente de rang, ce que la
 * difference de LP ne permet pas : gagner 30 LP peut ne pas changer de palier,
 * et en gagner 5 peut faire passer une division.
 */
export function divisionIndex(entry) {
  if (!entry?.tier) return null;
  const tier = entry.tier.toUpperCase();
  if (APEX_INDEX[tier] !== undefined) return APEX_INDEX[tier];
  const index = TIERS.indexOf(tier);
  if (index < 0) return null;
  return index * 4 + (DIVISIONS[entry.rank] ?? 0);
}

/** "Diamant III" / "Maitre" / "Non classe" */
export function rankLabel(entry) {
  if (!entry?.tier) return 'Non classé';
  const tier = entry.tier.toUpperCase();
  const name = TIER_FR[tier] ?? tier;
  // Les tiers apex n'ont pas de division affichable.
  return APEX_TIERS.includes(tier) ? name : `${name} ${entry.rank ?? ''}`.trim();
}

// Couleur dominante de chaque embleme, pour la barre laterale de l'encart.
const TIER_COLOR = {
  IRON: 0x6b5a53,
  BRONZE: 0x8c5230,
  SILVER: 0x9aa4af,
  GOLD: 0xd4af37,
  PLATINUM: 0x4ba58f,
  EMERALD: 0x21a179,
  DIAMOND: 0x576bce,
  MASTER: 0x9d4dc3,
  GRANDMASTER: 0xcd4545,
  CHALLENGER: 0xf4c874,
};
const UNRANKED_COLOR = 0x6e6e6e;

/** Couleur associee au rang, pour la barre laterale de l'encart Discord. */
export function tierColor(entry) {
  if (!entry?.tier) return UNRANKED_COLOR;
  return TIER_COLOR[entry.tier.toUpperCase()] ?? UNRANKED_COLOR;
}

/** URL de l'embleme du rang (verifie : les 10 tiers repondent 200). */
export function emblemUrl(entry) {
  if (!entry?.tier) return null;
  const tier = entry.tier.toLowerCase();
  return `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-emblem/emblem-${tier}.png`;
}

export { TIERS, APEX_TIERS };
