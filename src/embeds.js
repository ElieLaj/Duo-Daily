import { EmbedBuilder } from 'discord.js';
import { config } from './config.js';
import { emblemUrl, ladderPoints, rankLabel, tierColor } from './rank.js';
import { rankEmoji } from './emojis.js';
import { opggUrl } from './links.js';
import { formatDateFr, formatDateTimeFr } from './time.js';

const COLOR = { error: 0xb91c1c, win: 0x22c55e, loss: 0xef4444, neutral: 0x94a3b8, promotion: 0xf59e0b };

// Discord ne colore le texte que dans un bloc ```ansi — au prix du cadre gris
// du bloc de code. Le style "clean" s'en passe et fait porter la couleur par la
// barre laterale de l'encart plus une pastille.
const ANSI = {
  reset: '[0m',
  green: '[1;32m',
  red: '[1;31m',
  grey: '[2;37m',
  bold: '[1;37m',
};

const QUEUE_LABEL = { RANKED_SOLO_5x5: 'Classée Solo/Duo', RANKED_FLEX_SR: 'Classée Flexible' };

/** "+39 LP" / "−27 LP" / "± 0 LP" / "première mesure" */
function deltaText(delta) {
  if (delta === undefined) return 'variation non mesurée';
  if (delta === null) return 'première mesure';
  if (delta === 0) return '± 0 LP';
  return `${delta > 0 ? '+' : '−'}${Math.abs(delta)} LP`;
}

// Ligne vide : Discord colle les champs a la description, un espace insecable
// seul sur sa ligne est le seul moyen d'aerer les deux blocs.
const SPACER = '\n​';

/** "Diamant II — 14 LP", ou juste "Non classé" si le joueur n'a pas de rang. */
function headline(lp, rank, emoji = '') {
  if (!rank) return lp;
  return `${emoji ? emoji + ' ' : ''}${rank} — ${lp}`;
}

// Pas d'emoji ici : un emoji custom ne s'affiche pas dans un bloc de code.
function describeAnsi(lp, delta, rank) {
  const color = delta === null || delta === 0 ? ANSI.grey : delta > 0 ? ANSI.green : ANSI.red;
  return (
    '```ansi\n' +
    `${ANSI.bold}${headline(lp, rank)}${ANSI.reset}  ${color}(${deltaText(delta)})${ANSI.reset}` +
    '\n```' +
    SPACER
  );
}

/**
 * Ligne discrète du pic, en sous-texte Discord (`-#`) : petit et grisé, pour
 * qu'il reste secondaire face au rang courant.
 *
 * N'est rendue que si le pic dépasse la position actuelle — sinon elle
 * répéterait le rang affiché juste au-dessus.
 */
function peakLine(player) {
  const peak = player.peak;
  if (!peak) return '';
  const actuel = ladderPoints(player.entry);
  if (Number.isFinite(actuel) && peak.ladder <= actuel) return '';

  const emoji = rankEmoji(peak.entry);
  const rang = `${emoji ? emoji + ' ' : ''}${rankLabel(peak.entry)} ${peak.entry.leaguePoints ?? 0} LP`;
  return `\n-# Pic : ${rang}`;
}

function describeClean(lp, delta, rank, emoji, note, peak = '') {
  const pastille = delta === null || delta === 0 ? '⚪' : delta > 0 ? '🟢' : '🔴';
  // "##" met le rang et les LP en gros ; la pastille porte la couleur du delta,
  // que la barre laterale ne peut plus indiquer puisqu'elle affiche le tier.
  // `note` precise sur quelle fenetre ce delta a ete mesure, quand elle differe
  // de la periode decrite par les champs en dessous.
  const ligne = `${pastille} **${deltaText(delta)}**` + (note ? `  ·  ${note}` : '');
  return `## ${headline(lp, rank, emoji)}\n${ligne}${peak}${SPACER}`;
}

/**
 * @param {object} [options]
 * @param {{total:number,wins:number,losses:number,truncated?:boolean}} [options.stats]
 *   comptage à afficher, si différent de la fenêtre de comparaison.
 * @param {string} [options.deltaNote] précision accolée au delta de LP.
 *
 * Les deux servent au détail d'un joueur : les champs y décrivent la journée
 * (cohérents avec la liste des parties affichée juste en dessous), tandis que
 * le delta de LP porte sa propre fenêtre, qui est différente.
 */
