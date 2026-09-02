// IAMSIAM_LISTS - logo VU meter + level sources + typing layer.
//
// The renderer is a port of the studio tool's VU layer
// (../vu_meter_visual_tool/iamsiam-studio.html: extractBars / makeTinted / renderVU),
// with two site-side changes:
//   - settings live in a per-meter `opts` object instead of the studio's global `S.vu`
//   - levels come from a pluggable SOURCE (`levels(tSec, out)`) instead of a
//     frame-indexed analysis array, and the source's fixed band count is mapped
//     onto however many bars/columns the artwork yields.
// Browser-only, zero dependencies. The logo must be same-origin (extraction reads
// pixels via getImageData).

/* ---------------------------------------------------------------- helpers */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Studio S.vu defaults - the meter's look is defined here and nowhere else. */
export const VU_DEFAULTS = {
  style: 'bars',      // 'bars' | 'rise'
  anchor: 'right',    // bars style: 'left' | 'right' | 'center'
  react: 'bands',     // only 'bands' is implemented site-side (studio 'loud' not ported)
  flip: false,        // invert the band -> bar/column mapping
  minw: 0,            // floor level, percent
  ghost: 12,          // rise style: ghosted full logo underneath, percent alpha
  peak: true,
  peakDecay: 1.9,     // full-scale units per SECOND (see decay note in draw())
  tint: '#ffffff',
  tintOn: true,
  margin: 0,          // percent of the smaller canvas axis kept clear
  voff: 0,            // vertical offset, percent of canvas height
  parts: false,       // rise style: each detected part fills from its own baseline
};

function loadImage(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error(`could not load image: ${src}`));
    im.src = src;
  });
}

/* ------------------------------------------- logo: alpha-driven extraction */

/** Ported verbatim from the studio tool (~line 2393). */
function extractBars(img) {
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, W, H).data;
  const TH = 16;                                  // alpha threshold
  const GAP = Math.max(2, Math.round(W * 0.006)); // merge segments closer than this
  const MINW = Math.max(2, Math.round(W * 0.003));// ignore specks narrower than this

  const rowHas = new Uint8Array(H);
  for (let y = 0; y < H; y++) {
    const o = y * W * 4;
    for (let x = 0; x < W; x++) { if (d[o + x * 4 + 3] > TH) { rowHas[y] = 1; break; } }
  }
  const strips = [];
  for (let y = 0; y < H;) {
    if (rowHas[y]) { const y0 = y; while (y < H && rowHas[y]) y++; strips.push([y0, y]); }
    else y++;
  }
  const bars = [];
  strips.forEach((st, row) => {
    const [y0, y1] = st;
    const colMax = new Uint8Array(W);
    for (let x = 0; x < W; x++) {
      let m = 0;
      for (let yy = y0; yy < y1; yy++) { const a = d[(yy * W + x) * 4 + 3]; if (a > m) m = a; }
      colMax[x] = m;
    }
    const segs = [];
    for (let x = 0; x < W;) {
      if (colMax[x] > TH) { const x0 = x; while (x < W && colMax[x] > TH) x++; segs.push([x0, x]); }
      else x++;
    }
    const merged = [];
    for (const s of segs) {
      if (merged.length && s[0] - merged[merged.length - 1][1] <= GAP) merged[merged.length - 1][1] = s[1];
      else merged.push([...s]);
    }
    for (const [x0, x1] of merged) {
      if (x1 - x0 >= MINW) bars.push({ row, y: y0, h: y1 - y0, x0, x1 });
    }
  });
  /* column strips - the vertical counterpart, used by the rising-fill style */
  const colHas = new Uint8Array(W);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) { if (d[(y * W + x) * 4 + 3] > TH) { colHas[x] = 1; break; } }
  }
  const colStrips = [];
  for (let x = 0; x < W;) {
    if (colHas[x]) { const x0 = x; while (x < W && colHas[x]) x++; colStrips.push([x0, x]); }
    else x++;
  }
  const mergedCols = [];
  for (const s of colStrips) {
    if (mergedCols.length && s[0] - mergedCols[mergedCols.length - 1][1] <= GAP) mergedCols[mergedCols.length - 1][1] = s[1];
    else mergedCols.push([...s]);
  }
  const cols = mergedCols.filter(([x0, x1]) => x1 - x0 >= MINW);
  /* parts: clusters of row strips split at unusually large vertical gaps -
     e.g. the blank line between the M and the D of the monogram. Contiguous
     artwork yields a single part. */
  const parts = [];
  if (strips.length) {
    const gaps = [];
    for (let i = 1; i < strips.length; i++) gaps.push(strips[i][0] - strips[i - 1][1]);
    const sorted = [...gaps].sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    const contentH = strips[strips.length - 1][1] - strips[0][0];
    const TH_GAP = Math.max(2.5 * median, 0.02 * contentH);
    let i0 = 0;
    for (let i = 1; i <= strips.length; i++) {
      if (i === strips.length || gaps[i - 1] > TH_GAP) { parts.push({ i0, i1: i - 1 }); i0 = i; }
    }
  }
  return { bars, rows: strips.length, strips, cols, parts, w: W, h: H, canvas: c };
}

