/**
 * `m h * * *` + n minutes, so the two nightly jobs do not start in the same
 * second. Anything it does not understand is returned unchanged — a hand-written
 * cron with a range or a step keeps its own meaning rather than being mangled.
 */
export function shiftCron(cron: string, minutes: number): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const minute = Number(parts[0]);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return cron;

  const total = minute + minutes;
  parts[0] = String(((total % 60) + 60) % 60);

  const hour = Number(parts[1]);
  const carry = Math.floor(total / 60);
  if (carry !== 0 && Number.isInteger(hour) && hour >= 0 && hour <= 23) {
    parts[1] = String((((hour + carry) % 24) + 24) % 24);
  }

  return parts.join(" ");
}
