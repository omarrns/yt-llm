import { describe, it, expect } from "vitest";
import {
  DEFAULT_ALLOWED_HOSTS,
  isAllowedHost,
  isYouTubeUrl,
} from "../src/url.js";

describe("isYouTubeUrl", () => {
  it.each([
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube-nocookie.com/embed/dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    "http://www.youtube.com/watch?v=x", // http allowed (rare but legal)
  ])("accepts %s", (url) => {
    expect(isYouTubeUrl(url)).toBe(true);
  });

  it.each([
    "file:///etc/passwd",
    "http://169.254.169.254/latest/meta-data/",
    "https://evil.com/watch?v=x",
    "https://youtube.com.evil.com/x",
    "https://fake-youtube.com/x",
    "ftp://youtube.com/x",
    "javascript:alert(1)",
    "not a url",
    "",
  ])("rejects %s", (url) => {
    expect(isYouTubeUrl(url)).toBe(false);
  });

  it("is case-insensitive on hostname", () => {
    expect(isYouTubeUrl("https://YouTube.com/watch?v=x")).toBe(true);
    expect(isYouTubeUrl("https://YOUTU.BE/x")).toBe(true);
  });
});

describe("isAllowedHost with custom list", () => {
  it("respects a custom allowlist", () => {
    expect(isAllowedHost("https://example.com/x", ["example.com"])).toBe(true);
    expect(isAllowedHost("https://other.com/x", ["example.com"])).toBe(false);
  });

  it("rejects non-http(s) protocols even if hostname matches", () => {
    expect(isAllowedHost("file://example.com/x", ["example.com"])).toBe(false);
  });

  it("returns false on malformed URLs", () => {
    expect(isAllowedHost("::not::a::url", ["example.com"])).toBe(false);
  });
});

describe("DEFAULT_ALLOWED_HOSTS", () => {
  it("includes the canonical YouTube hostnames", () => {
    expect(DEFAULT_ALLOWED_HOSTS).toContain("youtube.com");
    expect(DEFAULT_ALLOWED_HOSTS).toContain("www.youtube.com");
    expect(DEFAULT_ALLOWED_HOSTS).toContain("youtu.be");
  });
});
