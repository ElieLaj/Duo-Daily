import { config } from './config.js';
import { RateLimiter, sleep } from './ratelimit.js';

const limiter = RateLimiter.parse(config.rateLimits, config.rateSafety);

const MAX_ATTEMPTS = 4;

export class RiotError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'RiotError';
    this.status = status;
  }
}

async function request(host, path, { allow404 = false } = {}) {
  const url = `https://${host}${path}`;

  for (let attempt = 1; ; attempt++) {
    await limiter.acquire();

    let res;
    try {
      res = await fetch(url, {
        headers: { 'X-Riot-Token': config.riotKey },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS) {
        throw new RiotError(`Riot injoignable apres ${attempt} essais (${path}) : ${err.message}`, 0);
      }
      await sleep(1000 * 2 ** attempt);
      continue;
    }

    if (res.ok) return res.json();
    if (res.status === 404 && allow404) return null;

    if (res.status === 429) {
      // Riot indique combien de temps patienter ; on bloque *toute* la file,
      // pas seulement cette requete, sinon les suivantes reprennent un 429.
      const retryAfter = Number(res.headers.get('retry-after')) || 10;
      const type = res.headers.get('x-rate-limit-type') ?? 'inconnu';
      limiter.penalize(retryAfter);
      if (attempt >= MAX_ATTEMPTS) {
        throw new RiotError(`429 persistant (limite "${type}") sur ${path}`, 429);
      }
      console.warn(`[riot] 429 (${type}), pause de ${retryAfter}s puis reprise`);
      continue;
    }

    if (res.status === 401 || res.status === 403) {
      throw new RiotError(
        'Cle Riot refusee (401/403). Une cle Development expire au bout de 24h : ' +
          'regenere-la sur https://developer.riotgames.com et mets a jour RIOT_API_KEY dans .env',
        res.status,
      );
    }

    if (res.status >= 500 && attempt < MAX_ATTEMPTS) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }

    const body = await res.text().catch(() => '');
    throw new RiotError(`Riot API ${res.status} sur ${path} ${body.slice(0, 200)}`.trim(), res.status);
  }
}

/** Resout un Riot ID en compte (puuid). null si le compte n'existe pas. */
export function getAccount(gameName, tagLine) {
  const p = `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
  return request(config.region + '.api.riotgames.com', p, { allow404: true });
}

/** Toutes les entrees classees d'un joueur (solo, flex, ...). */
export async function getLeagueEntries(puuid) {
  const p = `/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`;
  return (await request(config.platform + '.api.riotgames.com', p, { allow404: true })) ?? [];
}

/** Profil invocateur (niveau, icone). null si introuvable. */
export function getSummoner(puuid) {
  const p = `/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`;
  return request(config.platform + '.api.riotgames.com', p, { allow404: true });
}

/** IDs des parties de la file suivie depuis `sinceMs`. */
export async function getMatchIds(puuid, sinceMs, count = 100) {
  const startTime = Math.floor(sinceMs / 1000);
  const p =
    `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids` +
    `?startTime=${startTime}&queue=${config.queueId}&count=${Math.min(count, 100)}`;
  return (await request(config.region + '.api.riotgames.com', p, { allow404: true })) ?? [];
}

/** Resultat d'une partie pour un joueur donne. null si la partie est introuvable. */
export async function getMatchResult(matchId, puuid) {
  const p = `/lol/match/v5/matches/${encodeURIComponent(matchId)}`;
  const match = await request(config.region + '.api.riotgames.com', p, { allow404: true });
  const me = match?.info?.participants?.find((participant) => participant.puuid === puuid);
  if (!me) return null;
  return {
    matchId,
    win: Boolean(me.win),
    // Une partie abandonnee avant la fin du chargement ne compte pas dans le classement.
    remake: Boolean(me.gameEndedInEarlySurrender),
    endedAt: match.info.gameEndTimestamp ?? match.info.gameStartTimestamp ?? null,
    championName: me.championName ?? null,
    kills: me.kills ?? 0,
    deaths: me.deaths ?? 0,
    assists: me.assists ?? 0,
    // Le farm total : sbires de couloir + monstres neutres (jungle, crabes).
    // Riot ne fournit pas de champ agrege, il faut sommer les deux.
    cs: (me.totalMinionsKilled ?? 0) + (me.neutralMinionsKilled ?? 0),
    // gameDuration est en secondes depuis le patch 11.20.
    durationSec: match.info.gameDuration ?? null,
  };
}
