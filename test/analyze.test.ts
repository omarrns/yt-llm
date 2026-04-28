import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/yt.js", () => ({
  fetchEntries: vi.fn(),
  fetchInfo: vi.fn(),
  fetchCaptionsToTemp: vi.fn(),
}));

import { analyze } from "../src/analyze.js";
import * as yt from "../src/yt.js";
import type { VideoInfo } from "ytdlp-nodejs";

function videoInfo(overrides: Partial<VideoInfo> = {}): VideoInfo {
  return {
    title: "Test Title",
    channel: "Test Channel",
    channel_id: "UCxxx",
    channel_url: "https://youtube.com/@test",
    uploader: "Test Channel",
    upload_date: "20260101",
    duration: 120,
    duration_string: "2:00",
    view_count: 1000,
    like_count: 100,
    comment_count: 10,
    description: "Test description",
    tags: ["tag1"],
    categories: ["Education"],
    thumbnail: "https://i.ytimg.com/x.jpg",
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

describe("analyze — host allowlist", () => {
  it("rejects non-YouTube URLs with a playlist-kind error before any network call", async () => {
    const r = await analyze("https://evil.com/watch?v=x");
    expect(r.bundles).toEqual([]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.kind).toBe("playlist");
    expect(r.errors[0]?.reason).toMatch(/host not in allowed hosts/);
    expect(yt.fetchEntries).not.toHaveBeenCalled();
  });

  it("rejects file:// even though hostname might parse", async () => {
    const r = await analyze("file:///etc/passwd");
    expect(r.bundles).toEqual([]);
    expect(r.errors[0]?.reason).toMatch(/host not in allowed hosts/);
  });

  it('respects allowedHosts: "any" (bypasses validation)', async () => {
    vi.mocked(yt.fetchEntries).mockResolvedValue([]);
    const r = await analyze("https://example.com/x", { allowedHosts: "any" });
    expect(yt.fetchEntries).toHaveBeenCalled();
    expect(r.errors[0]?.reason).toMatch(/no playable entries/);
  });

  it("respects a custom allowedHosts list", async () => {
    vi.mocked(yt.fetchEntries).mockResolvedValue([]);
    const r = await analyze("https://example.com/x", {
      allowedHosts: ["example.com"],
    });
    expect(yt.fetchEntries).toHaveBeenCalled();
    expect(r.errors[0]?.reason).toMatch(/no playable entries/);
  });
});

describe("analyze — error branches", () => {
  it("surfaces fetchEntries failure as a kind:playlist error", async () => {
    vi.mocked(yt.fetchEntries).mockRejectedValue(new Error("network down"));
    const r = await analyze("https://youtube.com/playlist?list=xx");
    expect(r.bundles).toEqual([]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.kind).toBe("playlist");
    expect(r.errors[0]?.reason).toMatch(/network down/);
  });

  it("returns kind:playlist when fetchEntries returns []", async () => {
    vi.mocked(yt.fetchEntries).mockResolvedValue([]);
    const r = await analyze("https://youtube.com/watch?v=x");
    expect(r.errors[0]?.kind).toBe("playlist");
    expect(r.errors[0]?.reason).toMatch(/no playable entries/);
  });

  it("returns kind:video reason 'livestream — skipped' when info.is_live is true", async () => {
    vi.mocked(yt.fetchEntries).mockResolvedValue([
      { id: "live1", url: "https://youtube.com/watch?v=live1" },
    ]);
    vi.mocked(yt.fetchInfo).mockResolvedValue(videoInfo({ is_live: true }));
    const r = await analyze("https://youtube.com/watch?v=live1");
    expect(r.bundles).toEqual([]);
    expect(r.errors[0]?.kind).toBe("video");
    expect(r.errors[0]?.reason).toMatch(/livestream/);
  });

  it("treats live_status: 'is_live' as a livestream", async () => {
    vi.mocked(yt.fetchEntries).mockResolvedValue([
      { id: "live2", url: "https://youtube.com/watch?v=live2" },
    ]);
    vi.mocked(yt.fetchInfo).mockResolvedValue(
      videoInfo({ live_status: "is_live" }),
    );
    const r = await analyze("https://youtube.com/watch?v=live2");
    expect(r.errors[0]?.reason).toMatch(/livestream/);
  });

  it("captures fetchInfo throw as a kind:video error and continues to next entry", async () => {
    vi.mocked(yt.fetchEntries).mockResolvedValue([
      { id: "good", url: "https://youtube.com/watch?v=good" },
      { id: "bad", url: "https://youtube.com/watch?v=bad" },
    ]);
    vi.mocked(yt.fetchInfo).mockImplementation(async (url: string) => {
      if (url.includes("bad")) throw new Error("video unavailable");
      return videoInfo();
    });
    vi.mocked(yt.fetchCaptionsToTemp).mockResolvedValue({ kind: "none" });

    const r = await analyze("https://youtube.com/playlist?list=mix");
    expect(r.bundles).toHaveLength(1);
    expect(r.bundles[0]?.source.id).toBe("good");
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.kind).toBe("video");
    expect(r.errors[0]?.id).toBe("bad");
    expect(r.errors[0]?.reason).toMatch(/video unavailable/);
  });
});

describe("analyze — captions outcomes", () => {
  beforeEach(() => {
    vi.mocked(yt.fetchEntries).mockResolvedValue([
      { id: "vid", url: "https://youtube.com/watch?v=vid" },
    ]);
    vi.mocked(yt.fetchInfo).mockResolvedValue(videoInfo());
  });

  it("transcript: null when fetchCaptionsToTemp returns kind:none (no error pushed)", async () => {
    vi.mocked(yt.fetchCaptionsToTemp).mockResolvedValue({ kind: "none" });
    const r = await analyze("https://youtube.com/watch?v=vid");
    expect(r.bundles).toHaveLength(1);
    expect(r.bundles[0]?.transcript).toBeNull();
    expect(r.errors).toEqual([]);
  });

  it("transcript: null AND a kind:transcript error when caption fetch hard-fails", async () => {
    vi.mocked(yt.fetchCaptionsToTemp).mockResolvedValue({
      kind: "error",
      reason: "HTTP 429: rate limited",
    });
    const r = await analyze("https://youtube.com/watch?v=vid");
    expect(r.bundles).toHaveLength(1);
    expect(r.bundles[0]?.transcript).toBeNull();
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.kind).toBe("transcript");
    expect(r.errors[0]?.id).toBe("vid");
    expect(r.errors[0]?.reason).toMatch(/HTTP 429/);
  });
});

