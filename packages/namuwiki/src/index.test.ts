import { describe, expect, it } from "vitest";
import { articleKeyFromCanonical, normalizeNamuWikiUrl } from "./index.js";

describe("normalizeNamuWikiUrl", () => {
  it.each([
    ["https://namu.wiki/w/K%EB%A6%AC%EA%B7%B8", "K리그"],
    ["https://namu.wiki/w/%EB%8B%B4%EB%B9%84(%EC%84%9C%EB%B9%84%EC%8A%A4)", "담비(서비스)"],
    ["https://namu.wiki/w/A%2FB?from=search#section", "A/B"],
  ])("normalizes an allowed document: %s", (input, articleKey) => {
    expect(normalizeNamuWikiUrl(input)).toMatchObject({ ok: true, articleKey });
  });

  it("normalizes unicode to NFC", () => {
    const result = normalizeNamuWikiUrl("https://namu.wiki/w/Cafe%CC%81");
    expect(result).toMatchObject({ ok: true, articleKey: "Café" });
  });

  it.each([
    ["http://namu.wiki/w/test", "INSECURE_PROTOCOL"],
    ["https://example.com/w/test", "UNSUPPORTED_HOST"],
    ["https://www.namu.wiki/w/test", "UNSUPPORTED_HOST"],
    ["https://namu.wiki/edit/test", "INVALID_PATH"],
    ["https://namu.wiki/history/test", "INVALID_PATH"],
    ["https://namu.wiki/w/", "EMPTY_ARTICLE"],
    ["https://namu.wiki/w/%E0%A4%A", "INVALID_ENCODING"],
    ["https://namu.wiki/w/%ED%8C%8C%EC%9D%BC%3Alogo.png", "EXCLUDED_NAMESPACE"],
    ["https://namu.wiki/w/Category%3Aexample", "EXCLUDED_NAMESPACE"],
  ])("rejects an unsupported URL: %s", (input, code) => {
    expect(normalizeNamuWikiUrl(input)).toEqual({ ok: false, code });
  });
});

describe("articleKeyFromCanonical", () => {
  it("prefers a valid canonical URL", () => {
    expect(
      articleKeyFromCanonical(
        "https://namu.wiki/w/%EC%B6%95%EA%B5%AC",
        "https://namu.wiki/w/%EC%B6%95%EA%B5%AC?from=search",
      ),
    ).toMatchObject({ ok: true, articleKey: "축구" });
  });

  it("falls back to the current URL when canonical is invalid", () => {
    expect(
      articleKeyFromCanonical(
        "https://example.com/w/not-allowed",
        "https://namu.wiki/w/%EC%B6%95%EA%B5%AC",
      ),
    ).toMatchObject({ ok: true, articleKey: "축구" });
  });
});
