// Day-window scheduling in America/Los_Angeles.
// upcomingSlots(n, start, end): n Date objects spread evenly across the next
// occurrence of the window. If the window already started today, slots run
// from now to the end; if the window is over, they roll to tomorrow.
// Defaults match her publishing rhythm: 8am to 8pm.
const TZ = 'America/Los_Angeles';

function pacificDateStr(d) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

// "2026-10-07" + "08:00" in Pacific -> Date (UTC instant).
function wallToUtc(dateStr, hhmm) {
  const [Y, M, D] = dateStr.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(Y, M - 1, D, h, mi);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(new Date(guess)).map((p) => [p.type, p.value])
  );
  const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
  return new Date(guess - (asUTC - guess));
}

export function upcomingSlots(n, start = '08:00', end = '20:00') {
  if (n <= 0) return [];
  const now = Date.now();
  let dateStr = pacificDateStr(new Date(now));
  let t0 = Math.max(wallToUtc(dateStr, start).getTime(), now + 60_000);
  let t1 = wallToUtc(dateStr, end).getTime();
  if (t0 >= t1) {
    dateStr = pacificDateStr(new Date(now + 24 * 3600 * 1000));
    t0 = wallToUtc(dateStr, start).getTime();
    t1 = wallToUtc(dateStr, end).getTime();
  }
  if (n === 1) return [new Date(t0)];
  const step = (t1 - t0) / (n - 1);
  return Array.from({ length: n }, (_, i) => new Date(Math.round(t0 + i * step)));
}
