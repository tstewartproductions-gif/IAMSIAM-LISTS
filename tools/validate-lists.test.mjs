// tools/validate-lists.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateList, validateIndexEntry } from './validate-lists.mjs';

const good = () => ({
  curator: 'machinedrum',
  listTitle: 'top 10 jungle collaborations',
  date: '2026-08-24',
  tracks: [{
    rank: 1,
    artist: 'Africa Hitech',
    title: 'Out In The Streets (VIP)',
    details: 'warp · 2011 · 170 BPM',
    stream: { type: 'bandcamp', url: 'https://africahitech.bandcamp.com/track/x' },
    buy: [{ platform: 'bandcamp', url: 'https://africahitech.bandcamp.com/track/x' }]
  }]
});

// A fully-valid track template for building multi-track fixtures, so tests that
// exercise cross-track checks (rank order, section runs) don't trip unrelated
// per-track errors.
const makeTrack = (overrides) => ({
  rank: 1,
  artist: 'Africa Hitech',
  title: 'Out In The Streets (VIP)',
  details: 'warp · 2011 · 170 BPM',
  stream: { type: 'bandcamp', url: 'https://africahitech.bandcamp.com/track/x' },
  buy: [{ platform: 'bandcamp', url: 'https://africahitech.bandcamp.com/track/x' }],
  ...overrides
});

// --- core field validation ---

test('valid list passes with no errors', () => {
  const r = validateList(good());
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, ['track 1: no artwork']);
});

test('missing artist is an error', () => {
  const l = good(); delete l.tracks[0].artist;
  assert.match(validateList(l).errors.join(' '), /track 1: missing artist/);
});

test('artist as an empty array is an error', () => {
  const l = good(); l.tracks[0].artist = [];
  assert.match(validateList(l).errors.join(' '), /artist/);
});

test('artist as a whitespace-only string is an error', () => {
  const l = good(); l.tracks[0].artist = '   ';
  assert.match(validateList(l).errors.join(' '), /artist/);
});

test('bad stream type is an error', () => {
  const l = good(); l.tracks[0].stream.type = 'spotify';
  assert.match(validateList(l).errors.join(' '), /stream\.type/);
});

test('bad date is an error', () => {
  const l = good(); l.date = 'aug 24';
  assert.match(validateList(l).errors.join(' '), /date/);
});

test('a date that fails the calendar round-trip is an error', () => {
  const l = good(); l.date = '2026-13-45';
  assert.match(validateList(l).errors.join(' '), /date must be YYYY-MM-DD/);
});

test('missing details is only a warning', () => {
  const l = good(); delete l.tracks[0].details;
  const r = validateList(l);
  assert.deepEqual(r.errors, []);
  assert.match(r.warnings.join(' '), /details/);
});

// --- stream is optional (private dubplates) ---

test('missing stream is a warning, not an error', () => {
  const l = good(); delete l.tracks[0].stream;
  const r = validateList(l);
  assert.deepEqual(r.errors, []);
  assert.match(r.warnings.join(' '), /no stream source - unreleased\?/);
});

// --- buy: empty is a warning, missing/non-array/malformed entries are errors ---

test('empty buy array is a warning, not an error', () => {
  const l = good(); l.tracks[0].buy = [];
  const r = validateList(l);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, ['track 1: no buy source', 'track 1: no artwork']);
});

test('missing buy is an error', () => {
  const l = good(); delete l.tracks[0].buy;
  assert.match(validateList(l).errors.join(' '), /track 1: missing buy/);
});

test('non-http url is an error', () => {
  const l = good(); l.tracks[0].buy[0].url = 'ftp://nope';
  const r = validateList(l);
  assert.deepEqual(r.errors, ['track 1: buy entry 1: needs platform + http(s) url']);
  assert.deepEqual(r.warnings, ['track 1: no artwork']);
});

test('a second bad buy entry is numbered in its own message', () => {
  const l = good();
  l.tracks[0].buy = [
    { platform: 'bandcamp', url: 'https://africahitech.bandcamp.com/track/x' },
    { platform: 'bandcamp', url: 'ftp://nope' }
  ];
  const r = validateList(l);
  assert.deepEqual(r.errors, ['track 1: buy entry 2: needs platform + http(s) url']);
});

