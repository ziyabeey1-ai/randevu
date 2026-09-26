export type CustomerCalendarEvent = {
  id: string;
  businessName: string;
  address?: string | null;
  status: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  sequence?: number;
};

const ACTIVE_STATUSES = new Set(['scheduled', 'confirmed']);

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function validTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function cleanText(value: string) {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function utcStamp(value: string | Date) {
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escapeIcsText(value: string) {
  return cleanText(value).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,');
}

function foldLine(line: string) {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let current = '';
  let limit = 75;
  for (const character of line) {
    if (encoder.encode(current + character).length > limit) {
      lines.push(current);
      current = ` ${character}`;
      limit = 75;
    } else {
      current += character;
    }
  }
  lines.push(current);
  return lines.join('\r\n');
}

export function isCalendarExportable(event: CustomerCalendarEvent) {
  const start = validDate(event.startsAt);
  const end = validDate(event.endsAt);
  return ACTIVE_STATUSES.has(event.status)
    && Boolean(cleanText(event.businessName))
    && Boolean(cleanText(event.id))
    && Boolean(start && end && end > start)
    && validTimeZone(event.timezone);
}

export function calendarTitle(event: CustomerCalendarEvent) {
  return `${cleanText(event.businessName)} randevusu`;
}

export function googleCalendarUrl(event: CustomerCalendarEvent) {
  if (!isCalendarExportable(event)) throw new Error('CALENDAR_EVENT_NOT_EXPORTABLE');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    dates: `${utcStamp(event.startsAt)}/${utcStamp(event.endsAt)}`,
    stz: event.timezone,
    etz: event.timezone,
    text: calendarTitle(event),
  });
  const address = event.address ? cleanText(event.address) : '';
  if (address) params.set('location', address);
  return `https://calendar.google.com/calendar/r/eventedit?${params.toString()}`;
}

export function createCalendarIcs(event: CustomerCalendarEvent, now: Date = new Date()) {
  if (!isCalendarExportable(event)) throw new Error('CALENDAR_EVENT_NOT_EXPORTABLE');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//YZT Randevu//Customer Calendar//TR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-TIMEZONE:${escapeIcsText(event.timezone)}`,
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(cleanText(event.id))}@randevu.kepenk.ai`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${utcStamp(event.startsAt)}`,
    `DTEND:${utcStamp(event.endsAt)}`,
    `SUMMARY:${escapeIcsText(calendarTitle(event))}`,
  ];
  const address = event.address ? cleanText(event.address) : '';
  if (address) lines.push(`LOCATION:${escapeIcsText(address)}`);
  if (Number.isSafeInteger(event.sequence) && event.sequence! >= 0) lines.push(`SEQUENCE:${event.sequence}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

export function calendarFilename(businessName: string) {
  const base = cleanText(businessName)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .toLowerCase();
  return `${base || 'randevu'}.ics`;
}
