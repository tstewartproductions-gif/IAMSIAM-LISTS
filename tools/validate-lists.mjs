// tools/validate-lists.mjs
// Schema guard for weekly list JSON. Errors block publish; warnings don't.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const STREAM_TYPES = ['bandcamp', 'soundcloud', 'youtube', 'other'];
const isUrl = u => typeof u === 'string' && /^https?:\/\/.+/.test(u);

export function validateList(list) {
  const errors = [], warnings = [];
  for (const k of ['curator', 'listTitle', 'date'])
    if (!list?.[k] || typeof list[k] !== 'string') errors.push(`missing ${k}`);
  if (list?.date && !/^\d{4}-\d{2}-\d{2}$/.test(list.date))
    errors.push(`date must be YYYY-MM-DD, got "${list.date}"`);
  if (!Array.isArray(list?.tracks) || list.tracks.length === 0)
    errors.push('tracks must be a non-empty array');

  for (const [i, t] of (list?.tracks ?? []).entries()) {
    const at = `track ${i + 1}`;
    if (typeof t.rank !== 'number') errors.push(`${at}: missing rank`);
    if (!t.artist) errors.push(`${at}: missing artist`);
    if (!t.title) errors.push(`${at}: missing title`);
    if (!t.stream || !STREAM_TYPES.includes(t.stream.type))
      errors.push(`${at}: stream.type must be one of ${STREAM_TYPES.join('|')}`);
    if (!isUrl(t.stream?.url)) errors.push(`${at}: stream.url must be http(s) url`);
    if (!Array.isArray(t.buy) || t.buy.length === 0)
      errors.push(`${at}: buy must be a non-empty array`);
    for (const b of t.buy ?? [])
      if (!b.platform || !isUrl(b.url)) errors.push(`${at}: buy entry needs platform + http(s) url`);
    if (!t.details) warnings.push(`${at}: no details line`);
    if (!t.art) warnings.push(`${at}: no artwork`);
  }
  return { errors, warnings };
}

// CLI: validate every list + index.json cross-references
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let failed = false;
  const index = JSON.parse(readFileSync(path.join(root, 'index.json'), 'utf8'));
  for (const entry of index) {
    const file = path.join(root, 'lists', `${entry.slug}.json`);
    if (!existsSync(file)) { console.error(`✗ index.json: lists/${entry.slug}.json missing`); failed = true; continue; }
    const { errors, warnings } = validateList(JSON.parse(readFileSync(file, 'utf8')));
    for (const w of warnings) console.warn(`  ⚠ ${entry.slug}: ${w}`);
    for (const e of errors) { console.error(`✗ ${entry.slug}: ${e}`); failed = true; }
    if (!errors.length) console.log(`✓ ${entry.slug}`);
  }
  const listed = new Set(index.map(e => `${e.slug}.json`));
  for (const f of readdirSync(path.join(root, 'lists')))
    if (f.endsWith('.json') && !listed.has(f)) console.warn(`  ⚠ lists/${f} not in index.json`);
  process.exit(failed ? 1 : 0);
}
