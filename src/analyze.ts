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
import { DEFAULT_ALLOWED_HOSTS, isAllowedHost } from "./url.js";
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
  /**
   * Honored between playlist entries. Aborting after `fetchEntries` returns
   * does not interrupt an in-flight `fetchInfo` or caption fetch — the current
   * entry runs to completion, then the loop exits. For single-video calls this
   * means `abort()` is effectively a no-op until the call resolves. True
   * per-process cancellation is on the v0.2 roadmap.
   */
  signal?: AbortSignal;
  /** Cap on entries pulled from a playlist. Default 200. Set to 0 to disable. */
  maxEntries?: number;
  /** Parallel yt-dlp invocations. Default 1 (sequential). */
  concurrency?: number;
  /** Forwarded to yt-dlp's --socket-timeout (seconds). Default 30. */
  socketTimeout?: number;
  /** Hostname allowlist. Default: YouTube hosts only. Pass `"any"` to disable validation. */
  allowedHosts?: readonly string[] | "any";
};

const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_CONCURRENCY = 1;
const DEFAULT_SOCKET_TIMEOUT = 30;

export async function analyze(
  url: string,
  options: AnalyzeOptions = {},
): Promise<AnalyzeResult> {
  const subLangs = options.subLangs ?? ["en.*"];
  const allowed = options.allowedHosts ?? DEFAULT_ALLOWED_HOSTS;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const socketTimeout = options.socketTimeout ?? DEFAULT_SOCKET_TIMEOUT;
  const signal = options.signal;

  const bundles: VideoBundle[] = [];
  const errors: AnalyzeError[] = [];
  const raw: Record<string, unknown> = {};

  if (allowed !== "any" && !isAllowedHost(url, allowed)) {
    return {
      bundles,
      raw,
      errors: [
        {
          id: url,
          kind: "playlist",
          reason: `url host not in allowed hosts (allowed: ${allowed.join(", ")}). pass allowedHosts: "any" to bypass.`,
        },
      ],
    };
  }

  if (signal?.aborted) {
    return {
      bundles,
      raw,
      errors: [{ id: url, kind: "playlist", reason: "aborted before start" }],
    };
  }

  let entries: Entry[];
  try {
    entries = await fetchEntries(url, { socketTimeout });
  } catch (err) {
    return {
      bundles,
      raw,
      errors: [
        {
          id: url,
          kind: "playlist",
          reason: `entry enumeration failed: ${describe(err)}`,
        },
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
          kind: "playlist",
          reason: "no playable entries (private, deleted, or invalid URL)",
        },
      ],
    };
  }

  const limited =
    maxEntries > 0 && entries.length > maxEntries
      ? entries.slice(0, maxEntries)
      : entries;
  if (limited.length < entries.length) {
    errors.push({
      id: url,
      kind: "playlist",
      reason: `entry count ${entries.length} exceeded maxEntries ${maxEntries}; processing first ${limited.length}`,
    });
  }

  // Pre-sized slot array preserves playlist order under concurrency > 1
  // (workers complete out-of-order; bundles[i] must still correspond to
  // limited[i] so consumers can join against the original entries list).
  const slots: (VideoBundle | undefined)[] = new Array(limited.length);
  let cursor = 0;
  const workerCount = Math.min(concurrency, limited.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      if (signal?.aborted) return;
      const idx = cursor++;
      if (idx >= limited.length) return;
      const entry = limited[idx]!;
      try {
        const result = await analyzeOne(entry, subLangs, socketTimeout);
        if (!result) {
          errors.push({
            id: entry.id,
            kind: "video",
            reason: "livestream — skipped",
          });
          continue;
        }
        slots[idx] = result.bundle;
        raw[entry.id] = result.rawInfo;
        if (result.transcriptError) {
          errors.push({
            id: entry.id,
            kind: "transcript",
            reason: result.transcriptError,
          });
        }
      } catch (err) {
        errors.push({ id: entry.id, kind: "video", reason: describe(err) });
      }
    }
  });
  await Promise.all(workers);

  for (const b of slots) if (b) bundles.push(b);

  if (signal?.aborted) {
    errors.push({ id: url, kind: "playlist", reason: "aborted mid-run" });
  }

  return { bundles, errors, raw };
}

async function analyzeOne(
  entry: Entry,
  subLangs: string[],
  socketTimeout: number,
): Promise<{
  bundle: VideoBundle;
  rawInfo: VideoInfo;
  transcriptError?: string;
} | null> {
  const info = await fetchInfo(entry.url, { socketTimeout });
  if (info.is_live || info.live_status === "is_live") return null;
  const meta = buildMeta(info);
  const tr = await buildTranscript(entry.url, subLangs, socketTimeout);
  const bundle: VideoBundle = {
    source: { url: entry.url, id: entry.id, platform: "youtube" },
    meta,
    chapters: (info.chapters ?? []).map((c) => ({
      startSec: c.start_time,
      title: c.title,
    })),
    transcript: tr.transcript,
  };
  const parsed = VideoBundleSchema.parse(bundle);
  return tr.error
    ? { bundle: parsed, rawInfo: info, transcriptError: tr.error }
    : { bundle: parsed, rawInfo: info };
}

async function buildTranscript(
  url: string,
  subLangs: string[],
  socketTimeout: number,
): Promise<{ transcript: Transcript | null; error?: string }> {
  const tmp = mkdtempSync(join(tmpdir(), "yt-llm-"));
  try {
    const result = await fetchCaptionsToTemp(url, tmp, subLangs, {
      socketTimeout,
    });
    if (result.kind === "none") return { transcript: null };
    if (result.kind === "error") {
      return {
        transcript: null,
        error: `caption fetch failed: ${result.reason}`,
      };
    }
    const captions = result.file;
    const raw = readFileSync(captions.srtPath, "utf-8");
    const segments = dedupeSegments(parseSrt(raw));
    const paragraphs = toParagraphs(segments, 30);
    const full = segments
      .map((s) => s.text)
      .join(" ")
      .trim();
    return {
      transcript: {
        source: "captions",
        sourceDetail: captions.filename,
        language: captions.language,
        full,
        segments,
        paragraphs,
      },
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
