/**
 * Rate limiter a fenetres glissantes multiples.
 *
 * Riot applique plusieurs limites *en meme temps* sur une meme cle
 * (ex. 20 requetes / 1 s ET 100 requetes / 120 s). Un simple delai fixe entre
 * deux appels ne modelise pas ca : soit il est trop lent (on gaspille le burst
 * autorise), soit il depasse la fenetre longue. On garde donc l'horodatage de
 * chaque requete et on attend le temps exact necessaire pour que *toutes* les
 * fenetres aient de la place.
 */
export class RateLimiter {
  /** @param {{limit:number, intervalMs:number}[]} windows */
  constructor(windows) {
    if (!windows.length) throw new Error('RateLimiter: au moins une fenetre requise');
    this.windows = windows.map((w) => ({ ...w, hits: [] }));
    // Serialise les acquire() concurrents : sans ca, deux appels simultanes
    // pourraient tous les deux voir "il reste 1 slot" et le consommer.
    this.queue = Promise.resolve();
    /** Blocage global impose par un 429 (timestamp ms). */
    this.penaltyUntil = 0;
  }

  /** Attend qu'un creneau soit libre, puis le consomme. */
  acquire() {
    const run = this.queue.then(() => this.#reserve());
    // On chaine sur une version qui n'echoue jamais pour ne pas casser la file.
    this.queue = run.catch(() => {});
    return run;
  }

  async #reserve() {
    for (;;) {
      const now = Date.now();
      let waitMs = Math.max(0, this.penaltyUntil - now);

      for (const w of this.windows) {
        // Purge les hits sortis de la fenetre.
        while (w.hits.length && w.hits[0] <= now - w.intervalMs) w.hits.shift();
        if (w.hits.length >= w.limit) {
          waitMs = Math.max(waitMs, w.hits[0] + w.intervalMs - now);
        }
      }

      if (waitMs <= 0) {
        for (const w of this.windows) w.hits.push(now);
        return;
      }
      await sleep(waitMs + 30); // petite marge pour l'imprecision d'horloge
    }
  }

  /**
   * Applique une penalite globale apres un 429 : plus aucune requete ne part
   * avant l'expiration du Retry-After renvoye par Riot.
   */
  penalize(seconds) {
    this.penaltyUntil = Math.max(this.penaltyUntil, Date.now() + seconds * 1000);
  }

  /**
   * Parse "20:1,100:120" (format affiche par le portail dev de Riot) en
   * fenetres, en appliquant une marge de securite sur le nombre de requetes.
   */
  static parse(spec, safety = 0.9) {
    const windows = spec
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [count, seconds] = part.split(':').map((n) => Number(n.trim()));
        if (!Number.isFinite(count) || !Number.isFinite(seconds) || count < 1 || seconds < 1) {
          throw new Error(`RIOT_RATE_LIMITS invalide pres de "${part}" (format attendu : "20:1,100:120")`);
        }
        return { limit: Math.max(1, Math.floor(count * safety)), intervalMs: seconds * 1000 };
      });
    if (!windows.length) throw new Error('RIOT_RATE_LIMITS est vide');
    return new RateLimiter(windows);
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
