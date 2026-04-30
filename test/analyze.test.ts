import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/yt.js", () => ({
  fetchEntries: vi.fn(),
  fetchInfo: vi.fn(),
  fetchCaptionsToTemp: vi.fn(),
  fetchComments: vi.fn(),
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
  vi.mocked(yt.fetchComments).mockReset();
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

  it("preserves playlist order in bundles even when workers complete out-of-order", async () => {
    const entries = Array.from({ length: 8 }, (_, i) => ({
      id: `v${i}`,
      url: `https://youtube.com/watch?v=v${i}`,
    }));
    vi.mocked(yt.fetchEntries).mockResolvedValue(entries);
    // Force completion in reverse order: later entries finish first.
    vi.mocked(yt.fetchInfo).mockImplementation(async (url: string) => {
      const m = url.match(/v(\d+)/);
      const i = m ? Number(m[1]) : 0;
      await new Promise((r) => setTimeout(r, (8 - i) * 5));
      return videoInfo();
    });
    vi.mocked(yt.fetchCaptionsToTemp).mockResolvedValue({ kind: "none" });

    const r = await analyze("https://youtube.com/playlist?list=p", {
      concurrency: 4,
    });
    expect(r.bundles.map((b) => b.source.id)).toEqual([
      "v0",
      "v1",
      "v2",
      "v3",
      "v4",
      "v5",
      "v6",
      "v7",
    ]);
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

describe("analyze — per-entry host allowlist", () => {
  it("rejects a cross-host entry without calling fetchInfo on it", async () => {
    vi.mocked(yt.fetchEntries).mockResolvedValue([
      { id: "ok", url: "https://youtube.com/watch?v=ok" },
      { id: "bad", url: "https://vimeo.com/12345" },
    ]);
    vi.mocked(yt.fetchInfo).mockResolvedValue(videoInfo());
    vi.mocked(yt.fetchCaptionsToTemp).mockResolvedValue({ kind: "none" });

    const r = await analyze("https://youtube.com/playlist?list=p");
    expect(r.bundles).toHaveLength(1);
    expect(r.bundles[0]?.source.id).toBe("ok");
    expect(yt.fetchInfo).toHaveBeenCalledTimes(1);
    const crossHost = r.errors.find((e) => e.id === "bad");
    expect(crossHost?.kind).toBe("video");
    expect(crossHost?.reason).toMatch(/not in allowlist/);
  });

  it("does not re-check entries when allowedHosts is 'any'", async () => {
    vi.mocked(yt.fetchEntries).mockResolvedValue([
      { id: "x", url: "https://example.com/foo" },
    ]);
    vi.mocked(yt.fetchInfo).mockResolvedValue(videoInfo());
    vi.mocked(yt.fetchCaptionsToTemp).mockResolvedValue({ kind: "none" });

    const r = await analyze("https://example.com/foo", {
      allowedHosts: "any",
    });
    expect(r.bundles).toHaveLength(1);
    expect(yt.fetchInfo).toHaveBeenCalledTimes(1);
  });
});

describe("analyze — comments", () => {
  beforeEach(() => {
    vi.mocked(yt.fetchEntries).mockResolvedValue([
      { id: "vid", url: "https://youtube.com/watch?v=vid" },
    ]);
    vi.mocked(yt.fetchInfo).mockResolvedValue(videoInfo());
    vi.mocked(yt.fetchCaptionsToTemp).mockResolvedValue({ kind: "none" });
  });

  it("comments key is absent (not null) and fetchComments not called when caller does not opt in", async () => {
    const r = await analyze("https://youtube.com/watch?v=vid");
    // Key MUST be absent (not just null/undefined value) so JSON.stringify
    // omits it — preserves byte-identical --json output for v0.1 callers.
    expect(r.bundles[0]).toBeDefined();
    expect("comments" in r.bundles[0]!).toBe(false);
    expect(yt.fetchComments).not.toHaveBeenCalled();
  });

  it("forwards {max, sort} to fetchComments and populates bundle.comments when opted in", async () => {
    vi.mocked(yt.fetchComments).mockResolvedValue([
      {
        id: "c1",
        parent: "root",
        text: "great video",
        author: "Alice",
        author_id: "UCalice",
        author_is_uploader: false,
        author_is_verified: false,
        is_pinned: false,
        is_favorited: false,
        like_count: 5,
        timestamp: 1700000000,
      },
    ]);
    const r = await analyze("https://youtube.com/watch?v=vid", {
      comments: { max: 250, sort: "new" },
    });
    expect(yt.fetchComments).toHaveBeenCalledOnce();
    expect(yt.fetchComments).toHaveBeenCalledWith(
      "https://youtube.com/watch?v=vid",
      expect.objectContaining({ max: 250, sort: "new" }),
    );
    expect(r.bundles[0]?.comments).toEqual([
      {
        id: "c1",
        parentId: "root",
        text: "great video",
        author: "Alice",
        authorId: "UCalice",
        authorIsUploader: false,
        authorIsVerified: false,
        isPinned: false,
        isFavorited: false,
        likeCount: 5,
        timestampSec: 1700000000,
      },
    ]);
    expect(r.errors).toEqual([]);
  });

  it("comments: [] when fetch succeeds but the video has no comments", async () => {
    vi.mocked(yt.fetchComments).mockResolvedValue([]);
    const r = await analyze("https://youtube.com/watch?v=vid", {
      comments: { max: 100, sort: "top" },
    });
    expect(r.bundles[0]?.comments).toEqual([]);
    expect(r.errors).toEqual([]);
  });

  // Load-bearing: a comment-only failure must NEVER drop the metadata + transcript
  // bundle. Regressing this would re-introduce the partial-failure mode the
  // adversarial review surfaced (see plan: round-2 design fix).
  it("comments: null AND a kind:comments error when fetchComments throws — bundle still ships", async () => {
    vi.mocked(yt.fetchComments).mockRejectedValue(
      new Error("HTTP 429: rate limited"),
    );
    const r = await analyze("https://youtube.com/watch?v=vid", {
      comments: { max: 500, sort: "top" },
    });
    expect(r.bundles).toHaveLength(1);
    expect(r.bundles[0]?.source.id).toBe("vid");
    expect(r.bundles[0]?.meta.title).toBe("Test Title");
    expect(r.bundles[0]?.comments).toBeNull();
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.kind).toBe("comments");
    expect(r.errors[0]?.id).toBe("vid");
    expect(r.errors[0]?.reason).toMatch(/HTTP 429/);
  });
});

describe("analyze — schema id constraint", () => {
  it("surfaces a kind:video error when entry.id contains path-traversal chars", async () => {
    vi.mocked(yt.fetchEntries).mockResolvedValue([
      { id: "../../evil", url: "https://youtube.com/watch?v=ok" },
    ]);
    vi.mocked(yt.fetchInfo).mockResolvedValue(videoInfo());
    vi.mocked(yt.fetchCaptionsToTemp).mockResolvedValue({ kind: "none" });

    const r = await analyze("https://youtube.com/playlist?list=p");
    expect(r.bundles).toEqual([]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.kind).toBe("video");
    expect(r.errors[0]?.id).toBe("../../evil");
    expect(r.errors[0]?.reason).toMatch(/id/i);
  });
});
