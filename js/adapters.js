// IAMSIAM_LISTS - per-source playback adapters behind one interface.
import { WORKER_URL } from './config.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- bandcamp: resolved mp3-128 in an <audio> element ---------- */
export function bandcampAdapter() {
  let audio = null, meta = null, track = null, retried = false, ctrl = null;
  const a = {
    onended: null, onerror: null, onstate: null,
    async mount(t, mediaEl) {
      track = t;
      ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      let r;
      try { r = await fetch(`${WORKER_URL}/?url=${encodeURIComponent(t.stream.url)}`, { signal: ctrl.signal }); }
      finally { clearTimeout(timer); }
      if (!r.ok) throw Object.assign(new Error('resolve failed'), { code: r.status });
      meta = await r.json();
      mediaEl.innerHTML = meta.art ? `<img class="bc-art" src="${esc(meta.art)}" alt="">` : '';
      audio = new Audio();
      audio.src = meta.streamUrl;
      audio.preload = 'auto';
      audio.addEventListener('ended', () => a.onended?.());
      audio.addEventListener('error', async () => {
        // Signed URL likely expired mid-session: re-resolve once, resume position.
        if (!audio) return; // destroyed: clearing src fires a trailing error event
        if (retried || !track) { a.onerror?.(new Error('stream error')); return; }
        retried = true;
        const pos = audio.currentTime;
        try {
          const r2 = await fetch(`${WORKER_URL}/?url=${encodeURIComponent(track.stream.url)}`);
          if (!r2.ok) throw new Error('re-resolve failed');
          audio.src = (await r2.json()).streamUrl;
          audio.currentTime = pos;
          await audio.play();
        } catch (e) { a.onerror?.(e); }
      });
      audio.addEventListener('play', () => a.onstate?.(true));
      audio.addEventListener('pause', () => { if (audio && !audio.ended) a.onstate?.(false); });
    },
    play: () => audio?.play().catch(() => a.onerror?.(new Error('playback blocked'))),
    pause: () => audio?.pause(),
    seek: s => { if (audio) audio.currentTime = s; },
    time: () => audio?.currentTime ?? 0,
    duration: () => (audio?.duration || meta?.duration || 0),
    destroy: () => { ctrl?.abort(); if (audio) { const el = audio; audio = null; el.pause(); el.src = ''; } },
  };
  return a;
}

/* ---------- self-hosted file: plain <audio>, no resolver needed ---------- */
export function fileAdapter() {
  let audio = null;
  const a = {
    onended: null, onerror: null, onstate: null,
    async mount(t, mediaEl) {
      mediaEl.innerHTML = t.art ? `<img class="bc-art" src="${esc(t.art)}" alt="">` : '';
      audio = new Audio();
      audio.src = t.stream.url;
      audio.preload = 'auto';
      audio.addEventListener('ended', () => a.onended?.());
      audio.addEventListener('error', () => { if (audio) a.onerror?.(new Error('audio error')); });
      audio.addEventListener('play', () => a.onstate?.(true));
      audio.addEventListener('pause', () => { if (audio && !audio.ended) a.onstate?.(false); });
    },
    play: () => audio?.play().catch(() => a.onerror?.(new Error('playback blocked'))),
    pause: () => audio?.pause(),
    seek: s => { if (audio) audio.currentTime = s; },
    time: () => audio?.currentTime ?? 0,
    duration: () => audio?.duration || 0,
    destroy: () => { if (audio) { const el = audio; audio = null; el.pause(); el.src = ''; } },
  };
  return a;
}

/* ---------- youtube: official IFrame API, player visible (ToS) ---------- */
let ytReady = null;
function loadYT() {
  if (ytReady) return ytReady;
  ytReady = new Promise((res, rej) => {
    if (window.YT?.Player) return res();
    const prev = window.onYouTubeIframeAPIReady;
    const timer = setTimeout(() => fail(new Error('youtube api timeout')), 15000);
    const fail = err => { clearTimeout(timer); ytReady = null; rej(err); };
    window.onYouTubeIframeAPIReady = () => { prev?.(); clearTimeout(timer); res(); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { s.remove(); fail(new Error('youtube api blocked')); };
    document.head.appendChild(s);
  });
  return ytReady;
}
export const ytVideoId = url =>
  String(url ?? '').match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/)?.[1] ?? null;

