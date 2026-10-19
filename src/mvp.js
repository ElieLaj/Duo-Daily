/**
 * Score de performance sur 10, dans l'esprit de l'OP Score.
 *
 * OP.GG ne publie pas sa formule — « estimates in-game performance based on
 * summoner stats », encore en beta de leur propre aveu. Il n'y a donc rien a
 * repliquer : le calcul est maison. Deux conventions sont reprises parce
 * qu'elles sont devenues le langage commun : l'echelle 0-10, et MVP au
 * meilleur des gagnants / ACE au meilleur des perdants.
 *
 * LA REFERENCE EST LE VIS-A-VIS, le joueur qui tenait le meme poste en face.
 *
 * Mesurer la part de son equipe paraissait naturel, mais condamne les roles
 * pauvres : un support ne touchera jamais autant d'or qu'un ADC, et se
 * retrouvait note comme s'il avait rate sa partie. Compare a l'autre support,
 * l'or redevient un signal honnete — et la meme grille de poids vaut alors
 * pour les cinq roles, sans table a calibrer par poste.
 *
 * Une mesure absolue a ete essayee en complement — la participation aux kills,
 * pour que porter une partie compte plus que d'ecraser un adversaire deja
 * perdu. Elle a ete retiree : normalisee sur la moyenne de l'equipe, elle
 * ramenait le biais de role par la fenetre, un top ayant structurellement
 * moins d'assists qu'un support. Avec deux joueurs par poste dans une partie,
 * « absolu » et « neutre en role » sont inconciliables sans un bareme de
 * reference par role, que personne n'a envie de maintenir.
 *
 * La note dit donc : de combien tu as battu ton vis-a-vis. Les poids
 * totalisent 1,00, donc une partie en tout point egale a la sienne vaut
 * exactement 5,0.
 *
 * Aucun appel supplementaire a Riot : les dix participants sont deja dans le
 * JSON que getMatchResult telecharge.
 */

/**
 * Composantes comparees au joueur d'en face.
 *
 * La vision compte les wards de controle a part : elles coutent de l'or, et
 * c'est ce que visionScore sous-estime le plus chez un bon support.
 *
 * Les degats absorbes ont ete retires. Ils avaient ete ajoutes pour sauver le
 * tank du temps ou la reference etait l'equipe ; depuis le passage au duel, un
 * tank est deja compare a un tank et la composante ne faisait plus que du
 * bruit — entre deux supports, un engage qui encaisse ecrasait un enchanteur
 * sur une statistique qui ne dit rien de leur partie.
 */
const COMPOSANTES = [
  { poids: 0.3, de: (p) => (p.kills ?? 0) + (p.assists ?? 0) },
  { poids: 0.25, de: (p) => p.totalDamageDealtToChampions ?? 0 },
  { poids: 0.15, de: (p) => (p.visionScore ?? 0) + 2 * (p.detectorWardsPlaced ?? 0) },
  { poids: 0.1, de: (p) => p.goldEarned ?? 0 },
];

/**
 * Les morts comptent a l'envers.
 *
 * Calibre sur deux vraies parties comparees au classement OP.GG. Un poids plus
 * eleve rend la note trop sensible a un seul chiffre : a 0,25, un top en
 * 11/4/10 face a un 7/12/6 tirait 36 % de sa note du seul rapport de morts et
 * passait MVP devant un support en 4/9/34. A 0,20, les deux parties designent
 * le bon MVP.
 *
 * Le total des poids doit rester a 1,00, sans quoi une partie egale a celle de
 * son vis-a-vis ne vaut plus 5,0 — le test miroir le verifie.
 */
const POIDS_MORTS = 0.2;

/**
 * Plafond du rapport de force sur une composante.
 *
 * C'est le garde-fou central. Sans lui, la note recompense surtout d'avoir eu
 * un vis-a-vis mediocre : sur trois vraies parties comparees a OP.GG, un top
 * en 11/4/10 face a un 7/12/6, puis une Tristana a 50 000 degats face au pire
 * joueur de la partie, passaient MVP devant des joueurs bien meilleurs. Borner
 * chaque rapport a 1,2 fait tomber les trois MVP justes et monte la
 * correlation de rang de 0,77 a 0,84.
 *
 * Le reglage est un plateau : de 1,1 a 1,25 les resultats sont equivalents, et
 * ils se degradent nettement des 1,3. 1,2 est pris au milieu, a l'ecart du
 * decrochage.
 */
const PLAFOND = 1.2;

/**
 * Etale le bareme. L'exposant ne change aucun classement — c'est une fonction
 * croissante — il n'agit que sur l'affichage. Il est calibre pour que le
 * plafond ci-dessus corresponde a peu pres a 9/10 : sans lui, une note bornee
 * a 1,2 de rapport ne depasserait jamais 5,5.
 */
