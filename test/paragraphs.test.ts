import { describe, it, expect } from "vitest";
import { toParagraphs } from "../src/transcript/paragraphs.js";
import type { TranscriptSegment } from "../src/schema.js";

describe("toParagraphs", () => {
  it("returns empty for empty input", () => {
    expect(toParagraphs([])).toEqual([]);
  });

  it("groups segments into paragraphs at the window boundary", () => {
    const segs: TranscriptSegment[] = [
      { startSec: 0, endSec: 10, text: "first" },
      { startSec: 10, endSec: 20, text: "second" },
      { startSec: 20, endSec: 35, text: "third" },
      { startSec: 35, endSec: 40, text: "fourth" },
      { startSec: 40, endSec: 70, text: "fifth" },
    ];
    const out = toParagraphs(segs, 30);
    expect(out).toEqual([
      { startSec: 0, text: "first second third" },
      { startSec: 35, text: "fourth fifth" },
    ]);
  });

  it("flushes a trailing buffer that never crosses the window", () => {
    const segs: TranscriptSegment[] = [
      { startSec: 0, endSec: 5, text: "short" },
      { startSec: 5, endSec: 10, text: "paragraph" },
    ];
    expect(toParagraphs(segs, 30)).toEqual([
      { startSec: 0, text: "short paragraph" },
    ]);
  });

  it("respects custom window sizes", () => {
    const segs: TranscriptSegment[] = [
      { startSec: 0, endSec: 5, text: "a" },
      { startSec: 5, endSec: 10, text: "b" },
      { startSec: 10, endSec: 15, text: "c" },
    ];
    expect(toParagraphs(segs, 10)).toEqual([
      { startSec: 0, text: "a b" },
      { startSec: 10, text: "c" },
    ]);
  });
});
