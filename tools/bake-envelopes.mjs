// tools/bake-envelopes.mjs
// Bake a VU envelope JSON from an audio source.
//   node tools/bake-envelopes.mjs --file <audio> --out env/<date>/<NN>.json
//   node tools/bake-envelopes.mjs --stream <bandcamp track url> --out env/<date>/<NN>.json
// Decode is delegated to ffmpeg (any format -> f32le mono 44.1k). Local authoring tool only.
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { analyzePcm, quantize, toBase64 } from './envelope-math.mjs';

const WORKER_URL = 'https://iamsiam-resolver.iamsiam.workers.dev';
const SR = 44100, FPS = 15, BANDS = 24;

const arg = name => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };

function die(msg) { console.error(`✗ ${msg}`); process.exit(1); }

function decodeToPcm(file) {
  const probe = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  if (probe.error) die('ffmpeg not found - install with: brew install ffmpeg');
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', String(SR), 'pipe:1'],
    { maxBuffer: 1 << 30 });
  if (r.status !== 0) die(`ffmpeg decode failed: ${r.stderr}`);
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 4));
}

async function fetchStream(url) {
  const res = await fetch(`${WORKER_URL}/?url=${encodeURIComponent(url)}`);
  if (!res.ok) die(`resolver ${res.status} for ${url}`);
  const { streamUrl } = await res.json();
  const audio = await fetch(streamUrl);
  if (!audio.ok) die(`stream fetch ${audio.status}`);
  const dir = mkdtempSync(path.join(tmpdir(), 'bake-'));
  const f = path.join(dir, 'stream.mp3');
  writeFileSync(f, Buffer.from(await audio.arrayBuffer()));
  return { file: f, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const out = arg('--out');
if (!out) die('--out required');
let file = arg('--file'), cleanup = null;
if (!file) {
  const stream = arg('--stream');
  if (!stream) die('--file or --stream required');
  ({ file, cleanup } = await fetchStream(stream));
}
try {
  const pcm = decodeToPcm(file);
  if (pcm.length < SR) die('decoded audio implausibly short');
  const { env, frames, bands, duration } = analyzePcm(pcm, SR, { fps: FPS, bands: BANDS });
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({
    fps: FPS, bands, duration: Math.round(duration * 10) / 10, data: toBase64(quantize(env)),
  }) + '\n');
  console.log(`✓ ${out}  ${frames} frames · ${bands} bands · ${Math.round(duration)}s`);
} finally { cleanup?.(); }
