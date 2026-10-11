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

import RootLayout from "@/app/layout";
import { DemoBar } from "@/app/demo/DemoBar";

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

  it("mounts the DemoBar, with the web config, when DEMO_MODE is exactly true", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("FIREBASE_API_KEY", "k");
    vi.stubEnv("FIREBASE_AUTH_DOMAIN", "p.firebaseapp.com");
    vi.stubEnv("FIREBASE_PROJECT_ID", "p");
    vi.stubEnv("FIREBASE_APP_ID", "1:1:web:a");
    const bar = containsType(await RootLayout({ children: null }), DemoBar);
    expect(bar).not.toBeNull();
    expect(bar!.props.config).toEqual({ apiKey: "k", authDomain: "p.firebaseapp.com", projectId: "p", appId: "1:1:web:a" });
  });

  it("mounts the bar above the page content, so it is the first thing in the tab order", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const tree = await RootLayout({ children: <main id="page" /> });
    const body = (findHtml(tree) as ReactElement<{ children: ReactElement<{ children: ReactElement<{ children: unknown[] }> }> }>).props.children;
    const provider = body.props.children;
    const kids = provider.props.children as ReactElement[];
    expect(kids[0]!.type).toBe(DemoBar);
  });

  it.each([undefined, "", "false", "TRUE", "1"])("renders no DemoBar when DEMO_MODE is %j (pilot)", async (value) => {
    if (value === undefined) vi.stubEnv("DEMO_MODE", undefined as unknown as string);
    else vi.stubEnv("DEMO_MODE", value);
    expect(containsType(await RootLayout({ children: null }), DemoBar)).toBeNull();
  });
});