const EXPOSANT = 14;

/**
 * Rapport de force sur une statistique : 1,0 a egalite, borne par PLAFOND.
 *
 * Le lissage, au quart du total des deux, evite la division par zero. Le
 * plafond borne ensuite l'ecart dans les deux sens : ecraser son vis-a-vis
 * rapporte, mais pas indefiniment, et une composante ratee ne peut pas a elle
 * seule couler une partie par ailleurs solide.
 */
function duel(mien, sien) {
  const lissage = (mien + sien) / 4;
  const rapport = lissage > 0 ? (mien + lissage) / (sien + lissage) : 1;
  return Math.min(PLAFOND, Math.max(1 / PLAFOND, rapport));
}

/**
 * Joueur auquel se comparer : celui qui tenait le meme poste en face.
 *
 * teamPosition peut etre vide, et deux autofills peuvent occuper le meme
 * poste. A defaut, la moyenne de l'equipe adverse reste un repere correct.
 */
function visAVis(joueur, adversaires) {
  const poste = joueur.teamPosition || joueur.individualPosition;
  const memePoste = poste
    ? adversaires.filter((p) => (p.teamPosition || p.individualPosition) === poste)
    : [];
  if (memePoste.length === 1) return (de) => de(memePoste[0]);
  return (de) => adversaires.reduce((somme, p) => somme + de(p), 0) / adversaires.length;
}

/** Ratio de performance, ou 1,0 vaut exactement le niveau du vis-a-vis. */
function contribution(joueur, adversaires) {
  const reference = visAVis(joueur, adversaires);
  let ratio = 0;

  for (const { poids, de } of COMPOSANTES) {
    ratio += poids * duel(de(joueur), reference(de));
  }

  // Inverse : mourir moins que son vis-a-vis doit payer.
  ratio += POIDS_MORTS * duel(reference((p) => p.deaths ?? 0), joueur.deaths ?? 0);

  return ratio;
}

/** KDA classique, uniquement pour departager deux ratios identiques. */
function kda(p) {
  return ((p.kills ?? 0) + (p.assists ?? 0)) / Math.max(1, p.deaths ?? 0);
}

/**
 * Ratio converti en note sur 10.
 *
 * 10·r/(r+1) vaut 5 pile a egalite et tend vers 10 sans jamais l'atteindre :
 * la note est bornee par construction, sans clamp a ecrire.
 */
function note(ratio) {
  const r = Math.pow(Math.max(0, ratio), EXPOSANT);
  return Math.round(((10 * r) / (r + 1)) * 10) / 10;
}

/**
 * Note du joueur demande, et sa distinction eventuelle.
 *
 * @returns {{score: number, badge: 'MVP'|'ACE'|null}|null} null si le joueur
 *   est introuvable ou si la partie n'a pas deux camps.
 */
export function mvpFor(participants, puuid) {
  const tous = participants ?? [];
  const moi = tous.find((p) => p.puuid === puuid);
  if (!moi) return null;

  const campDe = (p) => tous.filter((x) => x.teamId === p.teamId);
  const adversairesDe = (p) => tous.filter((x) => x.teamId !== p.teamId);
  if (!adversairesDe(moi).length) return null;

  // La distinction se joue dans son propre camp, jamais contre les dix : le
  // meilleur d'une equipe battue reste ACE, meme si plusieurs gagnants le
  // devancent au classement general.
  //
  // Elle se decide sur le ratio brut, pas sur la note : l'arrondi au dixieme
  // est un detail d'affichage, et le laisser trancher reviendrait a designer
  // le MVP par l'ordre des participants des que deux joueurs tombent sur le
  // meme dixieme — ce qui arrive vraiment.
  const camp = campDe(moi);
  const ratios = camp.map((p) => contribution(p, adversairesDe(p)));
  const score = note(ratios[camp.indexOf(moi)]);

  // Un seul joueur distingue par camp, sinon une partie parfaitement
  // equilibree donnerait cinq MVP. A ratios strictement egaux, le badge revient
  // au meilleur KDA — un depart arbitraire sur l'ordre des participants ne
  // voudrait rien dire.
  let meilleur = 0;
  for (let i = 1; i < camp.length; i++) {
    const devance =
      ratios[i] > ratios[meilleur] ||
      (ratios[i] === ratios[meilleur] && kda(camp[i]) > kda(camp[meilleur]));
    if (devance) meilleur = i;
  }
  const distingue = camp[meilleur];

  return {
    score,
    badge: distingue.puuid === moi.puuid ? (moi.win ? 'MVP' : 'ACE') : null,
  };
}