function playerEmbed(player, url, options = {}) {
  const { stats, deltaNote, gamesLabel = 'Nombre de games' } = options;
  if (player.error) {
    return new EmbedBuilder()
      .setColor(COLOR.error)
      .setAuthor({ name: player.label, url })
      .setDescription(`⚠️ ${player.error}`);
  }

  const lp = player.entry
    ? `${player.entry.leaguePoints} LP`
    : player.rankUnknown
      ? 'Rang non archivé'
      : 'Non classé';
  const rank = player.entry ? rankLabel(player.entry) : null;

  const embed = new EmbedBuilder()
    // Barre laterale = couleur du tier. La couleur du delta de LP est portee
    // par la pastille, pas par la barre.
    .setColor(tierColor(player.entry))
    // Le pseudo renvoie vers le profil op.gg quand l'URL est fournie.
    .setAuthor({ name: player.label, iconURL: player.iconUrl ?? undefined, url })
    .setDescription(
      config.lpStyle === 'ansi'
        ? describeAnsi(lp, player.delta, rank)
        : describeClean(lp, player.delta, rank, rankEmoji(player.entry), deltaNote, peakLine(player)),
    );

  // EMBLEM_STYLE=none par defaut : l'embleme de rang alourdit l'encart sans
  // rien apporter, le nom du rang et la couleur de la barre suffisent.
  const emblem = config.emblemStyle === 'none' ? null : emblemUrl(player.entry);
  if (emblem) {
    if (config.emblemStyle === 'image') embed.setImage(emblem);
    else embed.setThumbnail(emblem);
  }

  const { total, wins, losses, truncated } = stats ?? player.games;
  const fields = [
    {
      name: gamesLabel,
      value: `${total} ${total > 1 ? 'parties' : 'partie'}${truncated ? '+' : ''}`,
      inline: true,
    },
  ];

  // Totaux cumulés de la saison, tels que Riot les tient pour la file suivie.
  const saisonV = player.entry?.wins;
  const saisonD = player.entry?.losses;
  if (Number.isFinite(saisonV) && Number.isFinite(saisonD)) {
    const jouees = saisonV + saisonD;
    const wr = jouees > 0 ? ` (${Math.round((saisonV / jouees) * 100)} %)` : '';
    fields.push({ name: 'Saison', value: `${saisonV} V — ${saisonD} D${wr}`, inline: true });
  }

  // Le winrate est fondu dans le bilan : Discord n'aligne que trois champs par
  // rangée, un quatrième partirait seul à la ligne.
  const wr = total > 0 ? ` (${Math.round((wins / total) * 100)} %)` : '';
  fields.push({ name: 'Bilan', value: `${wins} V — ${losses} D${wr}`, inline: true });

  embed.addFields(fields);
  return embed;
}

/** "12/3/8 (6.7)", ou "Remake" si la partie n'a pas compté. */
function kdaText(match) {
  if (match.remake) return 'Remake';
  const ratio = match.deaths === 0 ? 'Parfait' : ((match.kills + match.assists) / match.deaths).toFixed(1);
  return `${match.kills}/${match.deaths}/${match.assists} (${ratio})`;
}

/** "189 CS (7.2/min)" — le rythme est omis si la durée est inconnue. */
function farmText(match) {
  if (match.remake || !Number.isFinite(match.cs)) return null;
  const minutes = match.durationSec ? match.durationSec / 60 : 0;
  const perMin = minutes > 0 ? ` (${(match.cs / minutes).toFixed(1)}/min)` : '';
  return `${match.cs} CS${perMin}`;
}

/**
 * Détail d'un joueur : le résumé habituel, plus la liste des parties du jour.
 * Les icônes de champion sont des emojis d'application résolus en amont
 * (`match.emoji`) : un embed ne peut pas afficher d'image au fil du texte.
 */
