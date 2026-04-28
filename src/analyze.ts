import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dedupeSegments, parseSrt, toParagraphs } from "./transcript/index.js";
import {
  type AnalyzeError,
  type AnalyzeResult,
  type Transcript,
  type VideoBundle,
  type VideoMeta,
  VideoBundleSchema,
} from "./schema.js";
import {
  fetchCaptionsToTemp,
  fetchEntries,
  fetchInfo,
  type Entry,
  type VideoInfo,
} from "./yt.js";

export type AnalyzeOptions = {
  /** Subtitle language patterns to fetch. Defaults to `['en.*']` to match the Python script. */
  subLangs?: string[];
  /** Reserved for v0.1+: forwards options to yt-dlp's --write-comments. v0.1 only fetches them into raw info. */
  withComments?: boolean;
};

export async function analyze(
  url: string,
  options: AnalyzeOptions = {},
): Promise<AnalyzeResult> {
  const subLangs = options.subLangs ?? ["en.*"];
  const bundles: VideoBundle[] = [];
  const errors: AnalyzeError[] = [];
  const raw: Record<string, unknown> = {};

  let entries: Entry[];
  try {
    entries = await fetchEntries(url);
  } catch (err) {
    return {
      bundles,
      raw,
      errors: [
        { id: url, reason: `entry enumeration failed: ${describe(err)}` },
      ],
    };
  }
  if (entries.length === 0) {
    return {
      bundles,
      raw,
      errors: [
        {
          id: url,
          reason: "no playable entries (private, deleted, or invalid URL)",
        },
      ],
    };
  }

  for (const entry of entries) {
    try {
      const result = await analyzeOne(entry, subLangs);
      if (!result) {
        errors.push({ id: entry.id, reason: "livestream — skipped" });
        continue;
      }
      bundles.push(result.bundle);
      raw[entry.id] = result.rawInfo;
    } catch (err) {
      errors.push({ id: entry.id, reason: describe(err) });
    }
  }

  return { bundles, errors, raw };
}

async function analyzeOne(
  entry: Entry,
  subLangs: string[],
): Promise<{ bundle: VideoBundle; rawInfo: VideoInfo } | null> {
  const info = await fetchInfo(entry.url);
  if (info.is_live || info.live_status === "is_live") return null;
  const meta = buildMeta(info);
  const transcript = await buildTranscript(entry.url, subLangs);
  const bundle: VideoBundle = {
    source: { url: entry.url, id: entry.id, platform: "youtube" },
    meta,
    chapters: (info.chapters ?? []).map((c) => ({
      startSec: c.start_time,
      title: c.title,
    })),
    transcript,
  };
  return { bundle: VideoBundleSchema.parse(bundle), rawInfo: info };
}

async function buildTranscript(
  url: string,
  subLangs: string[],
): Promise<Transcript | null> {
  const tmp = mkdtempSync(join(tmpdir(), "yt-llm-"));
  try {
    const captions = await fetchCaptionsToTemp(url, tmp, subLangs);
    if (!captions) return null;
    const raw = readFileSync(captions.srtPath, "utf-8");
    const segments = dedupeSegments(parseSrt(raw));
    const paragraphs = toParagraphs(segments, 30);
    const full = segments
      .map((s) => s.text)
      .join(" ")
      .trim();
    return {
      source: "captions",
      sourceDetail: captions.filename,
      language: captions.language,
      full,
      segments,
      paragraphs,
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function buildMeta(info: VideoInfo): VideoMeta {
  return {
    title: info.title,
    channel: info.channel ?? info.uploader ?? "",
    channelId: info.channel_id ?? null,
    channelUrl: info.channel_url ?? null,
    uploader: info.uploader ?? null,
    uploadedAt: normalizeUploadDate(info.upload_date),
    durationSec: info.duration ?? 0,
    durationString: info.duration_string ?? null,
    views: info.view_count ?? null,
    likeCount: info.like_count ?? null,
    commentCount: info.comment_count ?? null,
    description: info.description ?? "",
    tags: info.tags ?? [],
    categories: info.categories ?? [],
    thumbnailUrl: info.thumbnail ?? null,
    isLive: Boolean(info.is_live),
    wasLive: Boolean(info.was_live),
    liveStatus: info.live_status ?? null,
    ageLimit: info.age_limit ?? 0,
    availability: info.availability ?? null,
  };
}

/** Convert yt-dlp's "20260427" upload_date string to ISO "2026-04-27". Returns null on failure. */
export function normalizeUploadDate(
  s: string | null | undefined,
): string | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
