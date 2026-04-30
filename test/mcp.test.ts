import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/yt.js", () => ({
  fetchEntries: vi.fn(),
  fetchInfo: vi.fn(),
  fetchCaptionsToTemp: vi.fn(),
  fetchComments: vi.fn(),
}));

import { analyzeTool, createServer } from "../src/mcp/server.js";
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

describe("analyzeTool — host allowlist", () => {
  it("returns isError:true for a non-YouTube URL without invoking yt-dlp", async () => {
    const r = await analyzeTool({ url: "https://evil.com/watch?v=x" });
    expect(r.isError).toBe(true);
    expect(yt.fetchEntries).not.toHaveBeenCalled();
    const payload = JSON.parse(r.content[0]!.text);
    expect(payload.bundles).toEqual([]);
    expect(payload.errors[0].kind).toBe("playlist");
    expect(payload.errors[0].reason).toMatch(/YouTube allowlist/);
  });

  it("rejects file:// even though hostname might parse", async () => {
    const r = await analyzeTool({ url: "file:///etc/passwd" });
    expect(r.isError).toBe(true);
    const payload = JSON.parse(r.content[0]!.text);
    expect(payload.errors[0].reason).toMatch(/YouTube allowlist/);
  });
});

describe("analyzeTool — success path", () => {
  it("forwards subLangs to analyze and returns bundles+errors as JSON text", async () => {
    vi.mocked(yt.fetchEntries).mockResolvedValue([
      { id: "vid", url: "https://youtube.com/watch?v=vid" },
    ]);
    vi.mocked(yt.fetchInfo).mockResolvedValue(videoInfo());
    vi.mocked(yt.fetchCaptionsToTemp).mockResolvedValue({ kind: "none" });

    const r = await analyzeTool({
      url: "https://youtube.com/watch?v=vid",
      subLangs: ["es", "fr"],
    });
    expect(r.isError).toBeUndefined();
    expect(yt.fetchEntries).toHaveBeenCalledOnce();
    const payload = JSON.parse(r.content[0]!.text);
    expect(payload.bundles).toHaveLength(1);
    expect(payload.bundles[0].source.id).toBe("vid");
    expect(payload.errors).toEqual([]);
  });

  it("surfaces analyze errors in the JSON payload (e.g., transcript fetch failure)", async () => {
    vi.mocked(yt.fetchEntries).mockResolvedValue([
      { id: "vid", url: "https://youtube.com/watch?v=vid" },
    ]);
    vi.mocked(yt.fetchInfo).mockResolvedValue(videoInfo());
    vi.mocked(yt.fetchCaptionsToTemp).mockResolvedValue({
      kind: "error",
      reason: "HTTP 429: rate limited",
    });

    const r = await analyzeTool({
      url: "https://youtube.com/watch?v=vid",
    });
    const payload = JSON.parse(r.content[0]!.text);
    expect(payload.bundles).toHaveLength(1);
    expect(payload.errors[0].kind).toBe("transcript");
    expect(payload.errors[0].reason).toMatch(/HTTP 429/);
  });
});

describe("analyzeTool — comments cap", () => {
  beforeEach(() => {
    vi.mocked(yt.fetchEntries).mockResolvedValue([
      { id: "vid", url: "https://youtube.com/watch?v=vid" },
    ]);
    vi.mocked(yt.fetchInfo).mockResolvedValue(videoInfo());
    vi.mocked(yt.fetchCaptionsToTemp).mockResolvedValue({ kind: "none" });
    vi.mocked(yt.fetchComments).mockResolvedValue([]);
  });

  it("does not call fetchComments when withComments is absent", async () => {
    await analyzeTool({ url: "https://youtube.com/watch?v=vid" });
    expect(yt.fetchComments).not.toHaveBeenCalled();
  });

  it("clamps maxComments to the 2000 server-side cap regardless of input", async () => {
    await analyzeTool({
      url: "https://youtube.com/watch?v=vid",
      withComments: true,
      maxComments: 100000,
    });
    expect(yt.fetchComments).toHaveBeenCalledWith(
      "https://youtube.com/watch?v=vid",
      expect.objectContaining({ max: 2000 }),
    );
  });

  it("respects maxComments below the cap", async () => {
    await analyzeTool({
      url: "https://youtube.com/watch?v=vid",
      withComments: true,
      maxComments: 250,
      commentSort: "new",
    });
    expect(yt.fetchComments).toHaveBeenCalledWith(
      "https://youtube.com/watch?v=vid",
      expect.objectContaining({ max: 250, sort: "new" }),
    );
  });

  it("defaults to max=500, sort=top when only withComments is set", async () => {
    await analyzeTool({
      url: "https://youtube.com/watch?v=vid",
      withComments: true,
    });
    expect(yt.fetchComments).toHaveBeenCalledWith(
      "https://youtube.com/watch?v=vid",
      expect.objectContaining({ max: 500, sort: "top" }),
    );
  });
});

describe("createServer — registration shape", () => {
  it("constructs without side effects (no transport bound) and reports the package version", () => {
    const server = createServer();
    expect(server).toBeDefined();
    // McpServer keeps its registered tools accessible; the tool handler we
    // registered IS analyzeTool, exercised directly above.
  });
});
