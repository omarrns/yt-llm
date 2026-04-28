import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  YtDlp,
  type ExecBuilderResult,
  type PlaylistInfo,
  type VideoInfo,
} from "ytdlp-nodejs";
import { languageFromSrtName, pickPreferredSrt } from "./transcript/index.js";

const ytdlp = new YtDlp();

export type Entry = { url: string; id: string };

export async function fetchEntries(url: string): Promise<Entry[]> {
  const result = (await ytdlp.execAsync(url, {
    flatPlaylist: true,
    skipDownload: true,
    noWarnings: true,
    print: "%(id)s\t%(webpage_url)s",
  })) as ExecBuilderResult;
  const entries: Entry[] = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.includes("\t")) continue;
    const idx = trimmed.indexOf("\t");
    const id = trimmed.slice(0, idx).trim();
    const vurl = trimmed.slice(idx + 1).trim();
    if (id && vurl) entries.push({ id, url: vurl });
  }
  return entries;
}

export async function fetchInfo(url: string): Promise<VideoInfo> {
  const info = await ytdlp.getInfoAsync<"video">(url, { flatPlaylist: false });
  return info as VideoInfo;
}

export type CaptionsFile = {
  srtPath: string;
  language: string;
  filename: string;
};

export async function fetchCaptionsToTemp(
  url: string,
  tempDir: string,
  subLangs: string[],
): Promise<CaptionsFile | null> {
  // Subtitle fetches can fail per-language (HTTP 429, missing track, etc.) without
  // meaning "no captions" — yt-dlp exits non-zero but may still have written some files.
  // Match the Python script's `check=False` behavior: swallow the error and inspect the
  // tempdir afterwards. If no SRTs landed, the caller treats it as no captions available.
  try {
    await ytdlp.execAsync(url, {
      skipDownload: true,
      noPlaylist: true,
      writeSubs: true,
      writeAutoSubs: true,
      subLangs,
      subFormat: "srt/vtt/best",
      convertSubs: "srt",
      noWarnings: true,
      output: join(tempDir, "raw.%(ext)s"),
    });
  } catch {
    // intentionally suppressed — fall through to file glob
  }
  const srts = readdirSync(tempDir)
    .filter((f) => f.endsWith(".srt"))
    .map((f) => join(tempDir, f));
  const chosen = pickPreferredSrt(srts);
  if (!chosen) return null;
  return {
    srtPath: chosen,
    language: languageFromSrtName(chosen),
    filename: chosen.slice(chosen.lastIndexOf("/") + 1),
  };
}

export type { PlaylistInfo, VideoInfo };