// --- malformed containers must never throw ---

test('tracks as a non-array does not throw and is an error', () => {
  const l = good(); l.tracks = {};
  assert.doesNotThrow(() => validateList(l));
  const r = validateList(l);
  assert.deepEqual(r.errors, ['tracks must be a non-empty array']);
  assert.deepEqual(r.warnings, []);
});

test('a track element that is not an object does not throw and is an error', () => {
  const l = good(); l.tracks = [null];
  assert.doesNotThrow(() => validateList(l));
  const r = validateList(l);
  assert.deepEqual(r.errors, ['track 1: not an object']);
});

test('a non-array buy does not throw and is an error', () => {
  const l = good(); l.tracks[0].buy = 'x';
  assert.doesNotThrow(() => validateList(l));
  assert.match(validateList(l).errors.join(' '), /buy must be an array/);
});

test('a buy entry that is not an object does not throw and is an error', () => {
  const l = good(); l.tracks[0].buy = [null];
  assert.doesNotThrow(() => validateList(l));
  assert.match(validateList(l).errors.join(' '), /buy entry 1: needs platform/);
});

// --- rank ---

test('missing rank is an error', () => {
  const l = good(); delete l.tracks[0].rank;
  assert.match(validateList(l).errors.join(' '), /track 1: missing rank/);
});

test('rank must be a positive integer', () => {
  const l = good(); l.tracks[0].rank = 0;
  assert.match(validateList(l).errors.join(' '), /rank must be a positive integer/);
});

test('duplicate ranks within a list is an error', () => {
  const l = good();
  l.tracks.push({ ...l.tracks[0], rank: 1, artist: 'Second Artist', title: 'Second Title' });
  assert.match(validateList(l).errors.join(' '), /track 2: duplicate rank 1/);
});

test('errors on a later track are numbered correctly', () => {
  const l = good();
  l.tracks.push({ ...l.tracks[0], rank: 2, artist: undefined });
  const r = validateList(l);
  assert.ok(r.errors.includes('track 2: missing artist'), r.errors.join(' '));
});

// --- rank order: ascending in file order (gaps are fine; the renderer displays
// tracks in file order, so descending ranks are an authoring error) ---

test('ascending ranks with gaps do not error', () => {
  const l = good();
  l.tracks = [
    makeTrack({ rank: 1, artist: 'Artist A', title: 'Track A' }),
    makeTrack({ rank: 2, artist: 'Artist B', title: 'Track B' }),
    makeTrack({ rank: 4, artist: 'Artist C', title: 'Track C' }),
    makeTrack({ rank: 5, artist: 'Artist D', title: 'Track D' })
  ];
  assert.deepEqual(validateList(l).errors, []);
});

test('out-of-order ranks are an error', () => {
  const l = good();
  l.tracks = [
    makeTrack({ rank: 1, artist: 'Artist A', title: 'Track A' }),
    makeTrack({ rank: 3, artist: 'Artist B', title: 'Track B' }),
    makeTrack({ rank: 2, artist: 'Artist C', title: 'Track C' })
  ];
  assert.match(validateList(l).errors.join(' '), /tracks out of order: rank 2 appears after rank 3/);
});

// --- section runs must be contiguous (the renderer prints one header per run,
// in file order - a split run would repeat the same header) ---

test('contiguous section runs do not error', () => {
  const l = good();
  l.tracks = [
    makeTrack({ rank: 1, artist: 'Artist A', title: 'Track A', section: 'A' }),
    makeTrack({ rank: 2, artist: 'Artist B', title: 'Track B', section: 'A' }),
    makeTrack({ rank: 3, artist: 'Artist C', title: 'Track C', section: 'B' }),
    makeTrack({ rank: 4, artist: 'Artist D', title: 'Track D', section: 'B' })
  ];
  assert.deepEqual(validateList(l).errors, []);
});

test('a split section run is an error', () => {
  const l = good();
  l.tracks = [
    makeTrack({ rank: 1, artist: 'Artist A', title: 'Track A', section: 'A' }),
    makeTrack({ rank: 2, artist: 'Artist B', title: 'Track B', section: 'B' }),
    makeTrack({ rank: 3, artist: 'Artist C', title: 'Track C', section: 'A' })
  ];
  assert.match(validateList(l).errors.join(' '), /section "A" run is not contiguous/);
});

