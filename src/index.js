// EN PREMIER : diagnostique une version de Node incompatible avant que
// l'import de la couche base de données n'échoue avec un message obscur.
import './preflight.js';

import { Client, GatewayIntentBits, MessageFlags, REST, Routes, SlashCommandBuilder } from 'discord.js';
import cron from 'node-cron';

import { assertConfig, config } from './config.js';
import { championEmoji } from './champemojis.js';
import { getChampion } from './champions.js';
import {
  buildDefeatGifMessage,
  buildMatchMessage,
  buildMessages,
  buildPlayerDetailMessage,
  renderText,
} from './embeds.js';
import { backfillTodayHistory, pollFinishedGames, primeLiveState } from './live.js';
import { loadRankEmojis, rankEmojiCount } from './emojis.js';
import { initLogger, log } from './logger.js';
import { buildPlayerDetail, buildReport, commitReport, primeDailySnapshots } from './report.js';
import { loadPromotionRoles, promotionRoleIds } from './roles.js';
import { APEX_TIERS, ladderPoints, rankLabel } from './rank.js';
import { loadStore } from './store.js';
import { lastScheduledOccurrence } from './time.js';
import {
  closeHistory,
  getPeak,
  getPlayerLinks,
  initializeHistory,
  listArchivedDates,
  recordRankSample,
  removePlayerLink,
  setPlayerLink,
} from './history.js';

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const RUN_NOW = args.has('--now');

// Paliers proposés par /pic. La valeur est le tier tel que Riot le nomme, le
// libellé reste en français comme le reste de l'interface.
const TIER_CHOICES = [
  ['Fer', 'IRON'],
  ['Bronze', 'BRONZE'],
  ['Argent', 'SILVER'],
  ['Or', 'GOLD'],
  ['Platine', 'PLATINUM'],
  ['Émeraude', 'EMERALD'],
  ['Diamant', 'DIAMOND'],
  ['Maître', 'MASTER'],
  ['Grand Maître', 'GRANDMASTER'],
  ['Challenger', 'CHALLENGER'],
].map(([name, value]) => ({ name, value }));