export function buildPlayerDetailMessage(detail) {
  const url = opggUrl(detail.player.gameName, detail.player.tagLine);

  if (detail.error) {
    return {
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR.error)
          .setAuthor({ name: detail.label, url })
          .setDescription(`⚠️ ${detail.error}`),
      ],
    };
  }

  // Les champs décrivent la journée, comme la liste juste en dessous : afficher
  // ici le comptage de la fenêtre de comparaison donnerait un « 1 V — 0 D »
  // incohérent avec 7 parties listées.
  const jour = detail.matches.reduce(
    (acc, m) => {
      if (m.remake) return acc;
      acc.total++;
      if (m.win) acc.wins++;
      else acc.losses++;
      return acc;
    },
    { total: 0, wins: 0, losses: 0, truncated: detail.truncated },
  );

  const mesure = detail.historical ? detail.measuredGames : detail.games.total;
  const partiesLabel = detail.selectedDate ? `Parties du ${detail.dateLabel}` : 'Parties du jour';
  // Le champ de comptage porte déjà `partiesLabel` : nommer la liste de la même
  // façon donnerait deux champs homonymes dans le même encart.
  const detailLabel = 'Détail des parties';
  const embed = playerEmbed(detail, url, {
    stats: jour,
    gamesLabel: partiesLabel,
    // Le delta de LP, lui, se rapporte bien à la fenêtre de comparaison : on le
    // dit explicitement plutôt que de laisser croire qu'il couvre la journée.
    deltaNote: detail.historical
      ? mesure > 0
        ? `sur ${mesure} partie${mesure > 1 ? 's' : ''} mesurée${mesure > 1 ? 's' : ''}`
        : null
      : detail.delta === null
        ? null
        : `sur ${mesure} game${mesure > 1 ? 's' : ''} mesurée${mesure > 1 ? 's' : ''} (${detail.games.wins} V — ${detail.games.losses} D)`,
  });

  const lines = detail.matches.map((match) => {
    const pastille = match.remake ? '⚪' : match.win ? '🟢' : '🔴';
    // La variation de LP n'existe que pour les parties observées en direct.
    const lp = Number.isFinite(match.lpDelta) ? ` ${deltaText(match.lpDelta)}` : '';
    const issue = `${pastille} ${issueText(match)}${lp}`;
    const icon = match.emoji ? `${match.emoji} ` : '';
    const parts = [`**${match.champion?.name ?? match.championName}**`, kdaText(match), farmText(match), issue];
    return icon + parts.filter(Boolean).join(' — ');
  });

  if (lines.length) {
    if (detail.truncated) lines.push('*Seules les parties les plus récentes sont détaillées.*');

    // Un champ Discord est plafonné à 1024 caractères. Plutôt que de sacrifier
    // des parties, la liste est répartie sur plusieurs champs (25 autorisés).
    const blocs = [];
    let bloc = '';
    for (const line of lines) {
      if (bloc && bloc.length + line.length + 1 > 1000) {
        blocs.push(bloc);
        bloc = '';
      }
      bloc += (bloc ? '\n' : '') + line;
    }
    if (bloc) blocs.push(bloc);

    blocs.forEach((value, index) => {
      // Un nom de champ ne peut pas être vide côté Discord.
      embed.addFields({ name: index === 0 ? `${detailLabel} (${detail.matches.length})` : '(suite)', value });
    });
  } else {
    embed.addFields({
      name: detailLabel,
      value: detail.selectedDate
        ? `*Aucune partie classée archivée le ${detail.dateLabel}.*`
        : '*Aucune partie classée aujourd’hui.*',
    });
  }

  // Pas de champ « Pic » ici : il est déjà rendu en sous-texte sous la
  // variation de LP par playerEmbed, discrètement, comme demandé.
  embed.addFields({ name: 'Profil', value: `[Voir sur op.gg](${url})` });

  const footer = [QUEUE_LABEL[config.queue] ?? config.queue, `résumé du ${detail.dateLabel}`];
  if (detail.previous?.takenAt) {
    footer.push(`comparé au ${formatDateTimeFr(new Date(detail.previous.takenAt), config.timezone)}`);
  }
  embed.setFooter({ text: footer.join(' · ') });

  return { embeds: [embed] };
}

