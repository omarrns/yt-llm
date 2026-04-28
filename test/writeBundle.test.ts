import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeBundle } from "../src/writeBundle.js";
import type { VideoBundle } from "../src/schema.js";

function makeBundle(): VideoBundle {
  return {
    source: { url: "https://youtu.be/abc", id: "abc", platform: "youtube" },
    meta: {
      title: "Example",
      channel: "Chan",
      channelId: null,
      channelUrl: null,
      uploader: null,
      uploadedAt: "2026-01-01",
      durationSec: 60,
      durationString: "1:00",
      views: 100,
      likeCount: null,
      commentCount: null,
      description: "Hello",
      tags: ["a", "b"],
      categories: [],
      thumbnailUrl: null,
      isLive: false,
      wasLive: false,
      liveStatus: null,
      ageLimit: 0,
      availability: null,
    },
    chapters: [{ startSec: 0, title: "Start" }],
    transcript: {
      source: "captions",
      sourceDetail: "raw.en.srt",
      language: "en",
      full: "hello world",
      segments: [{ startSec: 0, endSec: 1, text: "hello world" }],
      paragraphs: [{ startSec: 0, text: "hello world" }],
    },
  };
}

let outDir: string;

beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), "yt-llm-test-"));
});

afterEach(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe("writeBundle", () => {
  it("writes the five-file layout when transcript is present and rawInfo is given", () => {
    const bundle = makeBundle();
    const result = writeBundle(bundle, {
      outputDir: outDir,
      rawInfo: { id: "abc", whatever: 1 },
    });
    const dir = join(outDir, "abc");
    expect(result.outputDir).toBe(dir);
    expect(existsSync(join(dir, "raw.info.json"))).toBe(true);
    expect(existsSync(join(dir, "metadata.json"))).toBe(true);
    expect(existsSync(join(dir, "transcript.txt"))).toBe(true);
    expect(existsSync(join(dir, "transcript.timestamped.txt"))).toBe(true);
    expect(existsSync(join(dir, "bundle.md"))).toBe(true);
    expect(result.files).toHaveLength(5);
  });

  it("omits transcript files when transcript is null", () => {
    const bundle = makeBundle();
    bundle.transcript = null;
    writeBundle(bundle, { outputDir: outDir });
    const dir = join(outDir, "abc");
    expect(existsSync(join(dir, "transcript.txt"))).toBe(false);
    expect(existsSync(join(dir, "transcript.timestamped.txt"))).toBe(false);
    expect(existsSync(join(dir, "metadata.json"))).toBe(true);
    expect(existsSync(join(dir, "bundle.md"))).toBe(true);
  });

  it("omits raw.info.json when rawInfo is not provided", () => {
    const bundle = makeBundle();
    writeBundle(bundle, { outputDir: outDir });
    expect(existsSync(join(outDir, "abc", "raw.info.json"))).toBe(false);
  });

  it("--force wipes the per-video subdirectory before writing", () => {
    const bundle = makeBundle();
    writeBundle(bundle, { outputDir: outDir, rawInfo: { a: 1 } });
    const stalePath = join(outDir, "abc", "stale.txt");
    require("node:fs").writeFileSync(stalePath, "old");
    expect(existsSync(stalePath)).toBe(true);

    writeBundle(bundle, { outputDir: outDir, force: true });
    expect(existsSync(stalePath)).toBe(false);
    expect(existsSync(join(outDir, "abc", "metadata.json"))).toBe(true);
  });

  it("metadata.json contains exactly the typed VideoMeta", () => {
    const bundle = makeBundle();
    writeBundle(bundle, { outputDir: outDir });
    const metaJson = JSON.parse(
      readFileSync(join(outDir, "abc", "metadata.json"), "utf-8"),
    );
    expect(metaJson).toEqual(bundle.meta);
  });

  it("rejects a bundle whose source.id would escape outputDir (path traversal)", () => {
    const bundle = makeBundle();
    // Bypass the schema regex by casting — simulates a hand-built bundle
    // skipping VideoBundleSchema.parse(). Without the resolve-check this
    // would write into outDir's parent.
    (bundle.source as { id: string }).id = "../../../tmp/yt-llm-pwn";
    expect(() => writeBundle(bundle, { outputDir: outDir })).toThrow(
      /escapes outputDir/,
    );
    // Also confirm nothing was written outside outDir.
    expect(
      existsSync(join(outDir, "..", "..", "..", "tmp", "yt-llm-pwn")),
    ).toBe(false);
  });
});
