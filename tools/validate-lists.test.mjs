// tools/validate-lists.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateList } from './validate-lists.mjs';

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

test('valid list passes with no errors', () => {
  assert.deepEqual(validateList(good()).errors, []);
});

test('missing artist is an error', () => {
  const l = good(); delete l.tracks[0].artist;
  assert.match(validateList(l).errors.join(' '), /track 1: missing artist/);
});

test('bad stream type is an error', () => {
  const l = good(); l.tracks[0].stream.type = 'spotify';
  assert.match(validateList(l).errors.join(' '), /stream\.type/);
});

test('empty buy array is an error', () => {
  const l = good(); l.tracks[0].buy = [];
  assert.match(validateList(l).errors.join(' '), /buy/);
});

test('bad date is an error', () => {
  const l = good(); l.date = 'aug 24';
  assert.match(validateList(l).errors.join(' '), /date/);
});

test('non-http url is an error', () => {
  const l = good(); l.tracks[0].buy[0].url = 'ftp://nope';
  assert.match(validateList(l).errors.join(' '), /url/);
});

test('missing details is only a warning', () => {
  const l = good(); delete l.tracks[0].details;
  const r = validateList(l);
  assert.deepEqual(r.errors, []);
  assert.match(r.warnings.join(' '), /details/);
});