/** Studio makeTinted (~2471): the logo silhouette filled with a flat colour. */
function makeTinted(logoCanvas, tint, tintOn) {
  const t = document.createElement('canvas');
  t.width = logoCanvas.width; t.height = logoCanvas.height;
  const g = t.getContext('2d');
  g.drawImage(logoCanvas, 0, 0);
  if (tintOn) {
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = tint;
    g.fillRect(0, 0, t.width, t.height);
  }
  return t;
}

/**
 * Load a logo image and run extraction ONCE. The result is shareable between
 * meters (the extraction and the tinted bitmaps are the expensive parts).
 * @returns {Promise<object>} { bars, rows, strips, cols, parts, w, h, canvas, tinted(tint,on) }
 */
export async function loadLogo(url) {
  const img = await loadImage(url);
  const logo = extractBars(img);
  if (!logo.bars.length) throw new Error('no bars detected - logo needs an alpha channel');
  const cache = new Map();
  logo.tinted = (tint, tintOn) => {
    const key = tintOn ? String(tint) : '#none';
    let c = cache.get(key);
    if (!c) { c = makeTinted(logo.canvas, tint, tintOn); cache.set(key, c); }
    return c;
  };
  return logo;
}

/* --------------------------------------------------------- level sources */

function b64ToBytes(b64) {
  const bin = atob(String(b64));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * A baked envelope file -> level source.
 * @param {{fps:number,bands:number,duration:number,data:string}} json
 */
export function envelopeSource(json) {
  const fps = Number(json?.fps) || 15;
  const bands = Number(json?.bands) || 24;
  const data = b64ToBytes(json?.data ?? '');
  const frames = Math.max(1, Math.floor(data.length / bands));
  return {
    kind: 'envelope', fps, bands, frames, duration: Number(json?.duration) || frames / fps,
    levels(tSec, out) {
      const f = clamp(Math.floor((Number(tSec) || 0) * fps), 0, frames - 1);
      const o = f * bands;
      const n = Math.min(out.length, bands);
      for (let b = 0; b < n; b++) out[b] = data[o + b] / 255;
      for (let b = n; b < out.length; b++) out[b] = 0;
    },
  };
}

function hash01(x) {
  let h = x | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Smoothstep-interpolated value noise on a 1-D lattice, per lane. */
function vnoise(x, lane, seed) {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  const k = Math.imul(lane | 0, 668265263) ^ seed;
  const a = hash01(Math.imul(i, 374761393) ^ k);
  const b = hash01(Math.imul(i + 1, 374761393) ^ k);
  return a + (b - a) * u;
}

/**
 * Deterministic stand-in for tracks with no baked envelope: per-band value noise
 * plus a seeded rhythmic hit grid (kick on beats, hats on subdivisions), so the
 * motion reads as music rather than as noise. Bass bands churn faster and sit
 * louder; hits decay exponentially. Pure in t - scrubbing is consistent.
 */
export function simSource(seed = 1) {
  const s0 = (Math.imul((seed | 0) || 1, 0x9e3779b1) >>> 0) | 0;
  const bpm = 138 + Math.floor(hash01(s0 ^ 0x5f3759df) * 60);   // 138..197
  const beat = 60 / bpm;
  return {
    kind: 'sim', bands: 24, seed, bpm,
    levels(tSec, out) {
      const t = Number(tSec) || 0;
      const n = out.length;
      for (let b = 0; b < n; b++) {
        const p = n > 1 ? b / (n - 1) : 0;                    // 0 = low band, 1 = high
        // wander: bass lattice churns ~2x faster than treble
        const rate = 7.5 - 5.0 * p;
        const w = 0.52 * vnoise(t * rate, b, s0)
                + 0.30 * vnoise(t * rate * 2.7 + 11.3, b + 64, s0)
                + 0.18 * vnoise(t * 0.45 + 3.1, b + 128, s0);
        // hits: bass on the beat, mids on 8ths, highs on 16ths
        const div = p < 0.25 ? 1 : (p < 0.6 ? 0.5 : 0.25);
        const step = beat * div;
        const ph = t / step;
        const idx = Math.floor(ph);
        const gate = hash01(Math.imul(idx, 2654435761) ^ Math.imul(b, 40503) ^ s0) < (0.9 - 0.45 * p) ? 1 : 0;
        const decay = 0.22 - 0.13 * p;                        // seconds
        const hit = gate * Math.exp(-((ph - idx) * step) / decay);
        let v = w * (0.42 + 0.22 * (1 - p)) + hit * 0.58;
        v *= 1 - 0.35 * p * p;                                // spectral tilt: bass louder
        out[b] = clamp(Math.pow(clamp(v, 0, 1), 1.35), 0, 1);
      }
    },
  };
}

/* ---------------------------------------------------------------- renderer */

/** Studio renderVU (~2733). `R.mapped` replaces levelFor/levelForRise's env lookup. */
function renderVU(g, W, H, R) {
  const { logo, opts, mapped, peaks, dec, tinted } = R;
  const rows = logo.rows, nCols = logo.cols.length;
  const m = opts.margin / 100;
  const sc = Math.min(W * (1 - 2 * m) / logo.w, H * (1 - 2 * m) / logo.h);
  const ox = (W - logo.w * sc) / 2, oy = (H - logo.h * sc) / 2 - opts.voff / 100 * H;
  const minF = opts.minw / 100;
  const mw = Math.max(3, logo.h * 0.006);   // peak tick width in logo px

  g.fillStyle = opts.tintOn ? opts.tint : '#ffffff';

  if (opts.style === 'rise') {
    /* rising fill: one meter per column strip, waterline snapped to
       row-strip boundaries so glyphs light whole, never sliced.
       Whole-logo mode: one waterline over the full height, so all pieces
       fill together. Parts mode: each detected part (e.g. the M and the D)
       fills from its OWN bottom edge, driven by the same column level. */
    const st = logo.strips, nSt = st.length;
    const parts = (opts.parts && logo.parts.length > 1) ? logo.parts : [{ i0: 0, i1: nSt - 1 }];
    if (opts.ghost > 0) {
      g.globalAlpha = opts.ghost / 100;
      g.drawImage(tinted, 0, 0, logo.w, logo.h, ox, oy, logo.w * sc, logo.h * sc);
      g.globalAlpha = 1;
    }
    const th = Math.max(4, logo.h * 0.012);   // peak tick thickness in logo px
    for (let i = 0; i < nCols; i++) {
      const [x0, x1] = logo.cols[i];
      const lvl = mapped[opts.flip ? (nCols - 1 - i) : i] || 0;
      const frac = clamp(minF + lvl * (1 - minF), 0, 1);
      if (opts.peak && peaks) peaks[i] = Math.max(frac, (peaks[i] || 0) - dec);
      const pf = peaks ? peaks[i] : 0;
      for (const part of parts) {
        const pSt = part.i1 - part.i0 + 1;
        const yTop = st[part.i0][0], yBot = st[part.i1][1];
        /* glyph/scanline art: snap to row strips. coarse art (few strips):
           continuous waterline so the fill rises smoothly, not in chunks */
        let yW = null;
        if (pSt >= 8) {
          const nLit = Math.round(frac * pSt);
          if (nLit > 0) yW = st[part.i1 - nLit + 1][0];
        } else {
          const fh = frac * (yBot - yTop);
          if (fh > 0.5) yW = yBot - fh;
        }
        if (yW !== null) {
          g.drawImage(tinted, x0, yW, x1 - x0, yBot - yW, ox + x0 * sc, oy + yW * sc, (x1 - x0) * sc, (yBot - yW) * sc);
        }
        if (opts.peak && peaks && pf > frac + 0.02) {
          /* tick = a thin slice of the artwork itself at the peak height, so
             it only appears where the column actually has ink */
          const py = yBot - pf * (yBot - yTop);
          g.drawImage(tinted, x0, py, x1 - x0, th, ox + x0 * sc, oy + py * sc, (x1 - x0) * sc, th * sc);
        }
      }
    }
    return;
  }
  for (let i = 0; i < logo.bars.length; i++) {
    const bar = logo.bars[i];
    const lvl = mapped[opts.flip ? bar.row : (rows - 1 - bar.row)] || 0;
    const frac = clamp(minF + lvl * (1 - minF), 0, 1);
    const bw = bar.x1 - bar.x0;
    const vw = Math.max(1, bw * frac);
    let sx;
    if (opts.anchor === 'left') sx = bar.x0;
    else if (opts.anchor === 'right') sx = bar.x1 - vw;
    else sx = bar.x0 + (bw - vw) / 2;
    g.drawImage(tinted, sx, bar.y, vw, bar.h, ox + sx * sc, oy + bar.y * sc, vw * sc, bar.h * sc);

    if (opts.peak && peaks) {
      peaks[i] = Math.max(frac, (peaks[i] || 0) - dec);
      const pf = peaks[i];
      if (pf > frac + 0.02) {
        const yv = oy + bar.y * sc, hv = bar.h * sc, wv = mw * sc;
        if (opts.anchor === 'left') {
          const px = clamp(bar.x0 + pf * bw, bar.x0, bar.x1 - mw);
          g.fillRect(ox + px * sc, yv, wv, hv);
        } else if (opts.anchor === 'right') {
          const px = clamp(bar.x1 - pf * bw, bar.x0, bar.x1 - mw);
          g.fillRect(ox + px * sc, yv, wv, hv);
        } else {
          const cx = bar.x0 + bw / 2, hf = pf * bw / 2;
          const l = clamp(cx - hf, bar.x0, bar.x1 - mw);
          const r = clamp(cx + hf - mw, bar.x0, bar.x1 - mw);
          g.fillRect(ox + l * sc, yv, wv, hv);
          g.fillRect(ox + r * sc, yv, wv, hv);
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ meter */

/**
 * @param {object} a
 * @param {HTMLCanvasElement} a.canvas   target canvas (sized from its CSS box * dpr)
 * @param {object} [a.logo]              pre-extracted logo (from loadLogo) - preferred
 * @param {string} [a.logoUrl]           used only when `logo` is absent
 * @param {object} [a.opts]              overrides on VU_DEFAULTS
 */
export async function createMeter({ canvas, logoUrl, logo, opts } = {}) {
  if (!canvas) throw new Error('createMeter: canvas required');
  const L = logo || await loadLogo(logoUrl);
  const O = { ...VU_DEFAULTS, ...(opts || {}) };
  const g = canvas.getContext('2d');

  let src = null;                       // { levels(tSec, out) } or null (idle)
  let nBands = 24;                      // source band count to map from
  let bandBuf = new Float32Array(nBands);
  let mapped = new Float32Array(1);
  let peaks = new Float32Array(Math.max(L.bars.length, L.cols.length));
  let raf = 0, getTime = null, lastMs = 0, sizeDirty = true, locked = false, box = null;

  /* Backing store follows the canvas's CSS box * devicePixelRatio. Measured from
     the padding box (clientWidth/Height), which excludes any border - the border
     box would not match the intrinsic size below. A canvas with no CSS size takes
     its LAYOUT size FROM the backing store, so scaling by dpr would grow it on
     every pass: pin such a canvas to its intrinsic size once, before touching it. */
  const MAXPX = 8192;
  function fit() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    if (!locked && canvas.clientWidth > 0 && canvas.clientHeight > 0) {
      locked = true;                       // decided once the canvas is measurable
      if (canvas.clientWidth === canvas.width && canvas.clientHeight === canvas.height) {
        canvas.style.width = `${canvas.width}px`;
        canvas.style.height = `${canvas.height}px`;
      }
    }
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (cw < 1 || ch < 1) return null;                 // hidden / detached: nothing to draw
    const bw = clamp(Math.round(cw * dpr), 1, MAXPX), bh = clamp(Math.round(ch * dpr), 1, MAXPX);
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    sizeDirty = false;
    box = { w: bw / dpr, h: bh / dpr, dpr };
    return box;
  }

  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(() => { sizeDirty = true; });
    try { ro.observe(canvas); } catch { ro = null; }
  }

  function remap(tSec) {
    const count = O.style === 'rise' ? L.cols.length : L.rows;
    if (mapped.length !== count) mapped = new Float32Array(count);
    if (!src) { mapped.fill(0); return; }
    if (bandBuf.length !== nBands) bandBuf = new Float32Array(nBands);
    src.levels(tSec, bandBuf);
    for (let j = 0; j < count; j++) {
      mapped[j] = bandBuf[clamp(Math.floor(j * nBands / count), 0, nBands - 1)] || 0;
    }
  }

  /**
   * Draw one frame. `dtSec` is the wall-clock gap used for peak decay; the
   * studio decayed peakDecay/fps per EXPORT frame (1.9 full-scale/s at 30fps),
   * so the site decays by rate * elapsed - identical speed at any refresh rate.
   */
  function draw(tSec, dtSec) {
    if (sizeDirty || !box) { if (!fit()) return; }
    const { w: W, h: H, dpr } = box;
    remap(tSec || 0);
    const dt = clamp(typeof dtSec === 'number' ? dtSec : 1 / 60, 0, 0.1);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    renderVU(g, W, H, {
      logo: L, opts: O, mapped, peaks: O.peak ? peaks : null,
      dec: O.peakDecay * dt, tinted: L.tinted(O.tint, O.tintOn),
    });
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  const meter = {
    canvas, logo: L, opts: O,
    get running() { return !!raf; },

    setSource(s) { src = s || null; peaks.fill(0); return meter; },
    setBands(n) {
      const v = Math.max(1, Math.floor(n) || 1);
      if (v !== nBands) { nBands = v; bandBuf = new Float32Array(nBands); }
      return meter;
    },
    setOpts(patch) {
      Object.assign(O, patch || {});
      peaks = new Float32Array(Math.max(L.bars.length, L.cols.length));
      sizeDirty = true;
      return meter;
    },
    resize() { sizeDirty = true; return meter; },

    /** @param {() => number} timeFn seconds into the current track */
    start(timeFn) {
      getTime = typeof timeFn === 'function' ? timeFn : () => 0;
      if (raf) return meter;
      fit();
      lastMs = 0;
      const tick = now => {
        raf = requestAnimationFrame(tick);
        const dt = lastMs ? (now - lastMs) / 1000 : 1 / 60;
        lastMs = now;
        draw(getTime() || 0, dt);
      };
      raf = requestAnimationFrame(tick);
      return meter;
    },

    stop() {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      lastMs = 0;
      peaks.fill(0);
      const keep = src; src = null;         // idle frame: every bar at minw
      draw(0, 0);
      src = keep;
      return meter;
    },

    draw(tSec) { draw(tSec || 0, 0); return meter; },

    destroy() {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (ro) { try { ro.disconnect(); } catch { /* gone */ } ro = null; }
      src = null;
      return meter;
    },
  };
  return meter;
}

/* ----------------------------------------------------------- typing layer */

function upperBound(arr, v) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= v) lo = m + 1; else hi = m; }
  return lo;
}

/**
 * Studio typing timeline (~2680): char i (1-based) appears at
 * t(1) = startMs; t(i) = t(i-1) + 30 + ((i * 37) % 53).
 * Sets `el.textContent` progressively and carries the `typing` class (the CSS
 * blink cursor) until the last character lands.
 * @returns {{done: Promise<boolean>, cancel: () => void}} done resolves true when
 *          the text finished typing, false if cancelled.
 */
export function typeInto(el, text, { startMs = 600 } = {}) {
  const str = String(text ?? '');
  const times = [];
  let t = 0;
  for (let i = 1; i <= str.length; i++) {
    t = i === 1 ? startMs : t + 30 + ((i * 37) % 53);
    times.push(t);
  }
  let raf = 0, settle = null, cancelled = false, shown = -1;
  const done = new Promise(res => { settle = res; });
  const finish = ok => {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (el) el.classList.remove('typing');
    settle(ok);
  };
  if (el) { el.textContent = ''; el.classList.add('typing'); }
  if (!str.length) { finish(true); return { done, cancel() {} }; }

  const t0 = performance.now();
  const tick = now => {
    if (cancelled) return;
    const n = upperBound(times, now - t0);
    if (n !== shown) { shown = n; if (el) el.textContent = str.slice(0, n); }
    if (n >= str.length) { finish(true); return; }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return {
    done,
    cancel() { if (cancelled) return; cancelled = true; finish(false); },
  };
}
