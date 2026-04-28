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

  it("matches en.* wildcard variants (en-orig, en-US) before falling back to other languages", () => {
    // Default subLangs is ["en.*"], so an en-orig variant should win over ar
    // even though ar sorts alphabetically first.
    const files = ["/tmp/raw.en-orig.srt", "/tmp/raw.ar.srt"];
    expect(pickPreferredSrt(files)).toBe("/tmp/raw.en-orig.srt");
  });

  it("falls back to alphabetical first when no subLang matches", () => {
    const files = ["/tmp/raw.fr.srt", "/tmp/raw.de.srt"];
    expect(pickPreferredSrt(files, ["en.*"])).toBe("/tmp/raw.de.srt");
  });

  it("respects subLangs order — picks first matching language", () => {
    const files = ["/tmp/raw.en.srt", "/tmp/raw.es.srt", "/tmp/raw.fr.srt"];
    expect(pickPreferredSrt(files, ["es", "fr", "en"])).toBe("/tmp/raw.es.srt");
  });

  it("prefers plain language over locale variants within the same subLang", () => {
    const files = ["/tmp/raw.en-orig.srt", "/tmp/raw.en.srt"];
    expect(pickPreferredSrt(files, ["en"])).toBe("/tmp/raw.en.srt");
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
