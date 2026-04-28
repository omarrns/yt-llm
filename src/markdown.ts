import type { VideoBundle } from "./schema.js";

export function formatTimestamp(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${pad2(m)}:${pad2(s)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function renderBundleMarkdown(bundle: VideoBundle): string {
  const { meta, source, chapters, transcript } = bundle;
  const lines: string[] = [];
  lines.push(`# ${meta.title || "Untitled"}`);
  lines.push("");
  lines.push(`**Channel:** ${meta.channel || meta.uploader || "?"}`);
  const uploaded = meta.uploadedAt || "?";
  const duration = meta.durationString || String(meta.durationSec || "?");
  const views = meta.views ?? "?";
  lines.push(
    `**Uploaded:** ${uploaded}  •  **Duration:** ${duration}  •  **Views:** ${views}`,
  );
  lines.push(`**URL:** ${source.url}`);
  if (transcript) {
    const detail = transcript.sourceDetail
      ? ` (${transcript.sourceDetail})`
      : "";
    lines.push(
      `**Transcript source:** ${labelFor(transcript.source)}${detail}`,
    );
  } else {
    lines.push(`**Transcript source:** none`);
  }
  if (meta.tags.length > 0) {
    lines.push(`**Tags:** ${meta.tags.slice(0, 20).join(", ")}`);
  }
  lines.push("");
  if (meta.description.trim()) {
    lines.push("## Description", "", meta.description.trim(), "");
  }
  if (chapters.length > 0) {
    lines.push("## Chapters", "");
    for (const c of chapters) {
      lines.push(`- [${formatTimestamp(c.startSec)}] ${c.title}`);
    }
    lines.push("");
  }
  lines.push("## Transcript", "");
  if (transcript) {
    for (const p of transcript.paragraphs) {
      lines.push(`[${formatTimestamp(p.startSec)}] ${p.text}\n`);
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
