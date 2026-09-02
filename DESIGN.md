# IAMSIAM_LISTS - Design Spec

**Date:** 2026-09-01
**Status:** Approved by Travis (2026-09-01)
**Project:** Website for IAMSIAM_LISTS - a weekly playlist of music curated by friends and family of the IAMSIAM label.

---

## What it is

A public website where each week's curated top 10 lives. Visitors can play every track in full through one unified player, see track info, and buy each track through its best available store link. The IAMSIAM logo VU meter (from the studio tool used for the Instagram carousels) runs as the visualizer while listening. Travis adds a new list weekly through a Claude Code session that automatically resolves each track's streaming source and buy source.

## Decisions made

| Decision | Choice |
|---|---|
| Player | Unified custom player (one play button + transport for all sources) |
| Weekly add workflow | Claude Code session via a project `/add-list` skill |
| Hosting | GitHub Pages (static) + one free Cloudflare Worker (Bandcamp resolver) |
| V1 scope | Current list + archive of past lists + about blurb |
| Look/design process | Iterate on real HTML in M1 (design language already exists in the studio tool). Claude Design canvas only as an optional later detour for comparing layout variants. |

## Architecture overview

- **Static site**, no database, no build step. One repo (`IAMSIAM-LISTS`), published on GitHub Pages. Custom domain attachable later.
- **Each weekly list is a JSON file** in the repo. Adding a week = adding JSON + envelope + art files and pushing.
- **One Cloudflare Worker** (~60 lines) resolves Bandcamp stream URLs at play time. Everything else runs in the browser.
- **VU meter** is driven by pre-baked envelope JSON (per-band levels over time), computed at add time from Travis's local audio files using the same math as the studio tool. No live audio analysis is possible from any embed source (verified: Bandcamp's stream CDN sends no CORS headers, so Web Audio analysis of it is blocked; YouTube and SoundCloud never expose audio data).

## Data model

One file per week: `lists/YYYY-MM-DD-curator.json`

```json
{
  "curator": "machinedrum",
  "listTitle": "top 10 jungle collaborations",
  "date": "2026-08-24",
  "intro": "optional curator intro text",
  "tracks": [
    {
      "rank": 1,
      "artist": "Africa Hitech",
      "title": "Out In The Streets (VIP)",
      "details": "warp · 2011 · 3:40",
      "note": "optional curator note about this track",
      "art": "art/2026-08-24/01.jpg",
      "stream": { "type": "bandcamp", "url": "https://..." },
      "buy": [
        { "platform": "bandcamp", "url": "https://..." },
        { "platform": "beatport", "url": "https://..." }
      ],
      "envelope": "env/2026-08-24/01.json"
    }
  ]
}
```

