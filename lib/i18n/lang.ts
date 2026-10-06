import { z } from "zod";

/**
 * Shop-phone language (UX-03 section 5.12). One cookie, `bee6_lang`, holds
 * `id` or `en`. It is stored on the device only: never sent in an API body,
 * never written to Firestore or the audit log, and never logged. The default is
 * English for every device, including when the cookie is missing or invalid.
 */

export const LANGS = ["id", "en"] as const;
export const LangSchema = z.enum(LANGS);
export type Lang = z.infer<typeof LangSchema>;

export const DEFAULT_LANG: Lang = "en";
export const LANG_COOKIE = "bee6_lang";
const LANG_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** Any value that is not exactly `id` or `en` reads as the default. */
export const LangCookieSchema = LangSchema.catch(DEFAULT_LANG);

export function parseLangCookie(raw: unknown): Lang {
  return LangCookieSchema.parse(raw);
}

/** The Set-Cookie-style string the browser writes on a language tap. */
export function buildLangCookie(lang: Lang): string {
  return `${LANG_COOKIE}=${lang}; Path=/; Max-Age=${LANG_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}
