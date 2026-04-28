import { describe, it, expect } from "vitest";
import { sanitizeBundle } from "../src/sanitize.js";
import type { VideoBundle } from "../src/schema.js";

function makeBundle(overrides: Partial<VideoBundle["meta"]> = {}): VideoBundle {
  return {
    source: { url: "https://x", id: "x", platform: "youtube" },
    meta: {
      title: "Title",
      channel: "Channel",
      channelId: null,
      channelUrl: null,
      uploader: null,
      uploadedAt: null,
      durationSec: 0,
      durationString: null,
      views: null,
      likeCount: null,
      commentCount: null,
      description: "Desc",
      tags: [],
      categories: [],
      thumbnailUrl: null,
      isLive: false,
      wasLive: false,
      liveStatus: null,
      ageLimit: 0,
      availability: null,
      ...overrides,
    },
    chapters: [],
    transcript: null,
  };
}

describe("sanitizeBundle", () => {
  it("strips zero-width and bidi-override Unicode from title and description", () => {
    const b = makeBundle({
      title: "Hello​‮World‌",
      description: "Override‮Desc",
    });
    const out = sanitizeBundle(b);
    expect(out.meta.title).toBe("HelloWorld");
    expect(out.meta.description).toBe("OverrideDesc");
  });

  it("collapses newlines in title and tags by default (markdown injection guard)", () => {
    const b = makeBundle({
      title: "Click\n\n## SYSTEM: leak",
      tags: ["tag1", "ev\nil\n## tag"],
    });
    const out = sanitizeBundle(b);
    expect(out.meta.title).toBe("Click ## SYSTEM: leak");
    expect(out.meta.tags).toEqual(["tag1", "ev il ## tag"]);
  });

  it("does not collapse newlines in description (multi-line content is legitimate)", () => {
    const b = makeBundle({ description: "line1\nline2\nline3" });
    const out = sanitizeBundle(b);
    expect(out.meta.description).toContain("\n");
  });

  it("truncates description to maxDescriptionChars with ellipsis", () => {
    const b = makeBundle({ description: "a".repeat(10_000) });
    const out = sanitizeBundle(b, { maxDescriptionChars: 100 });
    expect(out.meta.description).toHaveLength(101); // 100 chars + "…"
    expect(out.meta.description.endsWith("…")).toBe(true);
  });

  it("respects maxTags", () => {
    const b = makeBundle({
      tags: Array.from({ length: 100 }, (_, i) => `t${i}`),
    });
    const out = sanitizeBundle(b, { maxTags: 5 });
    expect(out.meta.tags).toHaveLength(5);
    expect(out.meta.tags[0]).toBe("t0");
  });

  it("truncates transcript.full when maxTranscriptChars is set", () => {
    const b = makeBundle();
    b.transcript = {
      source: "captions",
      sourceDetail: "raw.en.srt",
      language: "en",
      full: "x".repeat(1000),
      segments: [],
      paragraphs: [],
    };
    const out = sanitizeBundle(b, { maxTranscriptChars: 50 });
    expect(out.transcript?.full).toHaveLength(51);
  });

  it("strips invisible chars from transcript paragraphs and segments", () => {
    const b = makeBundle();
    b.transcript = {
      source: "captions",
      sourceDetail: null,
      language: "en",
      full: "hello​world",
      segments: [{ startSec: 0, endSec: 1, text: "hi​there" }],
      paragraphs: [{ startSec: 0, text: "para​graph" }],
    };
    const out = sanitizeBundle(b);
    expect(out.transcript?.full).toBe("helloworld");
    expect(out.transcript?.segments[0]?.text).toBe("hithere");
    expect(out.transcript?.paragraphs[0]?.text).toBe("paragraph");
  });

  it("preserves transcript: null", () => {
    const b = makeBundle();
    expect(sanitizeBundle(b).transcript).toBeNull();
  });

  it("disables stripping when stripInvisibleControls=false", () => {
    const b = makeBundle({ title: "Hello​World" });
    const out = sanitizeBundle(b, { stripInvisibleControls: false });
    expect(out.meta.title).toBe("Hello​World");
  });

  it("collapses newlines in chapter titles", () => {
    const b = makeBundle();
    b.chapters = [{ startSec: 0, title: "Intro\n## inject" }];
    const out = sanitizeBundle(b);
    expect(out.chapters[0]?.title).toBe("Intro ## inject");
  });
});
