export { parseSrt, parseSrtTime } from "./srt.js";
export { dedupeSegments } from "./dedupe.js";
export { toParagraphs } from "./paragraphs.js";

const PLAIN_EN_RE = /^raw\.en\.srt$/;

export function pickPreferredSrt(filenames: string[]): string | null {
  if (filenames.length === 0) return null;
  const sorted = [...filenames].sort();
  const plainEn = sorted.find((f) => PLAIN_EN_RE.test(basename(f)));
  if (plainEn) return plainEn;
  return sorted[0] ?? null;
}

function basename(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx === -1 ? p : p.slice(idx + 1);
}

export function languageFromSrtName(filename: string): string {
  const name = basename(filename);
  const m = name.match(/^raw\.([^.]+)\.srt$/);
  return m?.[1] ?? "unknown";
}