export function youtubeAdapter() {
  let player = null, readyP = null;
  const a = {
    onended: null, onerror: null, onstate: null,
    async mount(t, mediaEl) {
      const id = ytVideoId(t.stream.url);
      if (!id) throw new Error('bad youtube url');
      await loadYT();
      const host = document.createElement('div');
      mediaEl.innerHTML = ''; mediaEl.appendChild(host);
      readyP = new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error('youtube ready timeout')), 15000);
        player = new YT.Player(host, {
          videoId: id, width: '100%', height: '100%',
          playerVars: { playsinline: 1, rel: 0 },
          events: {
            onReady: () => { clearTimeout(timer); res(); },
            onError: () => { clearTimeout(timer); rej(new Error('youtube error')); a.onerror?.(new Error('youtube error')); },
            onStateChange: e => {
              if (e.data === YT.PlayerState.ENDED) a.onended?.();
              else if (e.data === YT.PlayerState.PLAYING) a.onstate?.(true);
              else if (e.data === YT.PlayerState.PAUSED) a.onstate?.(false);
            },
          },
        });
      });
      await readyP;
    },
    play: () => player?.playVideo(),
    pause: () => player?.pauseVideo(),
    seek: s => player?.seekTo(s, true),
    time: () => player?.getCurrentTime?.() ?? 0,
    duration: () => player?.getDuration?.() ?? 0,
    destroy: () => { player?.destroy?.(); player = null; },
  };
  return a;
}

/* ---------- soundcloud: official Widget API ---------- */
let scReady = null;
function loadSC() {
  if (scReady) return scReady;
  scReady = new Promise((res, rej) => {
    if (window.SC?.Widget) return res();
    const timer = setTimeout(() => fail(new Error('soundcloud api timeout')), 15000);
    const fail = err => { clearTimeout(timer); scReady = null; rej(err); };
    const s = document.createElement('script');
    s.src = 'https://w.soundcloud.com/player/api.js';
    s.onload = () => { clearTimeout(timer); res(); };
    s.onerror = () => { s.remove(); fail(new Error('soundcloud api blocked')); };
    document.head.appendChild(s);
  });
  return scReady;
}

export function soundcloudAdapter() {
  let widget = null, dur = 0, pos = 0, started = false;
  const a = {
    onended: null, onerror: null, onstate: null,
    async mount(t, mediaEl) {
      await loadSC();
      const src = 'https://w.soundcloud.com/player/?url=' + encodeURIComponent(t.stream.url) +
        '&color=%23ffffff&inverse=true&show_teaser=false&visual=true';
      mediaEl.innerHTML = `<iframe allow="autoplay" src="${esc(src)}"></iframe>`;
      widget = SC.Widget(mediaEl.querySelector('iframe'));
      await new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error('soundcloud timeout')), 12000);
        widget.bind(SC.Widget.Events.READY, () => {
          clearTimeout(timer);
          widget.getDuration(ms => { dur = ms / 1000; });
          widget.bind(SC.Widget.Events.PLAY_PROGRESS, e => { pos = e.currentPosition / 1000; if (!dur) widget.getDuration(ms => { dur = ms / 1000; }); });
          widget.bind(SC.Widget.Events.FINISH, () => a.onended?.());
          widget.bind(SC.Widget.Events.ERROR, () => a.onerror?.(new Error('soundcloud error')));
          widget.bind(SC.Widget.Events.PLAY, () => { started = true; a.onstate?.(true); });
          widget.bind(SC.Widget.Events.PAUSE, () => a.onstate?.(false));
          res();
        });
      });
    },
    play: () => {
      if (!widget) return;
      widget.play();
      // The widget occasionally swallows the first play() right after READY - re-issue once.
      setTimeout(() => { if (widget && !started) widget.play(); }, 800);
    },
    pause: () => widget?.pause(),
    seek: s => { widget?.seekTo(s * 1000); pos = s; },
    time: () => pos,
    duration: () => dur,
    destroy: () => {
      if (widget) { for (const ev of ['READY', 'PLAY', 'PAUSE', 'PLAY_PROGRESS', 'FINISH', 'ERROR']) { try { widget.unbind(SC.Widget.Events[ev]); } catch {} } }
      widget = null;
    },
  };
  return a;
}

export const adapterFor = t =>
  t?.stream?.type === 'bandcamp' ? bandcampAdapter()
  : t?.stream?.type === 'file' ? fileAdapter()
  : t?.stream?.type === 'youtube' ? youtubeAdapter()
  : t?.stream?.type === 'soundcloud' ? soundcloudAdapter()
  : null;
