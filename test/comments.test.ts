import { describe, it, expect } from "vitest";
import { buildComments } from "../src/analyze.js";
import { CommentSchema } from "../src/schema.js";

describe("buildComments", () => {
  it("returns [] for empty input", () => {
    expect(buildComments([])).toEqual([]);
  });

  it("maps yt-dlp's snake_case fields to the typed Comment shape", () => {
    const out = buildComments([
      {
        id: "c1",
        parent: "root",
        text: "great video",
        author: "Alice",
        author_id: "UCalice",
        author_is_uploader: false,
        author_is_verified: true,
        is_pinned: true,
        is_favorited: false,
        like_count: 12,
        timestamp: 1700000000,
      },
    ]);
    expect(out).toEqual([
      {
        id: "c1",
        parentId: "root",
        text: "great video",
        author: "Alice",
        authorId: "UCalice",
        authorIsUploader: false,
        authorIsVerified: true,
        isPinned: true,
        isFavorited: false,
        likeCount: 12,
        timestampSec: 1700000000,
      },
    ]);
    // Round-trip through the public schema to make sure the mapped shape is
    // actually what consumers will validate against.
    expect(() => CommentSchema.parse(out[0])).not.toThrow();
  });

  it('preserves replies via parent (non-"root")', () => {
    const out = buildComments([
      { id: "c1", parent: "root", text: "top-level", author: "A" },
      { id: "c2", parent: "c1", text: "reply", author: "B" },
    ]);
    expect(out[0]?.parentId).toBe("root");
    expect(out[1]?.parentId).toBe("c1");
  });

  it("falls back to safe defaults when optional fields are missing or wrong-typed", () => {
    const out = buildComments([
      {
        id: "c1",
        text: "no metadata",
        // author missing → ""
        // author_id missing → null
        // booleans missing → false
        // like_count is a string → null
        // timestamp missing → null
        // parent missing → "root"
        like_count: "12",
      },
    ]);
    expect(out[0]).toEqual({
      id: "c1",
      parentId: "root",
      text: "no metadata",
      author: "",
      authorId: null,
      authorIsUploader: false,
      authorIsVerified: false,
      isPinned: false,
      isFavorited: false,
      likeCount: null,
      timestampSec: null,
    });
    expect(() => CommentSchema.parse(out[0])).not.toThrow();
  });

  it("skips items missing the required id/text fields rather than producing invalid bundles", () => {
    const out = buildComments([
      { id: "ok", text: "kept", author: "A" },
      { id: "no-text", author: "A" }, // dropped
      { text: "no-id", author: "A" }, // dropped
      null, // dropped
      "string", // dropped
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe("ok");
  });
});
