/**
 * Helpers de date sensibles au fuseau, sans dependance externe.
 * Tout passe par Intl pour que le passage a l'heure d'ete ne decale pas
 * l'heure du resume quotidien.
 */

function partsIn(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // en-US en hour12:false rend minuit "24" : on ramene dans [0..23].
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function offsetMs(date, timeZone) {
  const p = partsIn(date, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime();
}

/** Instant UTC (ms) correspondant a une date/heure locale du fuseau donne. */
function fromZoned({ year, month, day, hour, minute }, timeZone) {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const firstPass = naive - offsetMs(new Date(naive), timeZone);
  // Deuxieme passe : si l'instant estime tombe de l'autre cote d'un changement
  // d'heure, l'offset a utiliser n'est pas celui qu'on vient de mesurer.
  const secondOffset = offsetMs(new Date(firstPass), timeZone);
  return naive - secondOffset;
}

/**
 * Convertit une date utilisateur JJ-MM-AAAA en bornes UTC du jour local.
 * Rejette aussi les dates calendaires impossibles comme le 31-02.
 */
export function parseDateFr(value, timeZone) {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(value ?? '').trim());
  if (!match) throw new Error(`Date "${value}" invalide (format attendu : JJ-MM-AAAA)`);

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new Error(`Date "${value}" inexistante`);
  }

  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const start = fromZoned({ year, month, day, hour: 0, minute: 0 }, timeZone);
  const end = fromZoned(
    {
      year: next.getUTCFullYear(),
      month: next.getUTCMonth() + 1,
      day: next.getUTCDate(),
      hour: 0,
      minute: 0,
    },
    timeZone,
  );
  return { start, end, label: `${match[1]}-${match[2]}-${match[3]}` };
}

/** "06-08-2026" */
export function formatDateFr(date, timeZone) {
  const p = partsIn(date, timeZone);
  return `${String(p.day).padStart(2, '0')}-${String(p.month).padStart(2, '0')}-${p.year}`;
}

/** "06-08-2026 a 23:00" */
export function formatDateTimeFr(date, timeZone) {
  const p = partsIn(date, timeZone);
  return `${formatDateFr(date, timeZone)} à ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** Minuit local du jour de `date`, en ms. */
export function startOfDay(date, timeZone) {
  const p = partsIn(date, timeZone);
  return fromZoned({ year: p.year, month: p.month, day: p.day, hour: 0, minute: 0 }, timeZone);
}

/**
 * Dernier passage prevu de l'horaire quotidien, au plus tard maintenant.
 * Sert au rattrapage : si le PC etait eteint a l'heure du resume, on sait
 * qu'un resume a ete manque.
 */
export function lastScheduledOccurrence(now, { hour, minute }, timeZone) {
  const p = partsIn(now, timeZone);
  const todayAt = fromZoned({ year: p.year, month: p.month, day: p.day, hour, minute }, timeZone);
  if (todayAt <= now.getTime()) return new Date(todayAt);

  // L'heure du jour n'est pas encore passee : la derniere occurrence est hier.
  // On recule d'un jour *calendaire*, pas de 24 h : un jour de changement
  // d'heure dure 23 ou 25 h, et retrancher 24 h peut retomber sur le meme jour
  // local — on renverrait alors une occurrence situee dans le futur.
  const previousDay = new Date(Date.UTC(p.year, p.month - 1, p.day - 1));
  return new Date(
    fromZoned(
      {
        year: previousDay.getUTCFullYear(),
        month: previousDay.getUTCMonth() + 1,
        day: previousDay.getUTCDate(),
        hour,
        minute,
      },
      timeZone,
    ),
  );
}
