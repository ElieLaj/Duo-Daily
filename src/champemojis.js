/**
 * Emojis de champion, stockes au niveau de l'application Discord.
 *
 * Les emojis d'application (contrairement a ceux d'un serveur) offrent 2000
 * emplacements et fonctionnent sur tous les serveurs ou le bot est present,
 * sans consommer les emplacements du serveur. C'est ce qui rend possible une
 * icone par ligne pour 233 champions, la ou un serveur non boosté n'en offre
 * que 50.
 */

const NAME_PREFIX = 'ch_';

/** id de champion (ex. "MonkeyKing") -> "<:ch_MonkeyKing:123>" */
let byChampion = new Map();
let loaded = false;

/** Les noms d'emoji n'acceptent que [A-Za-z0-9_], 2 a 32 caracteres. */
function emojiName(championId) {
  const clean = championId.replace(/[^A-Za-z0-9_]/g, '');
  return `${NAME_PREFIX}${clean}`.slice(0, 32);
}

/** Lit une fois la liste des emojis deja televerses. */
async function ensureLoaded(client) {
  if (loaded) return;
  try {
    const emojis = await client.application.emojis.fetch();
    for (const emoji of emojis.values()) {
      if (emoji.name.startsWith(NAME_PREFIX)) byChampion.set(emoji.name, emoji.toString());
    }
    loaded = true;
  } catch (err) {
    console.warn(`[champemojis] liste illisible (${err.message}), rendu sans icône de champion`);
  }
}

/**
 * Markup de l'emoji du champion, en le creant au premier usage.
 * Renvoie '' si l'emoji n'existe pas et n'a pas pu etre cree : l'icone est
 * decorative, elle ne doit jamais faire echouer la commande.
 */
export async function championEmoji(client, champion) {
  if (!champion?.id || !champion.iconUrl) return '';
  await ensureLoaded(client);

  const name = emojiName(champion.id);
  const known = byChampion.get(name);
  if (known) return known;

  try {
    // discord.js accepte une URL comme piece jointe et telecharge l'image.
    const created = await client.application.emojis.create({ attachment: champion.iconUrl, name });
    const markup = created.toString();
    byChampion.set(name, markup);
    return markup;
  } catch (err) {
    // Quota atteint, image refusee, permission manquante : on retient l'echec
    // pour ne pas retenter a chaque affichage.
    console.warn(`[champemojis] création de ${name} impossible (${err.message})`);
    byChampion.set(name, '');
    return '';
  }
}

/** Nombre d'emojis de champion connus (pour les logs). */
export function championEmojiCount() {
  return [...byChampion.values()].filter(Boolean).length;
}
