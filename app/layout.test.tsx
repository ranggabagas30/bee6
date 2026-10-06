import { describe, expect, it, vi } from "vitest";
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
