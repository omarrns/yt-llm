# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Package manager is **pnpm 10**, Node **>=20** (CI runs Node 22).

- `pnpm install` — installs deps. The `yt-dlp` binary is fetched at install time by `ytdlp-nodejs` (listed in `pnpm.onlyBuiltDependencies`); first install needs network.
- `pnpm test` — vitest run. `pnpm test:watch` for watch mode.
- Single file: `pnpm vitest run test/srt.test.ts`. Filter by name: `pnpm vitest run -t "parses HH:MM"`.
- `pnpm typecheck` — `tsc --noEmit` (strict + `noUncheckedIndexedAccess` + `verbatimModuleSyntax`).
- `pnpm build` — `tsup` produces three ESM entries in `dist/`: `index.js` (lib + .d.ts), `cli.js` (shebanged), `mcp.js` (shebanged).
- `pnpm dev <url>` — `tsx src/cli.ts <url>` for iterating on the CLI without a build.
- CI (`.github/workflows/ci.yml`) runs `typecheck`, `test`, `build` in that order — replicate locally before pushing.

## Architecture

**One core, three surfaces.** The package publishes a programmatic API, a CLI, and an MCP server, but they all funnel through a single `analyze(url, options)` call.

```
src/cli.ts ─┐
src/mcp/server.ts ─┼─► src/analyze.ts ─► src/yt.ts (yt-dlp wrapper)
                   │                  └► src/transcript/* (SRT pipeline)
src/index.ts (lib) ┘
                                       └► src/schema.ts (Zod — source of truth)
```

Add new behavior in `analyze()` or its helpers — the CLI and MCP server are thin shells and should stay that way.

### Schema is the source of truth

All public types (`VideoBundle`, `Transcript`, `VideoMeta`, etc.) are `z.infer` outputs of Zod schemas in `src/schema.ts`. `analyze()` calls `VideoBundleSchema.parse(bundle)` on every bundle before returning it — keep that boundary validation when adding fields. To extend the public shape, change the schema first; the type updates automatically.

### Partial-success contract

`analyze()` is designed for playlists where some entries fail. It **never throws on per-video errors** — bad/private/livestream/captionless entries land in `result.errors: { id, reason }[]`, successful ones in `result.bundles`. The only top-level throw path is when `fetchEntries()` itself fails to enumerate the URL. Don't introduce throws inside the per-entry loop.

Live videos are _not_ an error in `analyzeOne()` — they return `null`, and the caller pushes `"livestream — skipped"` into `errors`.

### `raw` is intentional, not a leak

`AnalyzeResult` exposes a typed `bundles` plus a loosely-typed `raw: Record<string, unknown>` keyed by video id. `raw` holds the unfiltered yt-dlp info object and exists so `writeBundle()` can emit `raw.info.json` for parity with the upstream Python analyst script. Keep it out of the typed bundle — the public surface stays clean, and consumers that don't need it can ignore it.

### Transcript pipeline (`src/transcript/`)

```
SRT file → parseSrt → dedupeSegments → toParagraphs(windowSec=30)
```

- **`parseSrt`**: tolerant of `,`/`.` decimal separators, strips inline cue tags (`<c>`, `<i>`), skips malformed cues silently.
- **`dedupeSegments`**: handles YouTube's rolling-caption overlap by stripping the longest suffix of the previous segment's words from the start of the current one. The greedy longest-match behavior is load-bearing — see `test/dedupe.test.ts`.
- **`toParagraphs`**: greedy windowing — flushes when `endSec - start >= window`. Default 30s.
- **`pickPreferredSrt`**: yt-dlp can emit several variants (`raw.en.srt`, `raw.en-orig.srt`, `raw.en-en.srt`). Prefer plain `raw.<lang>.srt`; otherwise alphabetical first. Language is parsed back out of the filename by `languageFromSrtName`.

### Caption fetch swallows yt-dlp errors on purpose

`fetchCaptionsToTemp` wraps `ytdlp.execAsync` in a `try/catch` and ignores the throw, then inspects the tempdir for `.srt` files. This mirrors the upstream Python's `check=False`: yt-dlp exits non-zero on transient per-language failures (HTTP 429, missing track) but may still have written usable subtitles. If no SRTs landed, the caller treats it as no captions (`transcript: null`), not a hard failure.

### CLI output layout (parity with upstream Python script)

`writeBundle()` writes a fixed five-file layout per video so existing analyst tooling keeps working:

```
<output-dir>/<video-id>/
  raw.info.json              # unfiltered yt-dlp info
  metadata.json              # typed VideoBundle.meta only
  transcript.txt             # full deduped text
  transcript.timestamped.txt # paragraphs, [MM:SS] prefixed
  bundle.md                  # human-readable
```

`--force` wipes the per-video subdirectory before writing. `--json` skips file writes entirely and prints the validated bundle to stdout.

## Conventions to preserve

- **`.js` import suffixes in TS source.** ESM + `moduleResolution: "Bundler"` + `verbatimModuleSyntax`. All internal imports must use the `.js` suffix even though source is `.ts` (e.g. `from "./analyze.js"`). Required for tsup's ESM output and Node's ESM resolution.
- **No `cjs` build, no dual package.** `package.json` is `"type": "module"` and exports ESM only.
- **Node built-ins use the `node:` prefix** (`node:fs`, `node:path`, `node:os`, `node:url`).
- **Tests don't hit the network.** `test/fixtures/<videoId>/` contains pre-captured SRTs and info JSON; tests parse those directly. Don't add tests that shell out to yt-dlp — keep them pure.
- **Per-video subdirectory under `tmpdir()`** is the unit of cleanup for caption fetches; `analyze.ts` uses `mkdtempSync` + `try/finally rmSync` so a partial fetch doesn't leak files.

## v0.1 scope notes

- Captions only. `TranscriptSourceSchema` already includes `whisper`/`deepgram`/`openai` for forwards-compat with the v0.2 pluggable-transcriber roadmap, but only `"captions"` is produced today.
- YouTube only — `VideoSourceSchema.platform` is the literal `"youtube"`.

### Comments (opt-in)

`--with-comments` (CLI) / `withComments: true` (lib) / `withComments: true` (MCP) opts the run into a separate `fetchComments` invocation that runs _after_ metadata + transcript. Tunables: `--max-comments <n>` (default 500) and `--comment-sort <top|new>` (default top). On the MCP surface `maxComments` is hard-capped at 2000 server-side regardless of input.

Failure isolation is load-bearing: a comment-fetch throw (HTTP 429, paginator timeout, geo-blocked thread) is caught in `analyzeOne`, surfaced as `kind: "comments"` in `result.errors[]`, and the bundle still ships with `comments: null`. Don't move comments into the `fetchInfo` path — that would turn a comment-only failure into a dropped bundle.

Bundle semantics: absent `comments` key means "didn't ask"; `comments === null` means "asked but fetch failed" (disambiguate via `result.errors`); `comments === []` means "asked, succeeded, video has none." `comments.json` is written by `writeBundle()` only when `bundle.comments` is an array.