/** Une série de ce nombre de victoires consécutives mérite la flamme. */
const STREAK_MIN = 3;

/**
 * "Victoire", "Victoire 🔥", ou "Victoire 🔥 4 d'affilée" en mode détaillé.
 * @param {boolean} [verbose] la liste compacte des parties du jour reste brève ;
 *   l'annonce d'une partie unique peut se permettre le décompte.
 */
function issueText(match, verbose = false) {
  if (match.remake) return 'Remake';

  if (!match.win) {
    if (!(match.lossStreak >= STREAK_MIN)) return 'Défaite';
    return verbose ? `Défaite 🤡 ${match.lossStreak} d'affilée` : 'Défaite 🤡';
  }
  if (!(match.streak >= STREAK_MIN)) return 'Victoire';
  return verbose ? `Victoire 🔥 ${match.streak} d'affilée` : 'Victoire 🔥';
}

/**
 * Ligne de record personnel, en sous-texte et sans mention : battre son pic
 * arrive bien plus souvent qu'une montée de rang, ça ne justifie pas de
 * notifier tout le monde.
 */
function recordLine(record) {
  if (!record) return '';
  const ancien = `${rankLabel(record.depuis)} ${record.depuis.leaguePoints ?? 0} LP`;
  const depuis = Number.isFinite(record.jours)
    ? ` — ancien record : ${ancien}, il y a ${record.jours} jour${record.jours > 1 ? 's' : ''}`
    : ` — dépasse le pic déclaré : ${ancien}`;
  return `\n-# 🏔️ Nouveau record personnel${depuis}`;
}

/** "32:15" */
function durationText(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  return `${m}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

/**
 * Annonce d'une partie qui vient de se terminer (surveillance périodique).
 * `match.emoji` et `match.champion` sont résolus en amont, comme pour /joueur.
 */
export function buildMatchMessage({
  player,
  match,
  entry,
  delta,
  deltaGames = 1,
  promotion,
  record,
  roleIds = [],
  skipped,
}) {
  const url = opggUrl(player.gameName, player.tagLine);
  const issue = issueText(match, true);
  const icon = match.emoji ? `${match.emoji} ` : '';

  // La variation n'est accolée au titre que lorsqu'elle porte sur cette seule
  // partie : sinon le chiffre couvrirait plusieurs parties, et une défaite
  // pourrait s'afficher avec un gain.
  const lpTitre = deltaGames === 1 && Number.isFinite(delta) ? ` (${deltaText(delta)})` : '';

  const embed = new EmbedBuilder()
    .setColor(match.remake ? COLOR.neutral : match.win ? COLOR.win : COLOR.loss)
    .setAuthor({ name: `${player.label} a terminé une partie`, iconURL: player.iconUrl ?? undefined, url })
    .setDescription(
      `## ${icon}${match.champion?.name ?? match.championName} — ${issue}${lpTitre}` + recordLine(record),
    );

  const fields = [{ name: 'K/D/A', value: kdaText(match), inline: true }];
  const farm = farmText(match);
  if (farm) fields.push({ name: 'Farm', value: farm, inline: true });
  const duration = durationText(match.durationSec);
  if (duration) fields.push({ name: 'Durée', value: duration, inline: true });

  // Le champ est toujours présent : un joueur non classé ou sans référence doit
  // quand même voir où il en est, plutôt qu'une ligne absente sans explication.
  // Les espaces sont normalisés APRÈS assemblage : l'emoji de rang peut être
  // absent, et un trim naïf mangerait le séparateur qui le précède.
  const rang = entry
    ? [rankEmoji(entry), rankLabel(entry), `${entry.leaguePoints} LP`].filter(Boolean).join(' ')
    : 'Non classé';

  let variation;
  if (deltaGames === 0) {
    // Partie plus ancienne d'un lot : la variation appartient à la plus
    // récente, l'attribuer ici serait un chiffre inventé.
    variation = null;
  } else if (delta === null || delta === undefined) {
    variation = '⚪ *première partie observée*';
  } else {
    const pastille = delta === 0 ? '⚪' : delta > 0 ? '🟢' : '🔴';
    // Au-delà d'une partie, on dit explicitement ce que le chiffre recouvre.
    const portee = deltaGames > 1 ? ` *(sur ${deltaGames} parties)*` : '';
    variation = `${pastille} **${deltaText(delta)}**${portee}`;
  }

  fields.push({
    // Sans variation à montrer, intituler le champ « Variation de LP » serait
    // trompeur : il ne porte alors que la position courante.
    name: variation ? 'Variation de LP' : 'Rang actuel',
    value: variation ? `${variation} · ${rang}` : rang,
    inline: false,
  });
  embed.addFields(fields);

  if (skipped > 0) {
    embed.setFooter({ text: `${skipped} partie${skipped > 1 ? 's' : ''} plus ancienne${skipped > 1 ? 's' : ''} non annoncée${skipped > 1 ? 's' : ''}` });
  }

  const message = { embeds: [embed] };

  if (promotion) {
    embed.setColor(COLOR.promotion);
    // La mention DOIT être dans le contenu : une mention placée dans un embed
    // s'affiche mais ne déclenche aucune notification.
    const ping = roleIds.map((id) => `<@&${id}> `).join('');
    message.content =
      `${ping}🎉 **${player.label}** passe **${promotion.vers}** ! ` +
      `*(depuis ${promotion.depuis})*`;
    // Liste blanche explicite : le message ne peut mentionner que ces rôles,
    // jamais @everyone ni un membre dont le pseudo ressemblerait à une mention.
    message.allowedMentions = { roles: roleIds, parse: [] };
  }

  return message;
}

