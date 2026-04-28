# yt-llm

**YouTube → typed `VideoBundle`. One install, three surfaces.**

A small TypeScript package that turns a YouTube URL into a validated, LLM-ready `VideoBundle` — metadata, chapters, deduped captions, paragraph-reflowed transcript — in one call. Built on [`ytdlp-nodejs`](https://www.npmjs.com/package/ytdlp-nodejs).

- **Programmatic API** — `analyze(url)` returns a Zod-validated bundle.
- **CLI** — `yt-llm <url>` writes the same on-disk bundle layout the analyst tooling expects.
- **MCP server** — `yt-llm-mcp` exposes the same call as a Model Context Protocol tool, ready for Claude Desktop / Cursor / any MCP client.

v0.1 is captions-only (no compile-time native deps; the `yt-dlp` binary is fetched at install time). Whisper / Deepgram / keyframes are on the roadmap.

## Install

```bash
pnpm add yt-llm
# or
npm i yt-llm
```

## Programmatic API

```ts
import { analyze } from "yt-llm";

const result = await analyze("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

for (const bundle of result.bundles) {
  console.log(bundle.meta.title);
  console.log(bundle.transcript?.full?.slice(0, 200));
}

for (const err of result.errors) {
  console.warn(`${err.id}: ${err.reason}`);
}
```

`analyze()` accepts both single videos and playlists. Failures (private, deleted, livestreams) land in `errors` instead of throwing — partial success matters when you hand it a 50-video playlist.

### `VideoBundle` shape

```ts
type VideoBundle = {
  source: { url: string; id: string; platform: "youtube" };
  meta: {
    title: string;
    channel: string;
    channelId: string | null;
    channelUrl: string | null;
    uploader: string | null;
    uploadedAt: string | null; // ISO date
    durationSec: number;
    durationString: string | null;
    views: number | null;
    likeCount: number | null;
    commentCount: number | null;
    description: string;
    tags: string[];
    categories: string[];
    thumbnailUrl: string | null;
    isLive: boolean;
    wasLive: boolean;
    liveStatus: string | null;
    ageLimit: number;
    availability: string | null;
  };
  chapters: { startSec: number; title: string }[];
  transcript: {
    source: "captions" | "whisper" | "deepgram" | "openai";
    sourceDetail: string | null;
    language: string;
    full: string; // full transcript text, deduped
    segments: { startSec: number; endSec: number; text: string }[];
    paragraphs: { startSec: number; text: string }[]; // reflowed ~30s windows
  } | null; // null when no captions are available
};
```

The schema is exported as `VideoBundleSchema` (Zod) — `parse()` it at boundaries to validate cached or persisted bundles.

## AI SDK example (the wedge)

The bundle is _designed_ to be the input to a typed LLM call. Drop `bundle.transcript.full` plus `bundle.chapters` into `generateObject` and you get back a structured analysis with deep-link timestamps:

```ts
import { analyze } from "yt-llm";
import { generateText, Output } from "ai";
import { z } from "zod";

const { bundles } = await analyze("https://youtu.be/...");
const bundle = bundles[0];
if (!bundle?.transcript) throw new Error("no captions");

const { output } = await generateText({
  model: "anthropic/claude-opus-4.7",
  output: Output.object({
    schema: z.object({
      tldr: z.string(),
      keyClaims: z.array(z.object({ claim: z.string(), atSec: z.number() })),
      hooks: z.array(z.string()),
    }),
  }),
  prompt: [
    `Title: ${bundle.meta.title}`,
    `Channel: ${bundle.meta.channel}`,
    `Chapters: ${JSON.stringify(bundle.chapters)}`,
    "",
    "Transcript:",
    bundle.transcript.full,
  ].join("\n"),
});
```

Because timestamps are numeric seconds (not `00:01:23` strings), the model can return them and your code can pipe them into a YouTube deep link without parsing.

## CLI

```
yt-llm <url> [options]

Options:
  --output-dir <path>    output directory (default: "./output")
  --force                wipe the per-video output directory before writing
  --with-comments        include yt-dlp comments in the underlying fetch
  --sub-langs <langs>    comma-separated yt-dlp subtitle language patterns (default: "en.*")
  --json                 print the validated VideoBundle JSON to stdout
```

By default, writes the same five-file layout the upstream Python script uses, so existing analyst tooling keeps working:

```
<output-dir>/<video-id>/
  raw.info.json              # full unfiltered yt-dlp metadata
  metadata.json              # the typed VideoBundle.meta subset
  transcript.txt
  transcript.timestamped.txt
  bundle.md
```

With `--json`, prints the validated bundle to stdout — pipeable into `jq` or another tool.

## MCP server

Expose `analyze()` as a Model Context Protocol tool. One line in any MCP-aware client (Claude Desktop, Cursor, Claude Code, etc.):

```bash
claude mcp add yt-llm -- npx -y yt-llm-mcp
```

The `-y` flag suppresses npx's first-run install prompt, keeping the MCP startup non-interactive.

The server registers a single tool:

| Field     | Value                                                            |
| --------- | ---------------------------------------------------------------- |
| Tool name | `analyze_youtube_video`                                          |
| Input     | `{ url: string, subLangs?: string[] }`                           |
| Output    | `{ bundles: VideoBundle[], errors: { id, reason }[] }` (as text) |

## What's not in v0.1

- No Whisper / Deepgram / OpenAI transcription. If a video has no captions, `transcript` is `null` (not a crash). The transcript schema's `source` union is widened for forwards-compat.
- No keyframe extraction.
- No comments expansion beyond the underlying yt-dlp fetch.
- YouTube only (`source.platform` is the literal `'youtube'`).

## Roadmap

- v0.2: pluggable transcribers (`Transcriber` interface — captions / whisper-local / OpenAI / Deepgram), keyframe extraction for multimodal LLM use.
- v0.3: non-YouTube platforms via the same `analyze()` surface.
- v0.4: optional hosted endpoint for "send a URL, get a bundle" without running yt-dlp yourself.

## License

MIT
