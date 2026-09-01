// tools/validate-lists.mjs
// Schema guard for weekly list JSON. Errors block publish; warnings don't.
//
// Pure validation: validateList(list) and validateIndexEntry(entry, list) take
// plain JS objects and return { errors, warnings }. No fs/console access here -
// all I/O lives in the CLI block at the bottom.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const STREAM_TYPES = ['bandcamp', 'soundcloud', 'youtube', 'other'];
const isUrl = u => typeof u === 'string' && /^https?:\/\/.+/.test(u);
const isText = v => typeof v === 'string' && v.trim() !== '';

// Format check (YYYY-MM-DD) plus a calendar round-trip so "2026-13-45" errors
// instead of silently passing the regex.
function isValidDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().startsWith(date);
}

// "missing X" only when the field is absent (null/undefined); wrong type or
// wrong value gets "X must be ..." wording instead.
function textIssue(value, field) {
  if (value == null) return `missing ${field}`;
  if (!isText(value)) return `${field} must be a non-empty string`;
  return null;
}

function dateIssue(value, field = 'date') {
  if (value == null) return `missing ${field}`;
  if (!isValidDate(value)) return `${field} must be YYYY-MM-DD, got "${value}"`;
  return null;
}

export function validateList(list) {
  const errors = [], warnings = [];
  let issue;

  issue = textIssue(list?.curator, 'curator'); if (issue) errors.push(issue);
  issue = textIssue(list?.listTitle, 'listTitle'); if (issue) errors.push(issue);
  issue = dateIssue(list?.date); if (issue) errors.push(issue);

  if (!Array.isArray(list?.tracks) || list.tracks.length === 0)
    errors.push('tracks must be a non-empty array');
  const tracks = Array.isArray(list?.tracks) ? list.tracks : [];

  const seenRanks = new Map(); // rank -> first track index that used it

  for (const [i, raw] of tracks.entries()) {
    const at = `track ${i + 1}`;

    // Malformed track elements (null, arrays, primitives) never throw - just error and move on.
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(`${at}: not an object`);
      continue;
    }
    const t = raw;

    if (t.rank == null) errors.push(`${at}: missing rank`);
    else if (!Number.isInteger(t.rank) || t.rank < 1) errors.push(`${at}: rank must be a positive integer`);
    else if (seenRanks.has(t.rank)) errors.push(`${at}: duplicate rank ${t.rank} (also track ${seenRanks.get(t.rank) + 1})`);
    else seenRanks.set(t.rank, i);

    issue = textIssue(t.artist, 'artist'); if (issue) errors.push(`${at}: ${issue}`);
    issue = textIssue(t.title, 'title'); if (issue) errors.push(`${at}: ${issue}`);

    // stream may be entirely absent for private dubplates - that's a warning, not an error,
    // and skips the type/url checks below. When present, type/url rules still apply.
    if (t.stream == null) {
      warnings.push(`${at}: no stream source - unreleased?`);
    } else {
      if (!STREAM_TYPES.includes(t.stream.type))
        errors.push(`${at}: stream.type must be one of ${STREAM_TYPES.join('|')}`);
      if (!isUrl(t.stream.url)) errors.push(`${at}: stream.url must be http(s) url`);
    }

    // buy: missing or non-array is an error; a present-but-empty array is only a warning.
    if (t.buy == null) {
      errors.push(`${at}: missing buy`);
    } else if (!Array.isArray(t.buy)) {
      errors.push(`${at}: buy must be an array`);
    } else if (t.buy.length === 0) {
      warnings.push(`${at}: no buy source`);
    } else {
      for (const [bi, b] of t.buy.entries()) {
        // Non-object buy entries (null, arrays, primitives) fall through to {} so
        // property access never throws - they just fail the platform/url check below.
        const bp = (b && typeof b === 'object' && !Array.isArray(b)) ? b : {};
        if (!isText(bp.platform) || !isUrl(bp.url))
          errors.push(`${at}: buy entry ${bi + 1}: needs platform + http(s) url`);
      }
    }

    if (!t.details) warnings.push(`${at}: no details line`);
    if (!t.art) warnings.push(`${at}: no artwork`);
  }
  return { errors, warnings };
}

