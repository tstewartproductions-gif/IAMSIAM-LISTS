// worker/parse.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTrackPage } from './parse.mjs';

const html = readFileSync(new URL('./fixture-track.html', import.meta.url), 'utf8');

test('parses stream URL, title, artist, duration, ids, art from a real page', () => {
  const r = parseTrackPage(html);
  assert.match(r.streamUrl, /^https:\/\/t\d+\.bcbits\.com\/stream\//);
  assert.equal(r.title, 'Survival Skills');
  assert.ok(r.artist.length > 0);
  assert.ok(r.duration > 60);
  assert.ok(Number.isInteger(r.trackId));
  assert.match(r.art, /^https:\/\//);
});

test('throws a clean error when data-tralbum is absent', () => {
  assert.throws(() => parseTrackPage('<html><body>nope</body></html>'), /no data-tralbum/);
});

test('throws a clean error on malformed data-tralbum JSON', () => {
  assert.throws(() => parseTrackPage('<div data-tralbum="{bad">'), /malformed data-tralbum/);
});

test('throws a clean error when the track has no mp3-128 (subscriber-only)', () => {
  const stripped = html.replace(/mp3-128/g, 'mp3-000');
  assert.throws(() => parseTrackPage(stripped), /no public stream/);
});
