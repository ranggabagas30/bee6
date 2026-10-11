import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

vi.mock("next/server", () => ({ connection: async () => {} }));

import HomePage from "@/app/page";
import { Landing } from "@/app/demo/Landing";

const FIREBASE_ENV = {
  FIREBASE_API_KEY: "k",
  FIREBASE_AUTH_DOMAIN: "p.firebaseapp.com",
  FIREBASE_PROJECT_ID: "p",
  FIREBASE_APP_ID: "1:1:web:a",
};

afterEach(() => vi.unstubAllEnvs());

describe("/ (R-12 Task 8.3)", () => {
  it("renders the demo landing with the web config when DEMO_MODE is exactly true", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    for (const [k, v] of Object.entries(FIREBASE_ENV)) vi.stubEnv(k, v);
    const tree = (await HomePage()) as ReactElement<{ config: unknown }>;
    expect(tree.type).toBe(Landing);
    expect(tree.props.config).toEqual({ apiKey: "k", authDomain: "p.firebaseapp.com", projectId: "p", appId: "1:1:web:a" });
  });

  it("still renders the landing with a null config when Firebase env is missing (staff path needs none)", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    for (const k of Object.keys(FIREBASE_ENV)) vi.stubEnv(k, "");
    const tree = (await HomePage()) as ReactElement<{ config: unknown }>;
    expect(tree.type).toBe(Landing);
    expect(tree.props.config).toBeNull();
  });

  it.each([undefined, "", "false", "TRUE", "1", "true "])("renders the plain scaffold, never the landing, when DEMO_MODE is %j", async (value) => {
    if (value === undefined) vi.stubEnv("DEMO_MODE", undefined as unknown as string);
    else vi.stubEnv("DEMO_MODE", value);
    const tree = (await HomePage()) as ReactElement<{ children?: unknown }>;
    expect(tree.type).toBe("main");
    expect(JSON.stringify(tree)).toContain("scaffold in progress");
    expect(JSON.stringify(tree)).not.toMatch(/Try as|demo/i);
  });
});
