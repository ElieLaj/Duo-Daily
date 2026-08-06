/**
 * Poste un resume synthetique dans le salon configure, pour juger le rendu
 * sans attendre que les LP bougent reellement.
 *
 *   npm run preview
 *
 * Ne touche ni a l'API Riot ni a data/snapshots.json : les donnees sont
 * fabriquees ici. Modifie CAS ci-dessous pour tester d'autres situations.
 */
import { Client, GatewayIntentBits } from 'discord.js';
import { assertConfig, config } from '../src/config.js';
import { buildMessage } from '../src/embeds.js';
import { loadRankEmojis, rankEmojiCount } from '../src/emojis.js';
import { profileIconUrl } from '../src/ddragon.js';
import { formatDateFr } from '../src/time.js';

// Une vraie icone de profil, pour que l'apercu rende exactement comme le
// message reel (l'en-tete perd son icone si on laisse iconUrl a null).
const icon = await profileIconUrl(7103);

const player = (label, tier, rank, lp, delta, wins, losses) => ({
  label,
  entry: { tier, rank, leaguePoints: lp, queueType: config.queue },
  delta,
  games: { total: wins + losses, wins, losses },
  iconUrl: icon,
});

const CAS = [
  player('Gain + promotion', 'DIAMOND', 'II', 14, 39, 3, 1),
  player('Perte', 'EMERALD', 'I', 26, -27, 2, 5),
  player('Aucun changement', 'SILVER', 'I', 54, 0, 0, 0),
  player('Première mesure', 'GOLD', 'IV', 61, null, 4, 4),
  player('Apex', 'MASTER', 'I', 312, 85, 9, 3),
  { label: 'Non classé', entry: null, delta: null, games: { total: 0, wins: 0, losses: 0 }, iconUrl: icon },
  { label: 'Compte en erreur', error: 'Compte Riot "Inconnu #0000" introuvable' },
];

const report = {
  at: new Date(),
  dateLabel: formatDateFr(new Date(), config.timezone),
  comparedTo: new Date(Date.now() - 24 * 3600 * 1000),
  players: CAS,
};

assertConfig({ discord: true });

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
setTimeout(() => {
  console.error('Timeout : pas de connexion Discord en 30 s');
  process.exit(1);
}, 30_000).unref();

client.once('clientReady', async () => {
  try {
    await loadRankEmojis(client);
    const channel = await client.channels.fetch(config.channelId);
    await channel.send(buildMessage(report));
    console.log(`Aperçu posté dans #${channel.name} (${CAS.length} cas).`);
    console.log(`Style : LP_STYLE=${config.lpStyle}  EMBLEM_STYLE=${config.emblemStyle}`);
    console.log(`Emojis de rang : ${rankEmojiCount()}/10`);
  } catch (err) {
    console.error('Échec :', err.message);
    process.exitCode = 1;
  } finally {
    await client.destroy();
  }
});

client.login(config.discordToken);
