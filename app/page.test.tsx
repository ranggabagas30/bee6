import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("next/server", () => ({ connection: async () => {} }));
const redirect = vi.fn((path: string): never => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});
vi.mock("next/navigation", () => ({ redirect: (path: string) => redirect(path) }));

import HomePage from "@/app/page";
import { EntryLanding } from "@/app/web/EntryLanding";

beforeEach(() => {
  redirect.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("/ on a demo deployment (R-19 PR-6 §8.1: the W1 entry page)", () => {
  it("renders the entry landing, with no sign-in form and no web config, when DEMO_MODE is exactly true", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const tree = (await HomePage()) as ReactElement;
    expect(tree.type).toBe(EntryLanding);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("the page source carries no demo code, no credentials and no change-role tip (W8: the guide owns them)", () => {
    const page = readFileSync(join(__dirname, "page.tsx"), "utf8");
    const landing = readFileSync(join(__dirname, "web", "EntryLanding.tsx"), "utf8");
    for (const src of [page, landing]) {
      expect(src).not.toMatch(/000000|credentials|DemoAccess|example\.com/);
      expect(src).not.toMatch(/change role/i);
    }
  });
});

describe("/ on the pilot (R-18 P1 13.T9, Rangga Q-7; unchanged in R-19 PR-6)", () => {
  it.each([undefined, "", "false", "TRUE", "1", "true "])("redirects to /sign-in and renders nothing when DEMO_MODE is %j", async (value) => {
    if (value === undefined) vi.stubEnv("DEMO_MODE", undefined as unknown as string);
    else vi.stubEnv("DEMO_MODE", value);
    await expect(HomePage()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith("/sign-in");
  });

  it("the page never shows the old scaffold line any more", () => {
    const page = readFileSync(join(__dirname, "page.tsx"), "utf8");
    expect(page).not.toContain("scaffold in progress");
  });
});
