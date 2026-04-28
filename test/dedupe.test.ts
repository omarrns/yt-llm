import { describe, it, expect } from "vitest";
import { dedupeSegments } from "../src/transcript/dedupe.js";
import type { TranscriptSegment } from "../src/schema.js";

describe("dedupeSegments", () => {
  it("returns empty for empty input", () => {
    expect(dedupeSegments([])).toEqual([]);
  });

  it("preserves non-overlapping segments", () => {
    const segs: TranscriptSegment[] = [
      { startSec: 0, endSec: 1, text: "hello world" },
      { startSec: 1, endSec: 2, text: "goodbye now" },
    ];
    expect(dedupeSegments(segs)).toEqual(segs);
  });

  it("strips a leading suffix that matches the previous tail (rolling caption case)", () => {
    const segs: TranscriptSegment[] = [
      { startSec: 0, endSec: 1, text: "we are no strangers to love" },
      { startSec: 1, endSec: 2, text: "strangers to love you know the rules" },
    ];
    const out = dedupeSegments(segs);
    expect(out).toEqual([
      { startSec: 0, endSec: 1, text: "we are no strangers to love" },
      { startSec: 1, endSec: 2, text: "you know the rules" },
    ]);
  });

  it("drops a fully-contained duplicate cue", () => {
    const segs: TranscriptSegment[] = [
      { startSec: 0, endSec: 1, text: "hello world" },
      { startSec: 1, endSec: 2, text: "hello world" },
    ];
    expect(dedupeSegments(segs)).toEqual([
      { startSec: 0, endSec: 1, text: "hello world" },
    ]);
  });

  it("skips empty-text segments", () => {
    const segs: TranscriptSegment[] = [
      { startSec: 0, endSec: 1, text: "hello" },
      { startSec: 1, endSec: 2, text: "   " },
      { startSec: 2, endSec: 3, text: "world" },
    ];
    expect(dedupeSegments(segs)).toEqual([
      { startSec: 0, endSec: 1, text: "hello" },
      { startSec: 2, endSec: 3, text: "world" },
    ]);
  });

  it("matches the longest possible suffix overlap (greedy from the end)", () => {
    const segs: TranscriptSegment[] = [
      { startSec: 0, endSec: 1, text: "a b c d" },
      { startSec: 1, endSec: 2, text: "c d e f" },
    ];
    expect(dedupeSegments(segs)).toEqual([
      { startSec: 0, endSec: 1, text: "a b c d" },
      { startSec: 1, endSec: 2, text: "e f" },
    ]);
  });
});
