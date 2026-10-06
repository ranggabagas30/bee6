import { describe, expect, it } from "vitest";
import {
  DEFAULT_LANG,
  LANG_COOKIE,
  buildLangCookie,
  parseLangCookie,
} from "@/lib/i18n/lang";

describe("parseLangCookie", () => {
  it("returns the two supported languages unchanged", () => {
    expect(parseLangCookie("id")).toBe("id");
    expect(parseLangCookie("en")).toBe("en");
  });

  it("falls back to English for a missing cookie", () => {
    expect(parseLangCookie(undefined)).toBe("en");
    expect(parseLangCookie(null)).toBe("en");
    expect(parseLangCookie("")).toBe("en");
  });

  it("falls back to English for any invalid value", () => {
    for (const raw of ["fr", "ID", "En", " id", "id,en", "id;", "__proto__", "constructor", 42, {}]) {
      expect(parseLangCookie(raw)).toBe("en");
    }
  });

  it("defaults to English and uses the bee6_lang cookie name", () => {
    expect(DEFAULT_LANG).toBe("en");
    expect(LANG_COOKIE).toBe("bee6_lang");
  });
});

describe("buildLangCookie", () => {
  it("writes the value with path, one-year max age and SameSite=Lax, and nothing else", () => {
    expect(buildLangCookie("id")).toBe(
      "bee6_lang=id; Path=/; Max-Age=31536000; SameSite=Lax",
    );
    expect(buildLangCookie("en")).toBe(
      "bee6_lang=en; Path=/; Max-Age=31536000; SameSite=Lax",
    );
  });
});
