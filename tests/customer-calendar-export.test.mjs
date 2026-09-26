import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const source = await readFile(new URL('../src/customer-calendar-export.ts', import.meta.url), 'utf8');
const javascript = stripTypeScriptTypes(source, { mode: 'transform' });
const calendar = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);

const base = {
  id: '2bc83c45-1c47-4fa2-a737-e2260ca4cc65',
  businessName: 'Örnek Salon',
  address: 'Moda Caddesi 1, İstanbul',
  status: 'confirmed',
  startsAt: '2026-03-29T00:30:00.000Z',
  endsAt: '2026-03-29T02:30:00.000Z',
  timezone: 'Europe/Istanbul',
  sequence: 7,
};

test('ICS is a CRLF RFC5545 structure with stable UID, UTC dates and group sequence', () => {
  const ics = calendar.createCalendarIcs(base, new Date('2026-01-02T03:04:05Z'));
  assert.equal(ics.replace(/\r\n/g, '').includes('\n'), false);
  assert.match(ics, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
  assert.match(ics, /UID:2bc83c45-1c47-4fa2-a737-e2260ca4cc65@randevu\.kepenk\.ai\r\n/);
  assert.match(ics, /DTSTART:20260329T003000Z\r\nDTEND:20260329T023000Z\r\n/);
  assert.match(ics, /DTSTAMP:20260102T030405Z\r\n/);
  assert.match(ics, /X-WR-TIMEZONE:Europe\/Istanbul\r\n/);
  assert.match(ics, /SEQUENCE:7\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n$/);
});

test('single events omit SEQUENCE and Google template preserves DST-crossing UTC instants', () => {
  const event = { ...base, timezone: 'Europe/Berlin', startsAt: '2026-03-29T00:30:00Z', endsAt: '2026-03-29T02:30:00Z', sequence: undefined };
  assert.doesNotMatch(calendar.createCalendarIcs(event), /SEQUENCE:/);
  const url = new URL(calendar.googleCalendarUrl(event));
  assert.equal(url.searchParams.get('dates'), '20260329T003000Z/20260329T023000Z');
  assert.equal(url.searchParams.get('stz'), 'Europe/Berlin');
  assert.equal(url.searchParams.get('etz'), 'Europe/Berlin');
});

test('UTF-8 lines fold to 75 octets and CRLF injection remains escaped text', () => {
  const ics = calendar.createCalendarIcs({ ...base, businessName: `Çok uzun ${'İşletme '.repeat(18)}\r\nATTENDEE:private@example.test`, address: 'Adres\nDESCRIPTION:gizli' });
  for (const line of ics.split('\r\n').filter(Boolean)) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, line);
  assert.doesNotMatch(ics, /\r\nATTENDEE:/);
  assert.doesNotMatch(ics, /\r\nDESCRIPTION:gizli/);
  assert.match(ics, /\r\n /);
});

test('URLs and ICS contain only public calendar fields and terminal/partial events are blocked', () => {
  const secret = '/m#management-secret';
  const sensitive = { ...base, phone: '+905551112233', customer: 'Customer Name', service: 'Private Service', notes: secret };
  const output = `${calendar.googleCalendarUrl(sensitive)}\n${calendar.createCalendarIcs(sensitive)}`;
  for (const value of [secret, '+905551112233', 'Customer Name', 'Private Service']) assert.equal(output.includes(value), false);
  for (const status of ['partial', 'cancelled', 'completed', 'no_show']) {
    assert.equal(calendar.isCalendarExportable({ ...base, status }), false);
  }
  assert.equal(calendar.isCalendarExportable({ ...base, timezone: 'Not/A-Timezone' }), false);
  assert.equal(calendar.isCalendarExportable({ ...base, startsAt: '2026-03-29 00:30:00' }), false);
});

test('result actions revalidate by POST body and never put management authority in a URL', async () => {
  const page = await readFile(new URL('../src/PublicBookingPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /api<\{ appointment: Confirmation; group\?: GroupConfirmation \}>\('\/api\/manage\/view'/);
  assert.match(page, /method: 'POST', csrf: 'skip', body: JSON\.stringify\(\{ token \}\)/);
  assert.doesNotMatch(page, /\/api\/manage\/view\?[^'"`]*token/);
  assert.match(page, /refreshEvent=\{refreshCalendarEvent\}/);
});
