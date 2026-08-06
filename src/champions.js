import { dataDragonVersion } from './ddragon.js';

/**
 * Catalogue des champions (nom localise + icone carree), depuis Data Dragon.
 * Le CDN est statique : pas de cle API, pas de quota, donc pas de rate limiter.
 */

const TTL_MS = 24 * 3600 * 1000;

let cache = { at: 0, byId: new Map() };

async function load() {
  if (cache.byId.size && Date.now() - cache.at < TTL_MS) return cache.byId;

  const version = await dataDragonVersion();
  try {
    const res = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/fr_FR/champion.json`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { data } = await res.json();

    const byId = new Map();
    for (const champion of Object.values(data)) {
      byId.set(champion.id, {
        id: champion.id,
        name: champion.name,
        iconUrl: `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${champion.image.full}`,
      });
    }
    cache = { at: Date.now(), byId };
  } catch (err) {
    console.warn(`[champions] catalogue indisponible (${err.message})`);
    // On garde l'ancien cache s'il existe : mieux vaut des donnees un peu
    // datees qu'une commande qui echoue.
  }
  return cache.byId;
}

/**
 * @param {string} championName identifiant renvoye par Match-V5 (ex. "MonkeyKing")
 * @returns {{id:string,name:string,iconUrl:string}} le champion, ou un repli
 *   portant l'identifiant brut si le catalogue ne le connait pas (champion
 *   sorti apres la mise en cache).
 */
export async function getChampion(championName) {
  const byId = await load();
  return byId.get(championName) ?? { id: championName, name: championName, iconUrl: null };
}