// Discord refuse un message de plus de 10 encarts : au-delà, le résumé doit
// être découpé, sans quoi l'envoi échouerait entièrement.
const MAX_EMBEDS = 10;

/**
 * Résumé complet, découpé en autant de messages que nécessaire.
 * @returns {Array<{content?:string, embeds:Array}>} à envoyer dans l'ordre.
 */
export function buildMessages(report) {
  const embeds = report.players.map((player) =>
    playerEmbed(player, opggUrl(player.gameName, player.tagLine), {
      gamesLabel: report.historical ? 'Parties de la journée' : 'Nombre de games',
      deltaNote:
        report.historical && player.measuredGames > 0
          ? `sur ${player.measuredGames} partie${player.measuredGames > 1 ? 's' : ''} mesurée${player.measuredGames > 1 ? 's' : ''}`
          : null,
    }),
  );

  const footer = [QUEUE_LABEL[config.queue] ?? config.queue];
  if (report.comparedTo) footer.push(`comparé au ${formatDateTimeFr(report.comparedTo, config.timezone)}`);
  embeds.at(-1)?.setFooter({ text: footer.join(' · ') });

  const messages = [];
  for (let i = 0; i < embeds.length; i += MAX_EMBEDS) {
    messages.push({ embeds: embeds.slice(i, i + MAX_EMBEDS) });
  }
  if (!messages.length) messages.push({ embeds: [] });
  // Le titre ne coiffe que le premier message.
  messages[0].content = `## Résumé du ${report.dateLabel}`;
  return messages;
}

/** Rendu texte equivalent, pour tester en console sans passer par Discord. */
export function renderText(report) {
  const lines = [`Résumé du ${report.dateLabel}`, ''];
  for (const player of report.players) {
    if (player.error) {
      lines.push(`${player.label} — ERREUR : ${player.error}`, '');
      continue;
    }
    const lp = player.entry ? `${player.entry.leaguePoints} LP` : 'Non classé';
    // Le rang n'est ajouté que s'il existe : sinon `lp` vaut déjà "Non classé"
    // et la ligne le répéterait deux fois.
    const rang = player.entry ? ` - ${rankLabel(player.entry)}` : '';
    lines.push(
      `${player.label} - ${lp} (${deltaText(player.delta)})${rang}`,
      `Nombre de games: ${player.games.total} parties`,
      `Nb Victoires: ${player.games.wins} - Nb défaites: ${player.games.losses}`,
      '',
    );
  }
  if (report.comparedTo) lines.push(`(comparé au ${formatDateTimeFr(report.comparedTo, config.timezone)})`);
  return lines.join('\n');
}