- `stream.type`: `bandcamp | soundcloud | youtube | other`. Stream priority when resolving: **Bandcamp first**, then SoundCloud, then YouTube (SoundCloud ranks above YouTube because it is audio-first and needs no video slot), then whatever site actually hosts it.
- **Unreleased tracks are left off the site entirely** (Travis's call, 2026-09-01): if a track has no public stream anywhere (private dubplates), `/add-list` omits it and keeps the remaining tracks' original rank numbers. The schema still tolerates an absent `stream` (renders an UNRELEASED badge, player skips, validator warns) as belt-and-braces, but the policy is omission.
- `buy`: priority-ordered. **Bandcamp first, then Beatport, then wherever it is genuinely sold** (Boomkat, Juno, iTunes, etc.). The site renders `buy[0]` as THE buy button; extras can show in an expandable row. `buy` MAY be empty for tracks that are genuinely not for sale anywhere (dubplates, video-only freestyles) - the site then shows no buy button, and the validator warns instead of erroring.
- `envelope` and `note` are optional. A track without an envelope gets the simulated VU mode.
- An `index.json` lists all weeks (date, curator, listTitle, slug) so the archive renders without fetching every file.
- The schema mirrors the info-layer fields already in the studio tool (`rank / artist / title / details / curator / listTitle`), so the same text feeds the site and the IG carousel.

## Unified player

One transport bar for the playlist: play/pause, scrub, prev/next, elapsed/total time, track counter. Three adapters behind a common interface (`load, play, pause, seek, currentTime, duration, onEnded`):

### Bandcamp adapter (default source)
- On play, the page calls the Worker: `GET /resolve?url=<bandcamp track url>`.
- Worker fetches the Bandcamp page server-side, parses the `data-tralbum` attribute (HTML-entity-decoded JSON), returns `{ streamUrl, duration, title, art }`.
- Playback via a plain `<audio>` element. Verified 2026-09-01 against `iamsiam.bandcamp.com/track/survival-skills`: stream returns HTTP 200 `audio/mpeg` with `accept-ranges: bytes`, so scrubbing works.
- Stream URLs are **signed and expire after hours** - they are resolved at play time and never stored in the repo.
- Resolve failure → fall back to the official Bandcamp EmbeddedPlayer iframe for that track (buy link always still shown).

### YouTube adapter
- IFrame Player API. The video is **visible** in the now-playing panel (YouTube ToS requires a visible player; the video slot looks good there anyway). Transport proxied to the unified bar.

### SoundCloud adapter
- Widget API. Widget artwork/waveform occupies the same now-playing panel slot.

### ToS note (honest)
Parsing `data-tralbum` is unofficial. It is the same 128kbps stream Bandcamp's own public page plays and has been accessible for a decade, but it sits outside their blessed API surface. Mitigations: the whole site drives purchases (prominent buy button on every track), the embed fallback keeps the site alive if Bandcamp ever locks it down, and curators are friends and family so per-track permission is usually one DM away.

## VU meter on the web

- Port `extractBars`, `renderVU`, tint/ghost/peak/rise settings, and the info-layer typing renderer out of `vu_meter_visual_tool/iamsiam-studio.html` into a shared module `js/iamsiam-vu.js`. The studio tool keeps working as is; the site imports the module.
- **Envelope-driven:** during playback the meter reads `envelope[floor(currentTime * fps)]`. Works identically across all three adapters since all report current time.
- **Envelope file format** (`env/<date>/<nn>.json`): `{ "fps": 15, "rows": N, "duration": seconds, "data": "<base64 of Uint8Array, frames × rows>" }`. Roughly 40-80KB per track.
- **Baker script** `tools/bake-envelopes.mjs` (Node): reuses the exact `analyze` + `buildEnv` FFT math from the studio tool (4096-point FFT, Hann window, log-spaced bands 35Hz-16kHz, normalization + gain/curve/attack/release), quantized to 8-bit at 15fps. Input: the local WAV/MP3 files Travis already collects for the carousels (e.g. `vu_meter_visual_tool/MACHINEDRUM_LIST/`). If no local audio exists for a track, the baker can analyze a temporarily downloaded copy of the resolved stream, or the track ships without an envelope.
- **Simulated fallback:** tracks with no envelope animate a tasteful pseudo-random mode driven by play state + time, so nothing ever looks broken.
- The IAMSIAM logo PNG (alpha channel) is committed to the repo as the meter source asset.

## Weekly workflow: `/add-list` skill

A project skill checked into the repo (`.claude/skills/add-list/`) so any future session knows the drill. Input: curator name, list title, the 10 entries (plain text lines like `Artist - Title`, or URLs), optional folder of audio files, optional curator notes.

Steps the session performs:
1. For each track, search **Bandcamp first** (site search, label/artist pages), then **Beatport**, then SoundCloud/YouTube/elsewhere. Agent search handles fuzzy matching (white labels, VIPs, unreleased edits) that scripted lookups fail on.
2. Apply priority rules (stream: Bandcamp → SoundCloud/YouTube → other; buy: Bandcamp → Beatport → other).
3. Fetch artwork and metadata (year, label, length). Details line format: `label · year · length` - no BPM, no curator-note line on rows (Travis, 2026-09-01: keep the info simple).
4. Run the envelope baker on provided audio files.
5. Present a **review table** (rank / track / stream source / buy source / gaps) and wait for Travis's OK.
6. Write the list JSON, update `index.json`, run the validator, commit, push. GitHub Pages deploys in about a minute.

## Pages and look

Single-page app (`index.html`) with hash routing (`#/`, `#/archive`, `#/about`, `#/list/<slug>`), in the single-file spirit of Travis's other tools. Aesthetic = the IG carousel language exactly: black background, IBM Plex Mono, white logo, typing animation from the info layer. Mobile-first (audience arrives from Instagram).

- **Home (`#/`)**: intro strip ("INTRODUCING IAMSIAM LISTS : A WEEKLY COLLECTION..."), VU meter hero with now-playing info typing in beneath it, unified transport, then the ranked tracklist. Each row: rank, artist - title, details line, source badge, BUY button.
- **Archive (`#/archive`)**: past weeks as a simple grid (curator, list title, date). Clicking loads that list into the same player view.
- **About (`#/about`)**: short blurb from the label primer + Instagram link.

## Failure handling

- Expired stream mid-play → silently re-resolve via the Worker and resume at the saved position.
- Worker unreachable → official embeds for Bandcamp tracks; other adapters unaffected.
- Dead/blocked YouTube video → notice in the now-playing panel, buy link still shown, next-track still works.
- `tools/validate-lists.mjs` checks every list JSON against the schema (required fields, URL shapes, file references exist) before publish so a typo cannot blank the site.
- Testing stays light: the validator, a resolver smoke test, and a manual QA checklist per milestone (desktop + phone).

## Milestones (gated - complete and verify each before starting the next)

- **M1 - Static site. ✅ DONE, live 2026-09-01: https://tstewartproductions-gif.github.io/IAMSIAM-LISTS/ (look approved by Travis).** Repo + GitHub Pages live. Renders both existing lists (Scrufizzer's grime lists, Machinedrum's jungle top 10) from JSON with artwork, details, source badges, and working buy links. No player yet. *This is also the look-iteration phase - Travis reacts to the real page.*
- **M2 - Unified player.** Cloudflare Worker deployed, three adapters, transport bar, embed fallback, expired-stream recovery.
- **M3 - VU meter.** `iamsiam-vu.js` module ported, baker script built, envelopes baked for both existing lists, meter + typing info layer live and synced.
- **M4 - Weekly pipeline.** `/add-list` skill + validator, exercised end to end on a real or dress-rehearsal list.
- **M5 - Launch polish.** Archive + about views, mobile pass, per-track share links if trivial, optional custom domain.

## Play metrics (do plays here count on the source platform?)

- **YouTube: yes.** Official IFrame player = normal embedded views (view count, watch time, monetization all intact).
- **SoundCloud: yes.** Official widget plays register in the track's play count and artist stats.
- **Bandcamp: no in unified-player mode.** Direct mp3-128 playback skips the official player's tracking calls, so listens won't appear in the artist's private dashboard stats. Bandcamp has no public play counts and pays no streaming royalties, so nothing monetary is lost - purchases (which the site drives) are the metric that matters there. Embed-fallback plays do count. Per-track opt-out: flag a track to use the official embed if a curator wants their Bandcamp plays counted.
- The site can add its own lightweight, privacy-friendly play counter post-launch if IAMSIAM wants first-party listen metrics.

## Risks / honest notes

- **Bandcamp resolver is unofficial** (see ToS note above). Fallback path exists and is tested as part of M2.
- **Signed stream URLs expire** - resolved at play time only, never cached in the repo.
- **YouTube requires a visible player** - satisfied by design (video in the now-playing panel).
- **SoundCloud Widget API** is old but stable; no API key needed for embeds/widget.
- **Beatport has no public API** - buy links are resolved at add time by agent search, so there is no runtime dependency on Beatport.

## Repo layout

```
IAMSIAM-LISTS/
  index.html            single-page app (home / archive / about via hash routing)
  css/site.css
  js/app.js             routing + rendering
  js/player.js          unified transport + adapters
  js/iamsiam-vu.js      VU meter + info-layer module (ported from studio tool)
  assets/logo.png       IAMSIAM logo with alpha (meter source)
  lists/*.json          one per week
  index.json            list of all weeks
  env/<date>/*.json     baked VU envelopes
  art/<date>/*.jpg      track artwork
  worker/resolver.js    Cloudflare Worker (Bandcamp stream resolution)
  tools/bake-envelopes.mjs
  tools/validate-lists.mjs
  .claude/skills/add-list/SKILL.md
  DESIGN.md             this document
```
