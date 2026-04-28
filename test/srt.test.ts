import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSrt, parseSrtTime } from "../src/transcript/srt.js";

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");
const read = (p: string) => readFileSync(resolve(FIXTURES, p), "utf-8");

describe("parseSrtTime", () => {
  it("parses HH:MM:SS,mmm format", () => {
    expect(parseSrtTime("00:00:01,500")).toBe(1.5);
    expect(parseSrtTime("00:01:00,000")).toBe(60);
    expect(parseSrtTime("01:00:00,000")).toBe(3600);
  });
  it('also accepts "." as decimal separator (VTT-style)', () => {
    expect(parseSrtTime("00:00:01.250")).toBe(1.25);
  });
});

describe("parseSrt", () => {
  it("parses the EN fixture", () => {
    const segs = parseSrt(read("dQw4w9WgXcQ/raw.en.srt"));
    expect(segs.length).toBeGreaterThan(10);
    expect(segs[0]?.startSec).toBeCloseTo(1.36, 5);
    expect(segs[0]?.endSec).toBeCloseTo(3.04, 5);
    expect(segs[0]?.text).toBe("[♪♪♪]");
    expect(segs[1]?.text).toContain("We're no strangers to love");
  });

  it("joins multi-line cue bodies with spaces", () => {
    const segs = parseSrt(read("dQw4w9WgXcQ/raw.en.srt"));
    const joined = segs.find((s) => s.text.includes("You know the rules"));
    expect(joined?.text).toBe("♪ You know the rules and so do I ♪");
  });

  it("parses non-English fixture", () => {
    const segs = parseSrt(read("rruQmV1a5iM/raw.ar.srt"));
    expect(segs.length).toBeGreaterThan(0);
    expect(segs[0]?.startSec).toBeGreaterThan(0);
  });

  it("strips inline tags like <c> and <i>", () => {
    const sample = `1\n00:00:01,000 --> 00:00:02,000\n<c>hello</c> <i>world</i>\n`;
    const segs = parseSrt(sample);
    expect(segs[0]?.text).toBe("hello world");
  });

  it("skips malformed cues without crashing", () => {
    const sample = `1\nGARBAGE\n\n2\n00:00:02,000 --> 00:00:03,000\nokay\n`;
    const segs = parseSrt(sample);
    expect(segs).toEqual([{ startSec: 2, endSec: 3, text: "okay" }]);
  });
});