// Validates one index.json entry on its own terms, plus (when the corresponding
// list is available) a drift check: the home page and archive tiles render from
// index.json alone, so its slug/date/curator/listTitle must agree with the list file.
export function validateIndexEntry(entry, list) {
  const errors = [], warnings = [];
  let issue;

  if (entry?.slug == null) errors.push('missing slug');
  else if (typeof entry.slug !== 'string' || !/^[a-z0-9-]+$/.test(entry.slug))
    errors.push('slug must match /^[a-z0-9-]+$/');

  issue = textIssue(entry?.curator, 'curator'); if (issue) errors.push(issue);
  issue = textIssue(entry?.listTitle, 'listTitle'); if (issue) errors.push(issue);
  issue = dateIssue(entry?.date); if (issue) errors.push(issue);

  if (list) {
    for (const k of ['date', 'curator', 'listTitle']) {
      // Null-inclusive presence check on both sides: a null/missing field is
      // already reported above, so it shouldn't also produce a confusing
      // "does not match ... null" drift error.
      if (entry?.[k] != null && list?.[k] != null && entry[k] !== list[k])
        errors.push(`${k} does not match list file (index: "${entry[k]}", list: "${list[k]}")`);
    }
  }

  return { errors, warnings };
}

// CLI: validate every list + index.json cross-references
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.env.LISTS_ROOT
    ? path.resolve(process.env.LISTS_ROOT)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  let failed = false;
  let errorCount = 0, warningCount = 0, entryCount = 0;

  const warn = (slug, msg) => { console.warn(`  ⚠ ${slug}: ${msg}`); warningCount++; };
  const err = (slug, msg) => { console.error(`✗ ${slug}: ${msg}`); failed = true; errorCount++; };

  // index stays null unless index.json both parses AND is an array - anything
  // else (missing file, invalid JSON, or valid JSON that isn't an array, e.g.
  // null/false/0/""/an object) must fail the gate instead of silently no-op'ing.
  let index = null;
  try {
    const parsed = JSON.parse(readFileSync(path.join(root, 'index.json'), 'utf8'));
    if (Array.isArray(parsed)) index = parsed;
    else err('index.json', 'must be an array of entries');
  } catch (e) {
    err('index.json', e.message);
  }

  if (index) {
    entryCount = index.length;

    const slugCounts = new Map();
    for (const entry of index) {
      const s = entry?.slug;
      if (typeof s === 'string') slugCounts.set(s, (slugCounts.get(s) ?? 0) + 1);
    }

    for (const entry of index) {
      const slug = entry?.slug ?? '(unknown slug)';

      if (typeof entry?.slug === 'string' && slugCounts.get(entry.slug) > 1)
        err(slug, `duplicate slug in index.json (${slugCounts.get(entry.slug)} entries)`);

      const file = path.join(root, 'lists', `${slug}.json`);

      let list;
      let listLoaded = false; // tracks parse success, not truthiness of the parsed value
      if (!existsSync(file)) {
        err('index.json', `lists/${slug}.json missing`);
      } else {
        try {
          list = JSON.parse(readFileSync(file, 'utf8'));
          listLoaded = true;
        } catch (e) {
          err(slug, `invalid JSON - ${e.message}`);
        }
      }

      // A list file can parse successfully to JSON that isn't a usable object
      // (null, false, 0, "", an array, ...) - validateList tolerates that input
      // without throwing, but the CLI should surface one clear error instead of
      // either crashing or silently treating it as "nothing to validate".
      if (listLoaded && (list === null || typeof list !== 'object' || Array.isArray(list))) {
        err(slug, 'list file must be a JSON object');
        listLoaded = false;
      }

      const ie = validateIndexEntry(entry, listLoaded ? list : undefined);
      for (const w of ie.warnings) warn(slug, w);
      for (const e of ie.errors) err(slug, e);

      if (!listLoaded) continue; // missing, invalid JSON, or wrong shape - nothing more to check

      const { errors, warnings } = validateList(list);
      for (const w of warnings) warn(slug, w);
      for (const e of errors) err(slug, e);
      if (!errors.length && !ie.errors.length) console.log(`✓ ${slug}`);

      // Referenced media files (art, envelope) should actually exist, relative to repo root.
      const tracks = Array.isArray(list.tracks) ? list.tracks : [];
      for (const [i, t] of tracks.entries()) {
        if (!t || typeof t !== 'object') continue;
        for (const field of ['art', 'envelope']) {
          if (t[field] && !existsSync(path.join(root, t[field])))
            warn(slug, `track ${i + 1}: ${field} file not found: ${t[field]}`);
        }
      }
    }

    const listsDir = path.join(root, 'lists');
    if (existsSync(listsDir)) {
      const listed = new Set(index.map(e => `${e?.slug}.json`));
      for (const f of readdirSync(listsDir))
        if (f.endsWith('.json') && !listed.has(f)) { console.warn(`  ⚠ lists/${f} not in index.json`); warningCount++; }
    }
  }

  // Always run, regardless of whether index.json itself was usable - a broken
  // gate must still report clearly and exit non-zero rather than silently no-op.
  if (process.env.LISTS_ROOT) console.log(`root: ${root}`);
  console.log(`${entryCount} entries, ${errorCount} errors, ${warningCount} warnings`);
  process.exitCode = failed ? 1 : 0;
}
