// tools/envelope-math.mjs
// Faithful port of the audio-analysis math from the studio tool:
//   /Users/travisstewart/MACHINEDRUM/CLAUDE DOCS/vu_meter_visual_tool/iamsiam-studio.html
//   - fft(re,im)          ported verbatim from studio `fft` (~line 2535)
//   - bandEdges           ported from studio `analyze` band-edge calc (~2576-2578)
//   - analyzePcm          ported from studio `analyze` (~2567-2617) + `buildEnv` (~2640-2671),
//                         reshaped into a pure function over PCM with fixed baking parameters.
//                         Includes one deliberate site-side extension NOT in the studio tool:
//                         a degenerate-input (true digital silence) guard - see inline comment.
//   - quantize/toBase64/fromBase64  new (baking-format helpers, not present in the studio)
//
// Pure functions only: no I/O, no async, no globals, no DOM. Node-only (Buffer for base64).

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** In-place radix-2 iterative Cooley-Tukey FFT. Ported verbatim from the studio's `fft`. */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j |= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1, ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j2 = 0; j2 < half; j2++) {
        const a = i + j2, b = a + half;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

/**
 * Log-spaced band edges from fmin=35Hz to fmax=min(16000, sr*0.45).
 * Ported from studio `analyze` (~2576-2578). Returns bands+1 edges.
 */
export function bandEdges(bands, sr) {
  const fmin = 35, fmax = Math.min(16000, sr * 0.45);
  const edges = new Float32Array(bands + 1);
  for (let b = 0; b <= bands; b++) edges[b] = fmin * Math.pow(fmax / fmin, b / bands);
  return edges;
}

/**
 * Analyze mono PCM into a per-band envelope, frame-major.
 * Port of studio `analyze` (per-frame centered 4096-pt Hann-windowed FFT, log-band mean power
 * in dB) followed by studio `buildEnv` (autoGain normalize, RANGE, gain, curve, attack/release
 * smoothing forward over frames). Fixed baking parameters (not configurable, matching the studio
 * defaults used for VU baking): autoGain on, RANGE 48, gain 1.35, curve 2.2, attack 0ms (instant
 * attack, aC=1), release 20ms.
 *
 * Site extension beyond the studio port: a peak-relative autoGain normalizer cannot rank a
 * zero-variance signal (every instant is trivially "the loudest instant"), which would otherwise
 * peg true digital silence at full-scale. When the whole signal sits at the analysis floor
 * (globalMax <= -190dB), this returns an all-zero envelope instead. Real audio is unaffected.
 *
 * @param {Float32Array} pcm mono samples
 * @param {number} sr sample rate
 * @param {{fps?: number, bands?: number}} opts
 * @returns {{env: Float32Array, frames: number, bands: number, duration: number}}
 */
export function analyzePcm(pcm, sr, { fps = 15, bands = 24 } = {}) {
  const dur = pcm.length / sr;
  const frames = Math.max(1, Math.ceil(dur * fps));
  const N = 4096, half = N >> 1;

  const hann = new Float32Array(N);
  for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));

  const edges = bandEdges(bands, sr);
  const binLo = new Int32Array(bands), binHi = new Int32Array(bands);
  for (let b = 0; b < bands; b++) {
    binLo[b] = clamp(Math.floor(edges[b] * N / sr), 1, half - 1);
    binHi[b] = clamp(Math.ceil(edges[b + 1] * N / sr), binLo[b] + 1, half);
  }

  const rawDb = new Float32Array(frames * bands);
  const re = new Float32Array(N), im = new Float32Array(N);

  for (let f = 0; f < frames; f++) {
    const centre = Math.round((f / fps) * sr);
    const start = centre - half;
    for (let i = 0; i < N; i++) {
      const s = start + i;
      re[i] = (s >= 0 && s < pcm.length) ? pcm[s] * hann[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b < bands; b++) {
      let p = 0;
      for (let k = binLo[b]; k < binHi[b]; k++) p += re[k] * re[k] + im[k] * im[k];
      p /= (binHi[b] - binLo[b]);
      rawDb[f * bands + b] = 10 * Math.log10(p + 1e-20);
    }
  }

  const bandMax = new Float32Array(bands).fill(-200);
  let globalMax = -200;
  for (let f = 0; f < frames; f++) {
    for (let b = 0; b < bands; b++) {
      const v = rawDb[f * bands + b];
      if (v > bandMax[b]) bandMax[b] = v;
      if (v > globalMax) globalMax = v;
    }
  }

  // Site extension (not in the studio tool): a zero-variance signal can't be
  // peak-normalized - treat true digital silence as dark, not full-scale.
  if (globalMax <= -190) {
    return { env: new Float32Array(frames * bands), frames, bands, duration: dur };
  }

  // buildEnv: normalization + gain + contrast + attack/release smoothing (studio ~2640-2671)
  const RANGE = 48, GAIN = 1.35, CURVE = 2.2;
  const dt = 1 / fps;
  const aC = 1;                              // attack 0ms -> instant attack
  const rC = 1 - Math.exp(-dt * 1000 / 20);   // release 20ms

  const env = new Float32Array(frames * bands);
  for (let b = 0; b < bands; b++) {
    const ref = Math.max(bandMax[b], globalMax - 30); // autoGain
    let s = 0;
    for (let f = 0; f < frames; f++) {
      let v = clamp((rawDb[f * bands + b] - (ref - RANGE)) / RANGE, 0, 1);
      v = clamp(v * GAIN, 0, 1);
      v = Math.pow(v, CURVE);
      s += (v > s ? aC : rC) * (v - s);
      env[f * bands + b] = s;
    }
  }

  return { env, frames, bands, duration: dur };
}

/** Quantize a [0,1] Float32Array envelope to a Uint8Array (round(clamp(v,0,1)*255)). */
export function quantize(envFloat) {
  const out = new Uint8Array(envFloat.length);
  for (let i = 0; i < envFloat.length; i++) out[i] = Math.round(clamp(envFloat[i], 0, 1) * 255);
  return out;
}

/** Uint8Array -> base64 string (Buffer-based; Node-only). */
export function toBase64(u8) {
  return Buffer.from(u8).toString('base64');
}

/** base64 string -> Uint8Array (Buffer-based; Node-only). */
export function fromBase64(str) {
  const buf = Buffer.from(str, 'base64');
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
}
