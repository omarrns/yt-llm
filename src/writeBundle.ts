import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { renderBundleMarkdown, formatTimestamp } from "./markdown.js";
import type { VideoBundle } from "./schema.js";

export type WriteBundleOptions = {
  /** Parent directory; the per-video subdirectory is `<outputDir>/<bundle.source.id>`. */
  outputDir: string;
  /** Optional unfiltered yt-dlp info object — when provided, written as `raw.info.json` for parity with the Python script. */
  rawInfo?: unknown;
  /** If true, wipe the per-video output directory before writing (parity with the Python `--force` flag). */
  force?: boolean;
};

export type WriteBundleResult = {
  outputDir: string;
  files: string[];
};

export function writeBundle(
  bundle: VideoBundle,
  options: WriteBundleOptions,
): WriteBundleResult {
  const dir = join(options.outputDir, bundle.source.id);
  // Defense in depth against path traversal — VideoSourceSchema already
  // restricts id to [A-Za-z0-9_-], but library users who hand-build a
  // bundle without parse() shouldn't be able to escape outputDir either.
  // With force:true the next line is rmSync, so a bad id deletes outside.
  const rel = relative(resolve(options.outputDir), resolve(dir));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(
      `bundle.source.id escapes outputDir: ${JSON.stringify(bundle.source.id)}`,
    );
  }
  if (options.force) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const files: string[] = [];

  if (options.rawInfo !== undefined) {
    const p = join(dir, "raw.info.json");
    writeFileSync(p, JSON.stringify(options.rawInfo, null, 2));
    files.push(p);
  }

  const metaPath = join(dir, "metadata.json");
  writeFileSync(metaPath, JSON.stringify(bundle.meta, null, 2));
  files.push(metaPath);

  const transcript = bundle.transcript;
  if (transcript) {
    const transcriptPath = join(dir, "transcript.txt");
    writeFileSync(transcriptPath, transcript.full);
    files.push(transcriptPath);

    const stampedPath = join(dir, "transcript.timestamped.txt");
    const stamped = transcript.paragraphs
      .map((p) => `[${formatTimestamp(p.startSec)}] ${p.text}`)
      .join("\n\n");
    writeFileSync(stampedPath, stamped);
    files.push(stampedPath);
  }

  const mdPath = join(dir, "bundle.md");
  writeFileSync(mdPath, renderBundleMarkdown(bundle));
  files.push(mdPath);

  return { outputDir: dir, files };
}
