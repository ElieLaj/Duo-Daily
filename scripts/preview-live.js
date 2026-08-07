/**
 * Poste des annonces de partie fabriquees, pour juger leur rendu sans attendre
 * que quelqu'un enchaine reellement les defaites.
 *
 *   npm run preview:live
 *
 * N'appelle ni l'API Riot ni la base : tout est fabrique ici. Les liaisons
 * /link reelles sont en revanche relues, pour que les mentions soient
 * representatives.
 */
import { Client, GatewayIntentBits } from 'discord.js';

import { assertConfig, config } from '../src/config.js';
import { buildDefeatGifMessage, buildMatchMessage } from '../src/embeds.js';
import { championEmoji } from '../src/champemojis.js';
import { getChampion } from '../src/champions.js';
import { loadRankEmojis } from '../src/emojis.js';
import { getPlayerLinks } from '../src/history.js';
import { loadPromotionRoles, promotionRoleIds } from '../src/roles.js';

// Premier joueur suivi : les mentions et le lien op.gg sont ainsi reels.
const player = config.players[0];
const entry = { tier: 'DIAMOND', rank: 'III', leaguePoints: 42 };

const partie = (extra) => ({
  matchId: 'APERCU',
  win: false,
  remake: false,
  kills: 3,
  deaths: 9,
  assists: 4,
  cs: 178,
  durationSec: 1_620,
  championName: 'Vex',
  streak: 0,
  lossStreak: 0,
  ...extra,
});

const CAS = [
  ['2 défaites — avertissement', { match: partie({ lossStreak: 2 }), delta: -18 }],
  ['4 défaites — GIF + mention', { match: partie({ lossStreak: 4 }), delta: -21 }],
  [
    'série brisée',
    { match: partie({ win: true, streak: 1, brokeLossStreak: 4, kills: 11, deaths: 2, assists: 8 }), delta: 24 },
  ],
  [
    'dépassement',
    {
      match: partie({ win: true, streak: 2, kills: 8, deaths: 3, assists: 12 }),
      delta: 19,
      croisements: [{ key: config.players[1]?.key, label: config.players[1]?.label ?? 'Autre #TAG', sens: 'devant' }],
    },
  ],
  [
    'montée de rang',
    {
      match: partie({ win: true, streak: 3, kills: 14, deaths: 1, assists: 6 }),
      delta: 22,
      promotion: { depuis: 'Diamant III', vers: 'Diamant II' },
    },
  ],
];

assertConfig({ discord: true });
// Les apercus postent dans un salon dedie : sans lui, on refuse de partir
// plutot que de deverser des messages de test dans le salon principal.
if (!config.testChannelId) {
  console.error(
    `\nTEST_CHANNEL_ID n'est pas renseigné dans .env.\n` +
      `Indique un salon de test (clic droit sur le salon > Copier l'identifiant),\n` +
      `sinon l'aperçu posterait devant tout le serveur.\n`,
  );
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
setTimeout(() => {
  console.error('Timeout : pas de connexion Discord en 30 s');
  process.exit(1);
}, 30_000).unref();

client.once('clientReady', async () => {
  try {
    await loadRankEmojis(client);
    await loadPromotionRoles(client);
    const links = await getPlayerLinks().catch(() => new Map());
    const channel = await client.channels.fetch(config.testChannelId);

    for (const [nom, announce] of CAS) {
      const match = announce.match;
      match.champion = await getChampion(match.championName);
      match.emoji = await championEmoji(client, match.champion);

      await channel.send(
        buildMatchMessage({
          player,
          entry,
          deltaGames: 1,
          skipped: 0,
          croisements: [],
          links,
          roleIds: promotionRoleIds(),
          ...announce,
        }),
      );

      const gif = buildDefeatGifMessage(player, match, links);
      if (gif) await channel.send(gif);

      console.log(`posté : ${nom}`);
    }
    console.log(`\nSalon : #${channel.name} — joueur utilisé : ${player.label}`);
  } catch (err) {
    console.error('Échec :', err.message);
    process.exitCode = 1;
  } finally {
    await client.destroy();
  }
});

client.login(config.discordToken);