test('no sections at all does not error', () => {
  const l = good();
  l.tracks = [
    makeTrack({ rank: 1, artist: 'Artist A', title: 'Track A' }),
    makeTrack({ rank: 2, artist: 'Artist B', title: 'Track B' }),
    makeTrack({ rank: 3, artist: 'Artist C', title: 'Track C' })
  ];
  assert.deepEqual(validateList(l).errors, []);
});

// --- validateIndexEntry (pure) ---

test('validateIndexEntry: valid entry matching its list file has no errors', () => {
  const list = good();
  const entry = { slug: 'top-10-jungle', date: list.date, curator: list.curator, listTitle: list.listTitle };
  assert.deepEqual(validateIndexEntry(entry, list).errors, []);
});

test('validateIndexEntry: invalid slug is an error', () => {
  const list = good();
  const entry = { slug: 'Not A Slug!', date: list.date, curator: list.curator, listTitle: list.listTitle };
  assert.match(validateIndexEntry(entry, list).errors.join(' '), /slug/);
});

test('validateIndexEntry: missing fields are errors', () => {
  const joined = validateIndexEntry({}, undefined).errors.join(' ');
  assert.match(joined, /missing slug/);
  assert.match(joined, /missing date/);
  assert.match(joined, /missing curator/);
  assert.match(joined, /missing listTitle/);
});

test('validateIndexEntry: works without a list argument (no drift check, no throw)', () => {
  const entry = { slug: 'top-10-jungle', date: '2026-08-24', curator: 'machinedrum', listTitle: 'top 10 jungle collaborations' };
  assert.doesNotThrow(() => validateIndexEntry(entry));
  assert.deepEqual(validateIndexEntry(entry).errors, []);
});

test('validateIndexEntry: date/curator/listTitle drift from the list file is an error', () => {
  const list = good();
  const entry = { slug: 'top-10-jungle', date: '2026-08-01', curator: 'someone-else', listTitle: 'a different title' };
  const errs = validateIndexEntry(entry, list).errors.join(' ');
  assert.match(errs, /date does not match/);
  assert.match(errs, /curator does not match/);
  assert.match(errs, /listTitle does not match/);
});

test('validateIndexEntry: malformed date value errors like list dates', () => {
  const entry = { slug: 'top-10-jungle', date: '2026-13-45', curator: 'machinedrum', listTitle: 'top 10 jungle collaborations' };
  assert.match(validateIndexEntry(entry).errors.join(' '), /date must be YYYY-MM-DD/);
});

test('validateIndexEntry: entry.date = null reports only "missing date", not a drift error', () => {
  const list = good();
  const entry = { slug: 'top-10-jungle', date: null, curator: list.curator, listTitle: list.listTitle };
  assert.deepEqual(validateIndexEntry(entry, list).errors, ['missing date']);
});

// --- CLI (subprocess, LISTS_ROOT-overridable, fixtures under os.tmpdir()) ---

const CLI_PATH = fileURLToPath(new URL('./validate-lists.mjs', import.meta.url));

const VALID_TRACK = {
  rank: 1,
  artist: 'Africa Hitech',
  title: 'Out In The Streets (VIP)',
  details: 'warp · 2011 · 170 BPM',
  stream: { type: 'bandcamp', url: 'https://africahitech.bandcamp.com/track/x' },
  buy: [{ platform: 'bandcamp', url: 'https://africahitech.bandcamp.com/track/x' }]
};

function validListJson(trackOverrides = {}) {
  return JSON.stringify({
    curator: 'machinedrum',
    listTitle: 'top 10 jungle collaborations',
    date: '2026-08-24',
    tracks: [{ ...VALID_TRACK, ...trackOverrides }]
  });
}

function indexEntryFor(slug) {
  return { slug, date: '2026-08-24', curator: 'machinedrum', listTitle: 'top 10 jungle collaborations' };
}

function mkTreeDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'iamsiam-lists-'));
  mkdirSync(path.join(dir, 'lists'));
  return dir;
}

