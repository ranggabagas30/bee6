import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

let cookieValue: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "bee6_lang" && cookieValue !== undefined
        ? { name, value: cookieValue }
        : undefined,
  }),
}));

// next/font/google only works through the Next compiler; the real module is covered by the production build.
vi.mock("@/app/ui/fonts", () => ({ fontVariableClassNames: "mock-sans mock-mono" }));

import RootLayout from "@/app/layout";
import { DemoBarLoader } from "@/app/demo/DemoBarLoader";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function findHtml(node: unknown): ReactElement<{ lang: string }> | null {
  if (!node || typeof node !== "object" || !("props" in node)) return null;
  const element = node as ReactElement<{ lang?: string; children?: unknown }>;
  if (element.type === "html") return element as ReactElement<{ lang: string }>;
  const children = element.props.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findHtml(child);
    if (found) return found;
  }
  return null;
}

async function htmlLang(): Promise<string | undefined> {
  const tree = await RootLayout({ children: null });
  return findHtml(tree)?.props.lang;
}

describe("RootLayout <html lang>", () => {
  it("is English when no language cookie is set", async () => {
    cookieValue = undefined;
    expect(await htmlLang()).toBe("en");
  });

  it("follows a valid id or en cookie on the first paint", async () => {
    cookieValue = "id";
    expect(await htmlLang()).toBe("id");
    cookieValue = "en";
    expect(await htmlLang()).toBe("en");
  });

  it("falls back to English for an invalid cookie value", async () => {
    cookieValue = "fr";
    expect(await htmlLang()).toBe("en");
  });
});

function containsType(node: unknown, type: unknown): ReactElement<{ config?: unknown }> | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = containsType(child, type);
      if (found) return found;
    }
    return null;
  }
  if (!("props" in node)) return null;
  const element = node as ReactElement<{ config?: unknown; children?: unknown }>;
  if (element.type === type) return element;
  return containsType(element.props.children, type);
}

describe("RootLayout demo bar (R-12 Task 8.4)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("mounts the demo bar (lazily loaded), with the web config, when DEMO_MODE is exactly true", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("FIREBASE_API_KEY", "k");
    vi.stubEnv("FIREBASE_AUTH_DOMAIN", "p.firebaseapp.com");
    vi.stubEnv("FIREBASE_PROJECT_ID", "p");
    vi.stubEnv("FIREBASE_APP_ID", "1:1:web:a");
    const bar = containsType(await RootLayout({ children: null }), DemoBarLoader);
    expect(bar).not.toBeNull();
    expect(bar!.props.config).toEqual({ apiKey: "k", authDomain: "p.firebaseapp.com", projectId: "p", appId: "1:1:web:a" });
  });

  it("mounts the bar above the page content, so it is the first thing in the tab order", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const tree = await RootLayout({ children: <main id="page" /> });
    const body = (findHtml(tree) as unknown as ReactElement<{ children: ReactElement<{ children: ReactElement<{ children: unknown[] }> }> }>).props.children;
    const provider = body.props.children;
    const kids = provider.props.children as ReactElement[];
    expect(kids[0]!.type).toBe(DemoBarLoader);
  });

  it("the layout and its loader only import the bar lazily, so a pilot page does not download the demo or Firebase Auth chunks", () => {
    const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
    const layout = read("layout.tsx");
    expect(layout).not.toMatch(/from\s+["']@\/app\/demo\/DemoBar["']/);
    const loader = read("demo/DemoBarLoader.tsx");
    expect(loader).not.toMatch(/^import\s[^;]*from\s+["']@\/app\/demo\/DemoBar["']/m);
    expect(loader).toMatch(/import\(\s*["']@\/app\/demo\/DemoBar["']\s*\)/);
    expect(loader).toMatch(/ssr:\s*false/);
  });

  it.each([undefined, "", "false", "TRUE", "1"])("renders no DemoBar when DEMO_MODE is %j (pilot)", async (value) => {
    if (value === undefined) vi.stubEnv("DEMO_MODE", undefined as unknown as string);
    else vi.stubEnv("DEMO_MODE", value);
    expect(containsType(await RootLayout({ children: null }), DemoBarLoader)).toBeNull();
  });
});

describe("RootLayout page-2 design system (R-19 PR-0b)", () => {
  const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");

  it("puts the font variable classes on <html>, which only defines CSS variables and restyles nothing", async () => {
    const html = findHtml(await RootLayout({ children: null })) as unknown as ReactElement<{ className?: string }>;
    expect(html.props.className).toBe("mock-sans mock-mono");
  });

  it("imports globals.css once, from the root layout, and nowhere else in app/", () => {
    expect(read("layout.tsx").match(/import\s+["']\.\/globals\.css["']/g)).toHaveLength(1);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(join(__dirname, dir), { withFileTypes: true })) {
        const rel = join(dir, e.name);
        if (e.isDirectory()) walk(rel);
        else if (/\.(tsx?|css)$/.test(e.name) && !e.name.endsWith(".test.tsx") && !e.name.endsWith(".test.ts") && rel !== "layout.tsx") {
          if (/^\s*import\s+(?:[^;]*\sfrom\s+)?["'][^"']*globals\.css["']/m.test(read(rel))) offenders.push(rel);
        }
      }
    };
    walk(".");
    expect(offenders).toEqual([]);
  });
});