describe("analyze — playlist controls", () => {
  it("respects maxEntries and surfaces a kind:playlist note about the cap", async () => {
    const big = Array.from({ length: 50 }, (_, i) => ({
      id: `v${i}`,
      url: `https://youtube.com/watch?v=v${i}`,
    }));
    vi.mocked(yt.fetchEntries).mockResolvedValue(big);
    vi.mocked(yt.fetchInfo).mockResolvedValue(videoInfo());
    vi.mocked(yt.fetchCaptionsToTemp).mockResolvedValue({ kind: "none" });

    const r = await analyze("https://youtube.com/playlist?list=big", {
      maxEntries: 5,
    });
    expect(r.bundles).toHaveLength(5);
    const cap = r.errors.find((e) => /exceeded maxEntries/.test(e.reason));
    expect(cap).toBeDefined();
    expect(cap?.kind).toBe("playlist");
  });

  it("honors AbortSignal.aborted at start", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await analyze("https://youtube.com/watch?v=x", {
      signal: ctrl.signal,
    });
    expect(r.errors[0]?.reason).toMatch(/aborted before start/);
    expect(yt.fetchEntries).not.toHaveBeenCalled();
  });

  it("processes entries in parallel when concurrency > 1", async () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({
      id: `v${i}`,
      url: `https://youtube.com/watch?v=v${i}`,
    }));
    vi.mocked(yt.fetchEntries).mockResolvedValue(entries);
    let inFlight = 0;
    let maxInFlight = 0;
    vi.mocked(yt.fetchInfo).mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return videoInfo();
    });
    vi.mocked(yt.fetchCaptionsToTemp).mockResolvedValue({ kind: "none" });

    const r = await analyze("https://youtube.com/playlist?list=p", {
      concurrency: 4,
    });
    expect(r.bundles).toHaveLength(10);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });
});

describe("analyze — happy path", () => {
  it("returns a parsed bundle with raw populated", async () => {
    const info = videoInfo({ chapters: [{ start_time: 0, title: "Intro" }] });
    vi.mocked(yt.fetchEntries).mockResolvedValue([
      { id: "vid", url: "https://youtube.com/watch?v=vid" },
    ]);
    vi.mocked(yt.fetchInfo).mockResolvedValue(info);
    vi.mocked(yt.fetchCaptionsToTemp).mockResolvedValue({ kind: "none" });

    const r = await analyze("https://youtube.com/watch?v=vid");
    expect(r.bundles).toHaveLength(1);
    expect(r.bundles[0]?.source).toEqual({
      url: "https://youtube.com/watch?v=vid",
      id: "vid",
      platform: "youtube",
    });
    expect(r.bundles[0]?.meta.title).toBe("Test Title");
    expect(r.bundles[0]?.chapters).toEqual([{ startSec: 0, title: "Intro" }]);
    expect(r.raw["vid"]).toBe(info);
  });
});
