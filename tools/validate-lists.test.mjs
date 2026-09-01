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
  assert.deepEqual(r.errors, ['track 1: buy entry needs platform + http(s) url']);
  assert.deepEqual(r.warnings, ['track 1: no artwork']);
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
  assert.match(validateList(l).errors.join(' '), /buy entry needs platform/);
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

// --- CLI (subprocess, LISTS_ROOT-overridable, fixtures under os.tmpdir()) ---

const CLI_PATH = fileURLToPath(new URL('./validate-lists.mjs', import.meta.url));

function buildFixtureTree(trackOverrides = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'iamsiam-lists-'));
  mkdirSync(path.join(dir, 'lists'));
  writeFileSync(
    path.join(dir, 'index.json'),
    JSON.stringify([{ slug: 'test', date: '2026-08-24', curator: 'machinedrum', listTitle: 'top 10 jungle collaborations' }])
  );
  writeFileSync(
    path.join(dir, 'lists', 'test.json'),
    JSON.stringify({
      curator: 'machinedrum',
      listTitle: 'top 10 jungle collaborations',
      date: '2026-08-24',
      tracks: [{
        rank: 1,
        artist: 'Africa Hitech',
        title: 'Out In The Streets (VIP)',
        details: 'warp · 2011 · 170 BPM',
        stream: { type: 'bandcamp', url: 'https://africahitech.bandcamp.com/track/x' },
        buy: [{ platform: 'bandcamp', url: 'https://africahitech.bandcamp.com/track/x' }],
        ...trackOverrides
      }]
    })
  );
  return dir;
}

test('CLI: exits 0 on a valid tree and 1 on a broken tree (missing artist), via LISTS_ROOT', () => {
  const goodDir = buildFixtureTree();
  const brokenDir = buildFixtureTree({ artist: undefined });
  try {
    const rGood = spawnSync(process.execPath, [CLI_PATH], {
      env: { ...process.env, LISTS_ROOT: goodDir },
      encoding: 'utf8'
    });
    assert.equal(rGood.status, 0, rGood.stdout + rGood.stderr);

    const rBroken = spawnSync(process.execPath, [CLI_PATH], {
      env: { ...process.env, LISTS_ROOT: brokenDir },
      encoding: 'utf8'
    });
    assert.equal(rBroken.status, 1, rBroken.stdout + rBroken.stderr);
  } finally {
    rmSync(goodDir, { recursive: true, force: true });
    rmSync(brokenDir, { recursive: true, force: true });
  }
});
