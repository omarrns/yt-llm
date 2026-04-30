---
name: analyze-meetings
description: Analyzes YouTube meeting/call/podcast recordings using the local yt-llm tool. Pulls transcripts in parallel, then produces a meeting report — decisions, action items, key topics with timestamps, open questions, notable quotes. Use when the user pastes 2+ YouTube URLs in a single message, OR a single YouTube URL with explicit meeting framing ("meeting", "call", "interview", "all-hands", "podcast", "town hall", "standup", "1:1", "fireside", "panel", "recap"). Trigger phrases — "analyze these meetings", "summarize this call", "recap this", "what did we decide", "action items from this".
---

# Analyze YouTube Meetings (yt-llm)

You analyze YouTube meeting recordings using **[yt-llm](https://github.com/omarrns/yt-llm)** — a tool that wraps `yt-dlp` into a Zod-validated `VideoBundle` (transcript, metadata, chapters).

## When to use this skill

- **2+ YouTube URLs in one message** → batch meeting analysis.
- **1 URL + meeting framing** ("call", "meeting", "podcast", "all-hands", etc.) → single meeting analysis.
- **1 URL, content/marketing intent** → don't use this skill; produce a generic content summary instead.

Strong signals to prefer this skill: the user said "decisions", "action items", "what did we agree", "recap", "sync", "standup", "fireside".

## Step 1: Extract URLs

Match these in the user's message:

- `https://www.youtube.com/watch?v=<ID>`
- `https://youtu.be/<ID>`
- `https://www.youtube.com/shorts/<ID>`
- `https://m.youtube.com/...`
- `https://www.youtube.com/playlist?list=<ID>` (yt-llm fans this out — each entry becomes a meeting)

If none, ask the user to paste at least one.

## Step 2: Run yt-llm in parallel

Default invocation — one Bash call per URL, all in a single message so they run in parallel:

```bash
npx -y yt-llm "<URL>" --json
```

The `-y` flag suppresses npx's first-run install prompt. After the first invocation, `npx` caches yt-llm so subsequent calls are fast.

Each call prints `{ "bundles": [...], "errors": [...] }` to stdout. Parse it. `bundles` is a typed `VideoBundle[]` (one per video, several for playlists). `errors` lists per-entry failures (livestream, private, no captions) — surface those, continue with the successes.

**Long-meeting tip.** For very long videos (>2hr), the `--json` payload can be huge. If stdout exceeds ~200KB, switch that URL to file mode:

```bash
npx -y yt-llm "<URL>" --output-dir /tmp/yt-llm-meetings
```

Then read `/tmp/yt-llm-meetings/<video-id>/transcript.timestamped.txt` directly and dispatch a parallel `Agent` per ~20-min slice for digestion.

**Captions only.** v0.1 of yt-llm uses YouTube captions — no Whisper fallback yet. Videos without captions show up in `errors` with a "no captions" reason; surface those and skip.

## Step 3: Synthesize

For each meeting, produce this section:

```
## {{ title }}
{{ channel }} • {{ duration_string }} • {{ upload_date }}
{{ webpage_url }}

### TL;DR
{{ 2–3 sentences — what the meeting covered, who participated, what got decided }}

### Decisions
- [mm:ss] {{ specific resolution + brief rationale if stated }}
- ... (or "none stated")

### Action items
- [mm:ss] {{ owner if named, else "unassigned" }} — {{ action }}
- ... (or "none stated")

### Key topics
- [mm:ss–mm:ss] {{ topic }} — {{ one-line description }}
- ...

### Open questions
- [mm:ss] {{ question raised but not resolved }}
- ... (or "none")

### Notable quotes
- [mm:ss] "{{ verbatim from transcript — attribute if speaker is identifiable in-context }}"
- ... (2–4)
```

After all per-meeting sections, if 2+ meetings were processed, add:

```
## Cross-meeting synthesis

### Recurring topics
- {{ topic }} — meeting 1 [mm:ss], meeting 2 [mm:ss], ...

### Decision threads
- {{ how a decision evolved (or got walked back) across meetings }}

### Open loops
- {{ items raised earlier still unresolved later }}
```

## Principles

- **Cite [mm:ss] on every decision, action item, and quote.** A meeting report without timestamps is unverifiable.
- **Quote verbatim** in "Notable quotes" — pull from the transcript's `paragraphs` (when reading the JSON bundle) or `transcript.timestamped.txt` (when reading file output). Don't paraphrase.
- **YouTube captions don't carry speaker labels.** Don't invent attributions. Use a name only if the transcript contains it explicitly (e.g. "Alex: yeah, I think...").
- **Decisions vs. topics.** A decision is a _resolution_ ("we're going with $99/mo"). A topic is what was discussed ("we talked about pricing"). Don't conflate.
- **Action items must be explicit.** Don't infer "someone should probably do X" — only list things actually said as commitments.
- **No CTAs / hooks / clickbait analysis** — meetings don't have those. If you find yourself reaching for marketing-style framing, you've picked the wrong skill for this URL.

## Edge cases

- **Livestream / private / deleted** — yt-llm returns it in `errors`. Skip with a one-line note.
- **No captions** — v0.1 of yt-llm is captions-only. Surface the `errors` entry and stop for that URL. (Whisper fallback is on the roadmap.)
- **Non-English captions** — yt-llm parses them fine. Report transcript as-is and note the language in TL;DR.
- **Music / lyrics / no speech** — skip the meeting sections, tell the user this URL doesn't look like a meeting.
- **Partial batch failure** — produce reports for the successes; end with a `## Skipped` list naming each URL and the reason from `errors`.

## Tool reference

- npm package: [`yt-llm`](https://www.npmjs.com/package/yt-llm)
- Repo: [github.com/omarrns/yt-llm](https://github.com/omarrns/yt-llm)
- CLI flags: `--json` (stdout), `--output-dir <path>` (files), `--sub-langs <patterns>`, `--max-entries <n>`, `--concurrency <n>`. Run `npx yt-llm --help` for the full list.
- File layout when not using `--json`: `<output-dir>/<video-id>/{raw.info.json, metadata.json, transcript.txt, transcript.timestamped.txt, bundle.md}`.
- `VideoBundle` schema: see [`src/schema.ts`](https://github.com/omarrns/yt-llm/blob/main/src/schema.ts) — that's the shape of each entry in `bundles`.
