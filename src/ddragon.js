/**
 * Data Dragon : CDN statique de Riot pour les icones de profil.
 *
 * Ce CDN n'est pas soumis a la cle API ni a ses quotas : on l'appelle donc
 * directement, sans passer par le rate limiter.
 */

const VERSIONS_URL = 'https://ddragon.leagueoflegends.com/api/versions.json';
const TTL_MS = 24 * 3600 * 1000;

// Version de repli si le CDN est injoignable au demarrage : les anciennes
// versions restent servies indefiniment, une valeur figee reste donc valide.
const FALLBACK_VERSION = '16.15.1';

let cached = { version: null, at: 0 };

/** Derniere version de Data Dragon, mise en cache 24 h. */
export async function dataDragonVersion() {
  if (cached.version && Date.now() - cached.at < TTL_MS) return cached.version;
  try {
    const res = await fetch(VERSIONS_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const versions = await res.json();
    if (!Array.isArray(versions) || !versions[0]) throw new Error('réponse inattendue');
    cached = { version: versions[0], at: Date.now() };
  } catch (err) {
    console.warn(`[ddragon] version indisponible (${err.message}), repli sur ${FALLBACK_VERSION}`);
    cached = { version: cached.version ?? FALLBACK_VERSION, at: Date.now() };
  }
  return cached.version;
}

/** URL de l'icone de profil, ou null si l'id est inconnu. */
export async function profileIconUrl(profileIconId) {
  if (!Number.isFinite(profileIconId)) return null;
  const version = await dataDragonVersion();
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/profileicon/${profileIconId}.png`;
}
