import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACCEPTANCE_IDS,
  evaluateAcceptance,
  parseAcceptanceMatrix,
  parseReferenceMatrix,
} from '../scripts/f17-acceptance-preflight.mjs';

function matrix(statusFor = () => 'Bekliyor') {
  return [
    '| Kimlik | Yolculuk / risk | Beklenen sonuç | Görev kaynağı | Durum |',
    '| --- | --- | --- | --- | --- |',
    ...ACCEPTANCE_IDS.map((id) => `| ${id} | journey | expected | source | ${statusFor(id)} |`),
  ].join('\n');
}

function references(count = 11) {
  return [
    '| Referans | Kol | Gözlenen işlev/düzen | Mevcut fark | Hedef faz | Görevler |',
    '| --- | --- | --- | --- | --- | --- |',
    ...Array.from({ length: count }, (_, i) => `| [screen-${i + 1}.png](screen-${i + 1}.png) | Kol | işlev | fark | 17 | F17 |`),
  ].join('\n');
}

test('F17 inventory accepts exactly M01..M31 in canonical order', () => {
  const rows = parseAcceptanceMatrix(matrix());
  assert.deepEqual(rows.map((row) => row.id), ACCEPTANCE_IDS);
  const result = evaluateAcceptance(rows, 'inventory');
  assert.equal(result.scenarioCount, 31);
  assert.equal(result.requiredCount, 0);
  assert.equal(result.pilotStatus, 'Bekliyor');
});

test('F17 release mode requires every scenario except pilot M23', () => {
  const rows = parseAcceptanceMatrix(matrix((id) => id === 'M23' ? 'Bekliyor' : 'Geçti'));
  const result = evaluateAcceptance(rows, 'release');
  assert.equal(result.requiredCount, 30);
  assert.equal(result.passedCount, 30);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.pilotStatus, 'Bekliyor');
});

test('F17 G17 mode requires pilot M23 too', () => {
  const rows = parseAcceptanceMatrix(matrix((id) => id === 'M23' ? 'Bekliyor' : 'Geçti'));
  const result = evaluateAcceptance(rows, 'g17');
  assert.equal(result.requiredCount, 31);
  assert.deepEqual(result.blockers, [{ id: 'M23', status: 'Bekliyor' }]);
});

test('F17 release fails closed for any non-pilot unresolved scenario', () => {
  const rows = parseAcceptanceMatrix(matrix((id) => id === 'M17' ? 'Engelli' : (id === 'M23' ? 'Bekliyor' : 'Geçti')));
  assert.deepEqual(evaluateAcceptance(rows, 'release').blockers, [{ id: 'M17', status: 'Engelli' }]);
});

test('F17 parser rejects a missing, duplicate or reordered scenario', () => {
  const complete = matrix();
  assert.throws(() => parseAcceptanceMatrix(complete.replace(/^\| M31 .*$/m, '')));
  assert.throws(() => parseAcceptanceMatrix(complete.replace(/^\| M31 .*$/m, complete.match(/^\| M30 .*$/m)[0])));
  const swapped = complete
    .replace(/^\| M01 .*$/m, '| TEMP | journey | expected | source | Bekliyor |')
    .replace(/^\| M02 .*$/m, '| M01 | journey | expected | source | Bekliyor |')
    .replace(/^\| TEMP .*$/m, '| M02 | journey | expected | source | Bekliyor |');
  assert.throws(() => parseAcceptanceMatrix(swapped));
});

test('F17 parser rejects invented acceptance statuses', () => {
  assert.throws(() => parseAcceptanceMatrix(matrix((id) => id === 'M05' ? 'Atlandı' : 'Bekliyor')));
});

test('F17 reference inventory requires exactly 11 unique PNG screens', () => {
  assert.equal(parseReferenceMatrix(references()).length, 11);
  assert.throws(() => parseReferenceMatrix(references(10)));
  const duplicate = references().replace('[screen-11.png](screen-11.png)', '[screen-10.png](screen-10.png)');
  assert.throws(() => parseReferenceMatrix(duplicate));
});
