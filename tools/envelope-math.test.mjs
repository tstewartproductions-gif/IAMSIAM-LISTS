import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fft, bandEdges, analyzePcm, quantize, toBase64, fromBase64 } from './envelope-math.mjs';

test('fft: a pure bin-frequency sine concentrates energy in its bin', () => {
  const N = 4096, sr = 44100, bin = 100, f = bin * sr / N;
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let i = 0; i < N; i++) re[i] = Math.sin(2 * Math.PI * f * i / sr);
  fft(re, im);
  const mag = k => re[k] * re[k] + im[k] * im[k];
  let peak = 0; for (let k = 1; k < N / 2; k++) if (mag(k) > mag(peak)) peak = k;
  assert.equal(peak, bin);
});

test('bandEdges: 24 log-spaced bands cover 35Hz-16kHz monotonically', () => {
  const e = bandEdges(24, 44100);
  assert.equal(e.length, 25);
  assert.ok(Math.abs(e[0] - 35) < 1e-6);
  assert.ok(e[24] <= 16000 + 1e-6);
  for (let i = 1; i < e.length; i++) assert.ok(e[i] > e[i - 1]);
});

test('analyzePcm: a 1kHz sine lights the band containing 1kHz far more than a distant band', () => {
  const sr = 44100, secs = 2;
  const pcm = new Float32Array(sr * secs);
  for (let i = 0; i < pcm.length; i++) pcm[i] = 0.8 * Math.sin(2 * Math.PI * 1000 * i / sr);
  const { env, frames, bands, duration } = analyzePcm(pcm, sr, { fps: 15, bands: 24 });
  assert.equal(bands, 24);
  assert.equal(frames, Math.ceil(secs * 15));
  assert.ok(Math.abs(duration - secs) < 0.1);
  const e = bandEdges(24, sr);
  let hot = -1; for (let b = 0; b < 24; b++) if (1000 >= e[b] && 1000 < e[b + 1]) hot = b;
  const mid = Math.floor(frames / 2);
  assert.ok(env[mid * 24 + hot] > 0.5);
  assert.ok(env[mid * 24 + hot] > env[mid * 24 + 23] + 0.3);
});

test('analyzePcm: silence yields ~zero everywhere', () => {
  const { env } = analyzePcm(new Float32Array(44100), 44100, { fps: 15, bands: 24 });
  assert.ok(Math.max(...env) < 0.05);
});

test('quantize/base64 round-trip within 1/255', () => {
  const env = Float32Array.from([0, 0.25, 0.5, 0.75, 1]);
  const q = quantize(env);
  const back = fromBase64(toBase64(q));
  assert.equal(back.length, 5);
  for (let i = 0; i < 5; i++) assert.ok(Math.abs(back[i] / 255 - env[i]) <= 1 / 255 + 1e-9);
});

test('determinism: same input, same bytes', () => {
  const pcm = new Float32Array(44100);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(i / 50) * Math.sin(i / 7);
  const a = toBase64(quantize(analyzePcm(pcm, 44100, { fps: 15, bands: 24 }).env));
  const b = toBase64(quantize(analyzePcm(pcm, 44100, { fps: 15, bands: 24 }).env));
  assert.equal(a, b);
});
