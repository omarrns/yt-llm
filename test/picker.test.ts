import { describe, it, expect } from "vitest";
import {
  pickPreferredSrt,
  languageFromSrtName,
} from "../src/transcript/index.js";

describe("pickPreferredSrt", () => {
  it("returns null for empty input", () => {
    expect(pickPreferredSrt([])).toBeNull();
  });

  it("prefers raw.en.srt over locale variants", () => {
    const files = [
      "/tmp/raw.en-orig.srt",
      "/tmp/raw.en-en.srt",
      "/tmp/raw.en.srt",
    ];
    expect(pickPreferredSrt(files)).toBe("/tmp/raw.en.srt");
  });

  it("falls back to first sorted match when no plain raw.en.srt exists", () => {
    const files = ["/tmp/raw.en-orig.srt", "/tmp/raw.ar.srt"];
    expect(pickPreferredSrt(files)).toBe("/tmp/raw.ar.srt");
  });
});

describe("languageFromSrtName", () => {
  it("extracts the language code from the filename", () => {
    expect(languageFromSrtName("/tmp/raw.en.srt")).toBe("en");
    expect(languageFromSrtName("/tmp/raw.ar.srt")).toBe("ar");
    expect(languageFromSrtName("raw.en-orig.srt")).toBe("en-orig");
  });

  it('returns "unknown" for non-matching names', () => {
    expect(languageFromSrtName("something.weird.txt")).toBe("unknown");
  });
});
