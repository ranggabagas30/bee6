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
import { SignInScreen } from "@/app/sign-in/SignInScreen";
import { DemoIntro } from "@/app/demo/DemoIntro";

const FIREBASE_ENV = {
  FIREBASE_API_KEY: "k",
  FIREBASE_AUTH_DOMAIN: "p.firebaseapp.com",
  FIREBASE_PROJECT_ID: "p",
  FIREBASE_APP_ID: "1:1:web:a",
};
const props = (as?: string | string[]) => ({ searchParams: Promise.resolve(as === undefined ? {} : { as }) });

beforeEach(() => {
  redirect.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("/ on a demo deployment (R-18 P1 13.T9)", () => {
  it("renders the intro and the sign-in (home variant) with the web config when DEMO_MODE is exactly true, Staff preselected", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    for (const [k, v] of Object.entries(FIREBASE_ENV)) vi.stubEnv(k, v);
    const tree = (await HomePage(props())) as ReactElement<{ config: unknown; demo: boolean; initialRole: string; variant: string; children: ReactElement }>;
    expect(tree.type).toBe(SignInScreen);
    expect(tree.props.config).toEqual({ apiKey: "k", authDomain: "p.firebaseapp.com", projectId: "p", appId: "1:1:web:a" });
    expect(tree.props.demo).toBe(true);
    expect(tree.props.variant).toBe("home");
    expect(tree.props.initialRole).toBe("staff");
    expect(tree.props.children.type).toBe(DemoIntro);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("still renders with a null config when Firebase env is missing (the staff path needs none)", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    for (const k of Object.keys(FIREBASE_ENV)) vi.stubEnv(k, "");
    const tree = (await HomePage(props())) as ReactElement<{ config: unknown }>;
    expect(tree.type).toBe(SignInScreen);
    expect(tree.props.config).toBeNull();
  });

  it.each([
    ["supervisor", "supervisor"],
    ["owner", "owner"],
    ["staff", "staff"],
    ["root", "staff"],
    ["Staff", "staff"],
    [["owner", "staff"], "staff"],
  ] as const)("?as=%j opens the %s panel (E21: anything else is ignored)", async (as, expected) => {
    vi.stubEnv("DEMO_MODE", "true");
    const tree = (await HomePage(props(as as string | string[]))) as ReactElement<{ initialRole: string }>;
    expect(tree.props.initialRole).toBe(expected);
  });
});

describe("/ on the pilot (R-18 P1 13.T9, Rangga Q-7)", () => {
  it.each([undefined, "", "false", "TRUE", "1", "true "])("redirects to /sign-in and renders nothing when DEMO_MODE is %j", async (value) => {
    if (value === undefined) vi.stubEnv("DEMO_MODE", undefined as unknown as string);
    else vi.stubEnv("DEMO_MODE", value);
    await expect(HomePage(props())).rejects.toThrow("NEXT_REDIRECT:/sign-in");
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith("/sign-in");
  });

  it("the page never shows the old scaffold line any more", () => {
    const page = readFileSync(join(__dirname, "page.tsx"), "utf8");
    expect(page).not.toContain("scaffold in progress");
  });
});
