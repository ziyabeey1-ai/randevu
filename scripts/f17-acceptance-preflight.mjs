import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ACCEPTANCE_IDS = Array.from({ length: 31 }, (_, index) =>
  `M${String(index + 1).padStart(2, '0')}`
);
export const ALLOWED_STATUSES = new Set(['Bekliyor', 'Geçti', 'Kaldı', 'Engelli']);

function markdownCells(line) {
  return line.split('|').slice(1, -1).map((cell) => cell.trim());
}

export function parseAcceptanceMatrix(markdown) {
  const rows = [];
  for (const line of String(markdown).split('\n')) {
    if (!/^\|\s*M\d{2}\s*\|/.test(line)) continue;
    const cells = markdownCells(line);
    if (cells.length !== 5) throw new Error('F17 acceptance row must have exactly five columns');
    const [id, journey, expected, source, status] = cells;
    if (!ALLOWED_STATUSES.has(status)) throw new Error(`F17 acceptance row ${id} has invalid status ${status}`);
    rows.push({ id, journey, expected, source, status });
  }
  const ids = rows.map((row) => row.id);
  if (ids.length !== ACCEPTANCE_IDS.length || new Set(ids).size !== ACCEPTANCE_IDS.length) {
    throw new Error('F17 acceptance matrix must contain exactly M01..M31 once each');
  }
  for (let index = 0; index < ACCEPTANCE_IDS.length; index += 1) {
    if (ids[index] !== ACCEPTANCE_IDS[index]) {
      throw new Error(`F17 acceptance matrix order mismatch at ${ACCEPTANCE_IDS[index]}`);
    }
  }
  return rows;
}

export function parseReferenceMatrix(markdown) {
  const rows = [];
  for (const line of String(markdown).split('\n')) {
    if (!/^\|\s*\[[^\]]+\.png\]\([^\)]+\.png\)\s*\|/.test(line)) continue;
    const cells = markdownCells(line);
    if (cells.length !== 6) throw new Error('F17 reference row must have exactly six columns');
    const match = cells[0].match(/^\[([^\]]+\.png)\]\(([^\)]+\.png)\)$/);
    if (!match) throw new Error('F17 reference row has invalid image link');
    rows.push({ label: match[1], path: match[2] });
  }
  if (rows.length !== 11 || new Set(rows.map((row) => row.path)).size !== 11) {
    throw new Error('F17 reference matrix must contain exactly 11 unique reference screens');
  }
  return rows;
}

export function evaluateAcceptance(rows, mode) {
  if (!['inventory', 'release', 'g17'].includes(mode)) throw new Error('Unknown F17 acceptance mode');
  const required = mode === 'inventory'
    ? []
    : rows.filter((row) => mode === 'g17' || row.id !== 'M23');
  const blockers = required.filter((row) => row.status !== 'Geçti');
  return {
    mode,
    scenarioCount: rows.length,
    requiredCount: required.length,
    passedCount: required.length - blockers.length,
    blockers: blockers.map((row) => ({ id: row.id, status: row.status })),
    pilotStatus: rows.find((row) => row.id === 'M23')?.status ?? null,
  };
}

function argValue(name, fallback = null) {
  const prefix = `--${name}=`;
  const arg = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = argValue('mode', 'inventory');
  const acceptancePath = argValue('acceptance', 'MVP_ACCEPTANCE.md');
  const referencePath = argValue('references', 'docs/references/README.md');
  const acceptance = readFileSync(acceptancePath, 'utf8');
  const references = readFileSync(referencePath, 'utf8');
  const rows = parseAcceptanceMatrix(acceptance);
  const screens = parseReferenceMatrix(references);

  for (const screen of screens) {
    const fullPath = new URL(`../docs/references/${screen.path}`, import.meta.url);
    if (!existsSync(fullPath)) throw new Error(`Missing F17 reference screen: ${screen.path}`);
  }

  const result = evaluateAcceptance(rows, mode);
  const sha = String(process.env.F17_RELEASE_SHA ?? process.env.GITHUB_SHA ?? '');
  if (mode !== 'inventory' && !/^[a-f0-9]{40}$/.test(sha)) {
    throw new Error('F17 release/g17 preflight requires an exact 40-character release SHA');
  }

  console.log(`F17_ACCEPTANCE_PREFLIGHT mode=${mode} release_sha=${mode === 'inventory' ? 'NOT_REQUIRED' : sha} scenarios=${result.scenarioCount} required=${result.requiredCount} passed=${result.passedCount} blockers=${result.blockers.length} references=${screens.length} pilot_M23=${result.pilotStatus}`);
  if (result.blockers.length) {
    console.error(`F17_ACCEPTANCE_BLOCKERS ${result.blockers.map((item) => `${item.id}:${item.status}`).join(',')}`);
    process.exitCode = 1;
  }
}
