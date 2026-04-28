import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../src/yt.js", () => ({
  fetchEntries: vi.fn(),
  fetchInfo: vi.fn(),
  fetchCaptionsToTemp: vi.fn(),
}));

import { runCli, parseNonNeg, parsePositive } from "../src/cli.js";
import * as yt from "../src/yt.js";
import type { VideoInfo } from "ytdlp-nodejs";

function videoInfo(overrides: Partial<VideoInfo> = {}): VideoInfo {
  return {
    title: "T",
    channel: "C",
    channel_id: "UCxxx",
    channel_url: "https://youtube.com/@x",
    uploader: "C",
    upload_date: "20260101",
    duration: 60,
    duration_string: "1:00",
    view_count: 1,
    like_count: 0,
    comment_count: 0,
    description: "",
    tags: [],
    categories: [],
    thumbnail: null,
    is_live: false,
    was_live: false,
    live_status: "not_live",
    age_limit: 0,
    availability: "public",
    chapters: [],
    ...overrides,
  } as VideoInfo;
}

beforeEach(() => {
  vi.mocked(yt.fetchEntries).mockReset();
  vi.mocked(yt.fetchInfo).mockReset();
  vi.mocked(yt.fetchCaptionsToTemp).mockReset();
});

describe("parseNonNeg", () => {
  it("accepts 0 (the disable sentinel)", () => {
    expect(parseNonNeg("0")).toBe(0);
  });
  it("accepts positive integers", () => {
    expect(parseNonNeg("42")).toBe(42);
  });
  it("rejects negatives", () => {
    expect(() => parseNonNeg("-1")).toThrow(/non-negative/);
  });
  it("rejects non-numeric input", () => {
    expect(() => parseNonNeg("abc")).toThrow(/non-negative/);
  });
});

describe("parsePositive", () => {
  it("rejects 0 (concurrency=0 is meaningless)", () => {
    expect(() => parsePositive("0")).toThrow(/positive integer/);
  });
  it("accepts 1 and up", () => {
    expect(parsePositive("1")).toBe(1);
    expect(parsePositive("100")).toBe(100);
  });
  it("rejects negatives and non-numeric", () => {
    expect(() => parsePositive("-1")).toThrow(/positive integer/);
    expect(() => parsePositive("xyz")).toThrow(/positive integer/);
  });
});

describe("runCli — --json", () => {
  it("writes the validated bundle to stdout and does not invoke writeBundle", async () => {
    vi.mocked(yt.fetchEntries).mockResolvedValue([
      { id: "vid", url: "https://youtube.com/watch?v=vid" },
    ]);
    vi.mocked(yt.fetchInfo).mockResolvedValue(videoInfo());
    vi.mocked(yt.fetchCaptionsToTemp).mockResolvedValue({ kind: "none" });

    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const code = await runCli("https://youtube.com/watch?v=vid", {
      outputDir: "./irrelevant",
      subLangs: "en.*",
      json: true,
    });
    expect(code).toBe(0);
    const stdoutText = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    const payload = JSON.parse(stdoutText);
    expect(payload.bundles[0].source.id).toBe("vid");
    expect(payload.errors).toEqual([]);

    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});

describe("runCli — file output", () => {
  let outDir: string;
  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), "yt-llm-cli-"));
  });

  it("writes the per-video subdirectory and prints OK to stderr", async () => {
    vi.mocked(yt.fetchEntries).mockResolvedValue([
      { id: "vid", url: "https://youtube.com/watch?v=vid" },
    ]);
    vi.mocked(yt.fetchInfo).mockResolvedValue(videoInfo());
    vi.mocked(yt.fetchCaptionsToTemp).mockResolvedValue({ kind: "none" });

    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const code = await runCli("https://youtube.com/watch?v=vid", {
      outputDir: outDir,
      subLangs: "en.*",
    });
    expect(code).toBe(0);
    expect(existsSync(join(outDir, "vid", "metadata.json"))).toBe(true);
    expect(existsSync(join(outDir, "vid", "raw.info.json"))).toBe(true);
    const stderrText = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(stderrText).toMatch(/OK: vid -> /);

    stderrSpy.mockRestore();
    rmSync(outDir, { recursive: true, force: true });
  });
});

describe("runCli — exit code", () => {
  it("returns 1 when there are no bundles and any errors", async () => {
    vi.mocked(yt.fetchEntries).mockRejectedValue(new Error("bad url"));
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await runCli("https://youtube.com/x", {
      outputDir: "./out",
      subLangs: "en.*",
    });
    expect(code).toBe(1);
  });

  it("returns 0 when there is at least one bundle (even with per-entry errors)", async () => {
    vi.mocked(yt.fetchEntries).mockResolvedValue([
      { id: "ok", url: "https://youtube.com/watch?v=ok" },
      { id: "bad", url: "https://youtube.com/watch?v=bad" },
    ]);
    vi.mocked(yt.fetchInfo).mockImplementation(async (url: string) => {
      if (url.includes("bad")) throw new Error("private");
      return videoInfo();
    });
    vi.mocked(yt.fetchCaptionsToTemp).mockResolvedValue({ kind: "none" });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const code = await runCli("https://youtube.com/playlist?list=p", {
      outputDir: "./irrelevant",
      subLangs: "en.*",
      json: true,
    });
    expect(code).toBe(0);
  });
});
