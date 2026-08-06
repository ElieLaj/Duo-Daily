import { config } from './config.js';

/**
 * Emojis custom du serveur utilises comme icones de rang.
 *
 * Discord n'affiche une image inline que sous forme d'emoji custom : c'est le
 * seul moyen de placer l'embleme juste a gauche du nom du rang.
 */

// Nom d'emoji (en minuscules) -> tier. Plusieurs graphies sont acceptees car
// les emojis sont rarement uploades de maniere homogene.
const ALIASES = {
  iron: 'IRON',
  fer: 'IRON',
  bronze: 'BRONZE',
  silver: 'SILVER',
  argent: 'SILVER',
  gold: 'GOLD',
  or: 'GOLD',
  platinum: 'PLATINUM',
  platine: 'PLATINUM',
  emerald: 'EMERALD',
  emeraude: 'EMERALD',
  diamond: 'DIAMOND',
  diamant: 'DIAMOND',
  master: 'MASTER',
  maitre: 'MASTER',
  grandmaster: 'GRANDMASTER',
  grand_master: 'GRANDMASTER',
  grandmaitre: 'GRANDMASTER',
  challenger: 'CHALLENGER',
};

/** tier -> "<:Nom:id>" */
let byTier = new Map();

/**
 * (Re)construit la table des emojis de rang depuis le serveur.
 * Sans emoji correspondant, le rendu retombe simplement sur du texte seul :
 * un emoji renomme ou supprime ne doit jamais empecher le resume de partir.
 */
export async function loadRankEmojis(client) {
  const found = new Map();
  try {
    // On prefere le serveur du salon cible : GUILD_ID n'est qu'un raccourci
    // facultatif pour l'enregistrement des commandes.
    const channel = await client.channels.fetch(config.channelId);
    const guild = channel?.guild ?? (config.guildId ? await client.guilds.fetch(config.guildId) : null);
    if (!guild) return byTier;

    for (const emoji of (await guild.emojis.fetch()).values()) {
      const tier = ALIASES[emoji.name.toLowerCase()];
      // Le premier trouve gagne : evite qu'un doublon ecrase le bon emoji.
      if (tier && !found.has(tier)) found.set(tier, emoji.toString());
    }
  } catch (err) {
    console.warn(`[emojis] lecture impossible (${err.message}), rendu sans icône de rang`);
    return byTier;
  }

  byTier = found;
  return byTier;
}

/** Markup de l'emoji du rang, ou '' si aucun ne correspond. */
export function rankEmoji(entry) {
  if (!entry?.tier) return '';
  return byTier.get(entry.tier.toUpperCase()) ?? '';
}

/** Nombre de tiers actuellement associes a un emoji (pour les logs). */
export function rankEmojiCount() {
  return byTier.size;
}