const COMMANDS = [
  new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Affiche la comparaison LP du jour (sans modifier le point de comparaison)')
    .addStringOption((option) =>
      option
        .setName('date')
        .setDescription('Journée archivée au format JJ-MM-AAAA (vide = résumé actuel)')
        .setAutocomplete(true),
    )
    .addBooleanOption((option) =>
      option.setName('global').setDescription('N’afficher que le bilan de la journée, sans le détail par joueur'),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('joueur')
    .setDescription("Résumé d'un joueur suivi, avec le détail de ses parties du jour")
    .addStringOption((option) =>
      option
        .setName('nom')
        .setDescription('Un joueur suivi, ou un Riot ID libre au format Pseudo#TAG')
        .setRequired(true)
        // Autocomplétion plutôt que choix fermés : Discord interdit d'avoir à
        // la fois une liste figée et de la saisie libre sur une même option.
        // Les joueurs suivis sont suggérés, mais n'importe quel Riot ID passe.
        .setAutocomplete(true),
    )
    .addStringOption((option) =>
      option
        .setName('date')
        .setDescription('Journée au format JJ-MM-AAAA (vide = aujourd’hui en temps réel)')
        .setAutocomplete(true),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('link')
    .setDescription('Lie un joueur suivi à un membre du serveur, pour qu’il soit mentionné')
    .addStringOption((option) =>
      option.setName('joueur').setDescription('Joueur suivi').setRequired(true).setAutocomplete(true),
    )
    .addUserOption((option) =>
      option.setName('membre').setDescription('Membre à lier — laisser vide pour délier'),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('pic')
    .setDescription('Déclare un pic atteint avant le suivi du bot (Riot ne le fournit pas)')
    .addStringOption((option) =>
      option.setName('joueur').setDescription('Joueur suivi').setRequired(true).setAutocomplete(true),
    )
    .addStringOption((option) =>
      option
        .setName('tier')
        .setDescription('Palier atteint')
        .setRequired(true)
        .addChoices(...TIER_CHOICES),
    )
    .addStringOption((option) =>
      option
        .setName('division')
        .setDescription('Division (ignorée pour Maître et au-dessus)')
        .addChoices(
          { name: 'I', value: 'I' },
          { name: 'II', value: 'II' },
          { name: 'III', value: 'III' },
          { name: 'IV', value: 'IV' },
        ),
    )
    .addIntegerOption((option) =>
      option.setName('lp').setDescription('LP à ce moment-là (0 par défaut)').setMinValue(0).setMaxValue(5000),
    )
    .toJSON(),
];

async function registerCommands(client) {
  const rest = new REST().setToken(config.discordToken);
  const appId = client.application.id;
  // Enregistrement sur le serveur = disponible tout de suite ; en global,
  // Discord peut mettre jusqu'a une heure a propager la commande.
  const route = config.guildId
    ? Routes.applicationGuildCommands(appId, config.guildId)
    : Routes.applicationCommands(appId);
  await rest.put(route, { body: COMMANDS });
  const noms = COMMANDS.map((c) => '/' + c.name).join(', ');
  log(`Commandes enregistrées : ${noms} (${config.guildId ? 'serveur ' + config.guildId : 'global'})`);
}

async function postDailyReport(client, reason) {
  log(`Génération du résumé (${reason})…`);
  // Rafraichi a chaque envoi : les emojis du serveur peuvent etre ajoutes,
  // renommes ou supprimes pendant que le bot tourne.
  await loadRankEmojis(client);
  const report = await buildReport();
  const channel = await client.channels.fetch(config.channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    throw new Error(`Le salon ${config.channelId} est introuvable ou n'accepte pas de messages`);
  }

  try {
    // Plusieurs messages au-delà de 10 joueurs (limite d'encarts par message).
    for (const message of buildMessages(report)) await channel.send(message);
  } catch (err) {
    // 50001 Missing Access / 50013 Missing Permissions : la cause est presque
    // toujours une exception de permission posee sur le salon lui-meme, que le
    // message brut de Discord ne permet pas de deviner.
    if (err.code === 50001 || err.code === 50013) {
      throw new Error(
        `Permissions insuffisantes sur #${channel.name ?? config.channelId}. ` +
          `Modifier le salon > Permissions > ajoute le bot et autorise ` +
          `« Voir le salon », « Envoyer des messages » et « Intégrer des liens ».`,
      );
    }
    throw err;
  }

  // Apres l'envoi seulement : voir commitReport().
  await commitReport(report);
  log('Résumé publié.');
}

/** Résout l'icône de champion d'une partie, pour un rendu d'encart synchrone. */
async function decorateMatch(client, match) {
  match.champion = await getChampion(match.championName);
  match.emoji = await championEmoji(client, match.champion);
}

// Un passage lent ne doit pas se superposer au suivant : sans ce verrou, deux
// cycles concurrents pourraient annoncer deux fois la meme partie.
let liveRunning = false;

async function runLiveCheck(client) {
  if (liveRunning) return;
  liveRunning = true;
  try {
    const announces = await pollFinishedGames();
    if (!announces.length) return;

    const channel = await client.channels.fetch(config.liveChannelId).catch(() => null);
    if (!channel?.isTextBased()) {
      log(`Salon des annonces inaccessible (${config.liveChannelId})`);
      return;
    }

    await loadRankEmojis(client);
    // Relues a chaque lot : une liaison posee entre deux passages doit prendre
    // effet sans redemarrage.
    const links = await getPlayerLinks().catch(() => new Map());
    for (const announce of announces) {
      await decorateMatch(client, announce.match);
      await channel.send(buildMatchMessage({ ...announce, links, roleIds: promotionRoleIds() }));

      // Message a part : Discord ne genere l'apercu d'un lien que depuis le
      // contenu d'un message, jamais depuis un encart.
      const gif = buildDefeatGifMessage(announce.player, announce.match, links);
      if (gif) await channel.send(gif);
      if (announce.promotion) {
        log(`Montée de rang : ${announce.player.label} → ${announce.promotion.vers}`);
      }
      const issue = announce.match.remake ? 'remake' : announce.match.win ? 'victoire' : 'défaite';
      log(`Partie annoncée : ${announce.player.label} — ${announce.match.champion.name} — ${issue}`);
    }
  } catch (err) {
    log('Échec de la surveillance des parties :', err.message);
  } finally {
    liveRunning = false;
  }
}

/**
 * /link : associe un joueur suivi a un membre du serveur.
 *
 * Ouverte a tout le monde, comme demande. Sans membre, la liaison est retiree.
 */
async function handleLinkCommand(interaction) {
  const playerKey = interaction.options.getString('joueur');
  const player = config.players.find((p) => p.key === playerKey);
  if (!player) {
    await interaction.reply({
      content: `⚠️ « ${playerKey} » n'est pas un joueur suivi. Choisis-en un dans la liste proposée.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const membre = interaction.options.getUser('membre');
  if (!membre) {
    const existait = await removePlayerLink(player.key);
    await interaction.reply(
      existait
        ? `**${player.label}** n'est plus lié à personne.`
        : `**${player.label}** n'était lié à personne.`,
    );
    return;
  }

  await setPlayerLink(player.key, membre.id, interaction.user.id);
  // La reponse ne mentionne personne : confirmer une liaison ne justifie pas
  // de notifier le membre concerne.
  await interaction.reply({
    content: `**${player.label}** est désormais lié à <@${membre.id}>, qui sera mentionné dans les annonces.`,
    allowedMentions: { parse: [] },
  });
}

/**
 * /pic : declare un rang atteint avant que le bot n'observe le joueur.
 *
 * Riot n'expose aucun historique de rang, donc tout ce qui precede le suivi est
 * definitivement perdu. La declaration est enregistree comme un releve parmi
 * les autres, avec `source = 'manual'` : le pic reste un simple maximum, sans
 * cas particulier a gerer a la lecture.
 */
async function handlePeakCommand(interaction) {
  const playerKey = interaction.options.getString('joueur');
  const player = config.players.find((p) => p.key === playerKey);
  if (!player) {
    await interaction.reply({
      content: `⚠️ « ${playerKey} » n'est pas un joueur suivi. Choisis-en un dans la liste proposée.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const tier = interaction.options.getString('tier');
  const apex = APEX_TIERS.includes(tier);
  // Maitre, Grand Maitre et Challenger n'ont pas de division ; en imposer une
  // fausserait le calcul de position sur l'echelle.
  const rank = apex ? 'I' : interaction.options.getString('division') ?? 'IV';
  const leaguePoints = interaction.options.getInteger('lp') ?? 0;

  const entry = { tier, rank, leaguePoints };
  const ladder = ladderPoints(entry);
  if (!Number.isFinite(ladder)) {
    await interaction.reply({ content: '⚠️ Rang invalide.', flags: MessageFlags.Ephemeral });
    return;
  }

  await recordRankSample({
    playerKey: player.key,
    playerLabel: player.label,
    entry,
    ladder,
    source: 'manual',
  });

  const peak = await getPeak(player.key);
  const retenu = peak && peak.ladder > ladder;
  await interaction.reply(
    retenu
      ? `Relevé enregistré pour **${player.label}**, mais le pic reste **${rankLabel(peak.entry)} ${peak.entry.leaguePoints ?? 0} LP**, qui est plus haut.`
      : `Pic de **${player.label}** fixé à **${rankLabel(entry)} ${leaguePoints} LP**.`,
  );
}

async function main() {
  if (DRY_RUN) {
    // Aucun acces Discord : on verifie juste la chaine Riot -> rapport.
    assertConfig({ discord: false });
    const report = await buildReport();
    console.log('\n' + renderText(report) + '\n');
    return;
  }

  assertConfig({ discord: true });
  // Apres le mode --dry-run, qui doit rester une simple sortie console.
  initLogger();
  const history = await initializeHistory();
  log(
    history.imported
      ? `Historique SQLite initialise (${history.imported} variation(s) JSON importee(s))`
      : 'Historique SQLite initialise',
  );
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once('clientReady', async () => {
    log(`Connecté en tant que ${client.user.tag}`);

    try {
      if (RUN_NOW) {
        await postDailyReport(client, 'demandé via --now');
        return;
      }

      await registerCommands(client);

      // Avant toute publication : un joueur fraichement ajoute doit avoir sa
      // reference, sinon son premier resume affiche "premiere mesure".
      const poses = await primeDailySnapshots();
      if (poses.length) log(`Référence initiale posée pour : ${poses.join(', ')}`);

      await loadRankEmojis(client);
      const emojis = rankEmojiCount();
      log(
        emojis
          ? `Emojis de rang trouvés : ${emojis}/10`
          : "Aucun emoji de rang trouvé sur le serveur, rendu sans icône (nomme-les Iron, Bronze, … Challenger)",
      );

      const { hour, minute } = config.dailyTime;
      cron.schedule(`${minute} ${hour} * * *`, () => {
        postDailyReport(client, 'planifié').catch((err) => log('Échec du résumé planifié :', err.message));
      }, { timezone: config.timezone });
      log(`Résumé quotidien programmé à ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} (${config.timezone})`);

      const roles = await loadPromotionRoles(client);
      if (roles.length) log(`Mention en cas de montée de rang : ${config.promotionRoles.join(', ')}`);

      if (config.liveCheck) {
        // Amorce l'etat depuis les instantanes existants pour que le premier
        // delta de LP annonce soit juste, puis premiere passe immediate.
        await primeLiveState();
        const backfilled = await backfillTodayHistory();
        if (backfilled) log(`Historique du jour rattrapé : ${backfilled} partie(s)`);
        setInterval(() => runLiveCheck(client), config.liveIntervalMin * 60_000);
        runLiveCheck(client);
        log(`Surveillance des parties toutes les ${config.liveIntervalMin} min`);
      }

      // Rattrapage : le PC est peut-etre reste eteint a l'heure prevue.
      if (config.catchUp) {
        const store = await loadStore();
        const due = lastScheduledOccurrence(new Date(), config.dailyTime, config.timezone);
        const last = store.lastReportAt ? new Date(store.lastReportAt) : null;
        if (!last || last < due) {
          await postDailyReport(client, last ? 'rattrapage' : 'premier lancement');
        }
      }
    } catch (err) {
      log('Erreur au démarrage :', err.message);
      process.exitCode = 1;
    } finally {
      // --now est un one-shot : sans cette fermeture, une publication en echec
      // laissait le client connecte et le processus tournait indefiniment.
      if (RUN_NOW) {
        await client.destroy();
        closeHistory();
      }
    }
  });

  client.on('interactionCreate', async (interaction) => {
    // Suggestions des joueurs et des dates reellement presentes dans SQLite.
    // Discord exige une reponse sous 3 s.
    if (interaction.isAutocomplete()) {
      const focused = interaction.options.getFocused(true);
      const saisie = String(focused.value ?? '').toLowerCase();
      if (focused.name === 'date') {
        const selectedPlayer = interaction.commandName === 'joueur'
          ? interaction.options.getString('nom')
          : null;
        const playerKey = config.players.some((player) => player.key === selectedPlayer)
          ? selectedPlayer
          : null;
        const dates = await listArchivedDates(playerKey, 25).catch(() => []);
        await interaction.respond(
          dates
            .filter((date) => date.includes(saisie))
            .slice(0, 25)
            .map((date) => ({ name: date, value: date })),
        ).catch(() => {});
        return;
      }

      const suggestions = config.players
        .filter((p) => p.label.toLowerCase().includes(saisie))
        .slice(0, 25)
        .map((p) => ({ name: p.label, value: p.key }));
      await interaction.respond(suggestions).catch(() => {});
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;
    if (!['resume', 'joueur', 'pic', 'link'].includes(commandName)) return;

    if (commandName === 'pic') {
      await handlePeakCommand(interaction);
      return;
    }

    if (commandName === 'link') {
      await handleLinkCommand(interaction);
      return;
    }

    // La collecte Riot depasse les 3 s allouees a une reponse immediate.
    await interaction.deferReply();
    try {
      await loadRankEmojis(client);

      if (commandName === 'resume') {
        // Pas de commitReport ici : un apercu a la demande ne doit pas consommer
        // le delta que le resume du soir doit encore afficher.
        const date = interaction.options.getString('date');
        const onlyGlobal = interaction.options.getBoolean('global') ?? false;
        const [premier, ...suite] = buildMessages(await buildReport(date), { onlyGlobal });
        await interaction.editReply(premier);
        // Une reponse ne porte que 10 encarts : le reste part en messages liés.
        for (const message of suite) await interaction.followUp(message);
        return;
      }

      // Un Riot ID libre est consulte sans etre ajoute a PLAYERS : rien n'est
      // ecrit dans le fichier d'instantanes par ce chemin.
      const detail = await buildPlayerDetail(
        interaction.options.getString('nom'),
        interaction.options.getString('date'),
      );
      for (const match of detail.matches) await decorateMatch(client, match);
      await interaction.editReply(buildPlayerDetailMessage(detail));
    } catch (err) {
      log(`Erreur /${commandName} :`, err.message);
      await interaction.editReply({ content: `⚠️ Impossible de récupérer les données : ${err.message}` });
    }
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      log('Arrêt…');
      client.destroy().finally(() => {
        closeHistory();
        process.exit(0);
      });
    });
  }

  await client.login(config.discordToken);
}

main().catch((err) => {
  console.error('\n' + (err?.message ?? err) + '\n');
  process.exit(1);
});