function buildFixtureTree(trackOverrides = {}) {
  const dir = mkTreeDir();
  writeFileSync(path.join(dir, 'index.json'), JSON.stringify([indexEntryFor('test')]));
  writeFileSync(path.join(dir, 'lists', 'test.json'), validListJson(trackOverrides));
  return dir;
}

function runCli(dir) {
  return spawnSync(process.execPath, [CLI_PATH], { env: { ...process.env, LISTS_ROOT: dir }, encoding: 'utf8' });
}

test('CLI: exits 0 on a valid tree and 1 on a broken tree (missing artist), via LISTS_ROOT', () => {
  const goodDir = buildFixtureTree();
  const brokenDir = buildFixtureTree({ artist: undefined });
  try {
    const rGood = runCli(goodDir);
    assert.equal(rGood.status, 0, rGood.stdout + rGood.stderr);
    assert.match(rGood.stdout, /root: /); // LISTS_ROOT override is noted in the output

    const rBroken = runCli(brokenDir);
    assert.equal(rBroken.status, 1, rBroken.stdout + rBroken.stderr);
  } finally {
    rmSync(goodDir, { recursive: true, force: true });
    rmSync(brokenDir, { recursive: true, force: true });
  }
});

test('CLI: a list file that is not a JSON object (null) exits 1 with a clear message', () => {
  const dir = buildFixtureTree();
  writeFileSync(path.join(dir, 'lists', 'test.json'), 'null');
  try {
    const r = runCli(dir);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /test: list file must be a JSON object/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: index.json containing null exits 1', () => {
  const dir = mkTreeDir();
  writeFileSync(path.join(dir, 'index.json'), 'null');
  try {
    const r = runCli(dir);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /index\.json: must be an array of entries/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: index.json as a non-array object exits 1 without a stack trace', () => {
  const dir = mkTreeDir();
  writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ oops: true }));
  try {
    const r = runCli(dir);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /index\.json: must be an array of entries/);
    assert.ok(!r.stderr.includes('.mjs:'), `stderr looked like a stack trace:\n${r.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: a malformed-JSON list does not abort the run; other lists still validate', () => {
  const dir = mkTreeDir();
  writeFileSync(path.join(dir, 'index.json'), JSON.stringify([indexEntryFor('broken'), indexEntryFor('fine')]));
  writeFileSync(path.join(dir, 'lists', 'broken.json'), '{ not valid json');
  writeFileSync(path.join(dir, 'lists', 'fine.json'), validListJson());
  try {
    const r = runCli(dir);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /✓ fine/);
    assert.match(r.stderr, /broken: invalid JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: duplicate slugs in index.json exits 1', () => {
  const dir = mkTreeDir();
  writeFileSync(path.join(dir, 'index.json'), JSON.stringify([indexEntryFor('dupe'), indexEntryFor('dupe')]));
  writeFileSync(path.join(dir, 'lists', 'dupe.json'), validListJson());
  try {
    const r = runCli(dir);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /duplicate slug/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('file-type stream accepts a repo-relative path', () => {
  const l = { curator: 'x', listTitle: 'y', date: '2026-08-24', tracks: [{ rank: 1, artist: 'A', title: 'T',
    stream: { type: 'file', url: 'audio/2026-08-24/02.mp3' },
    buy: [{ platform: 'bandcamp', url: 'https://x.bandcamp.com/track/t' }] }] };
  assert.deepEqual(validateList(l).errors, []);
});

test('file-type stream rejects urls and path tricks', () => {
  const base = () => ({ curator: 'x', listTitle: 'y', date: '2026-08-24', tracks: [{ rank: 1, artist: 'A', title: 'T',
    stream: { type: 'file', url: 'https://evil.example/a.mp3' }, buy: [] }] });
  assert.match(validateList(base()).errors.join(' '), /repo-relative/);
  const l2 = base(); l2.tracks[0].stream.url = '/etc/passwd';
  assert.match(validateList(l2).errors.join(' '), /repo-relative/);
  const l3 = base(); l3.tracks[0].stream.url = 'audio//x.mp3';
  assert.match(validateList(l3).errors.join(' '), /repo-relative/);
});
