// Test helpers for reading app/globals.css as text (test-only, never imported by app code; pure node, no DOM).
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const GLOBALS_CSS_PATH = join(process.cwd(), "app", "globals.css");

export function readGlobalsCss(): string {
  return readFileSync(GLOBALS_CSS_PATH, "utf8");
}

export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

export interface CssRule {
  /** Selector list, or the at-rule prelude (e.g. "@media (prefers-reduced-motion: reduce)"). */
  prelude: string;
  /** Raw block body between the braces. */
  body: string;
  /** Rules nested inside an at-rule block, empty for style rules. */
  children: CssRule[];
}

/** Minimal CSS block parser: enough for flat style rules plus one level of @media / @keyframes nesting. */
export function parseCss(css: string): CssRule[] {
  const src = stripComments(css);
  const rules: CssRule[] = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf("{", i);
    if (open < 0) break;
    const prelude = src.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < src.length && depth > 0) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") depth--;
      j++;
    }
    const body = src.slice(open + 1, j - 1);
    const isAt = prelude.startsWith("@");
    rules.push({ prelude, body, children: isAt && body.includes("{") ? parseCss(body) : [] });
    i = j;
  }
  return rules;
}

export function declarations(body: string): Array<[string, string]> {
  return body
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const k = d.indexOf(":");
      return [d.slice(0, k).trim(), d.slice(k + 1).trim()] as [string, string];
    });
}

/** All `--b6-*` custom properties declared on :root. */
export function rootTokens(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rule of parseCss(css)) {
    if (rule.prelude !== ":root") continue;
    for (const [k, v] of declarations(rule.body)) out[k] = v;
  }
  return out;
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || m[1] === undefined) throw new Error(`not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG 2.x contrast ratio between two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Declarations of every top-level rule whose selector list contains exactly `selector`, merged in source order. */
export function ruleDeclarations(css: string, selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rule of parseCss(css)) {
    if (rule.prelude.startsWith("@")) continue;
    if (!rule.prelude.split(",").some((s) => s.trim() === selector)) continue;
    for (const [k, v] of declarations(rule.body)) out[k] = v;
  }
  return out;
}

/** Tap target height in px for a rule: a literal "NNpx" or the --b6-tap token (44px). */
export function minHeightPx(decls: Record<string, string>, tokens: Record<string, string>): number {
  const raw = decls["min-height"] ?? decls["height"];
  if (!raw) return 0;
  const v = raw.replace(/var\((--[\w-]+)\)/, (_m, name: string) => tokens[name] ?? "0");
  return parseFloat(v);
}

/** A token's value; throws when the token is missing so a typo fails loudly instead of as `undefined`. */
export function tok(tokens: Record<string, string>, name: string): string {
  const v = tokens[name];
  if (v === undefined) throw new Error(`missing token ${name}`);
  return v;
}
