import type { VideoBundle } from "./schema.js";

const NEWLINE_RE = /[\r\n]+/g;

export function formatTimestamp(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${pad2(m)}:${pad2(s)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Collapse newlines and trim. Used for fields rendered on a single Markdown line
 * (title, channel, tags, chapter titles) so a creator-controlled `\n##` can't
 * inject a fake heading into the output.
 */
function oneLine(s: string): string {
  return s.replace(NEWLINE_RE, " ").trim();
}

/**
 * `oneLine` plus backslash-escape of the four characters that compose a
 * Markdown inline link: `[` `]` `(` `)`. Apply to any creator-controlled field
 * rendered as bare Markdown text so a chapter title like `[click](evil)` can't
 * become a clickable link in an HTML preview of `bundle.md`.
 */
function mdEscape(s: string): string {
  return oneLine(s).replace(/[\[\]()]/g, "\\$&");
}

export function renderBundleMarkdown(bundle: VideoBundle): string {
  const { meta, source, chapters, transcript } = bundle;
  const lines: string[] = [];
  lines.push(`# ${mdEscape(meta.title) || "Untitled"}`);
  lines.push("");
  lines.push(`**Channel:** ${mdEscape(meta.channel || meta.uploader || "?")}`);
  const uploaded = meta.uploadedAt || "?";
  const duration = meta.durationString || String(meta.durationSec || "?");
  const views = meta.views ?? "?";
  lines.push(
    `**Uploaded:** ${uploaded}  •  **Duration:** ${duration}  •  **Views:** ${views}`,
  );
  lines.push(`**URL:** ${mdEscape(source.url)}`);
  if (transcript) {
    const detail = transcript.sourceDetail
      ? ` (${oneLine(transcript.sourceDetail)})`
      : "";
    lines.push(
      `**Transcript source:** ${labelFor(transcript.source)}${detail}`,
    );
  } else {
    lines.push(`**Transcript source:** none`);
  }
  if (meta.tags.length > 0) {
    lines.push(`**Tags:** ${meta.tags.slice(0, 20).map(mdEscape).join(", ")}`);
  }
  lines.push("");
  if (meta.description.trim()) {
    // Render description inside a tilde-fenced code block so creator-controlled
    // markdown (headers, lists, tables, links) renders as literal text. Tilde
    // fences sidestep collisions with backticks in the body. A description
    // containing "~~~" on its own line could close our fence early — prefix
    // any such line with a zero-width space so it can't.
    lines.push("## Description", "");
    lines.push("~~~");
    for (const ln of meta.description.replace(/\r/g, "").split("\n")) {
      lines.push(/^~{3,}$/.test(ln.trim()) ? `​${ln}` : ln);
    }
    lines.push("~~~");
    lines.push("");
  }
  if (chapters.length > 0) {
    lines.push("## Chapters", "");
    for (const c of chapters) {
      lines.push(`- [${formatTimestamp(c.startSec)}] ${mdEscape(c.title)}`);
    }
    lines.push("");
  }
  lines.push("## Transcript", "");
  if (transcript) {
    for (const p of transcript.paragraphs) {
      lines.push(`[${formatTimestamp(p.startSec)}] ${mdEscape(p.text)}\n`);
    }
  } else {
    lines.push("_No captions available._");
  }
  return lines.join("\n");
}

function labelFor(source: string): string {
  switch (source) {
    case "captions":
      return "yt-dlp captions";
    case "whisper":
      return "faster-whisper";
    case "deepgram":
      return "deepgram";
    case "openai":
      return "openai-whisper";
    default:
      return source;
  }
}
