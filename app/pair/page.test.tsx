import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

vi.mock("next/server", () => ({ connection: async () => {} }));

import PairPage from "@/app/pair/page";
import { PairScreen } from "@/app/pair/PairScreen";

const FIREBASE_ENV = { FIREBASE_API_KEY: "k", FIREBASE_AUTH_DOMAIN: "p.firebaseapp.com", FIREBASE_PROJECT_ID: "p", FIREBASE_APP_ID: "1:1:web:a" };

afterEach(() => vi.unstubAllEnvs());

describe("/pair page (R-19 PR-6 §8.1): DEMO_MODE and the web config are read per request", () => {
  it("on the demo (DEMO_MODE exactly true) renders PairScreen with demo on and the web config", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    for (const [k, v] of Object.entries(FIREBASE_ENV)) vi.stubEnv(k, v);
    const tree = (await PairPage()) as ReactElement<{ demo: boolean; config: unknown }>;
    expect(tree.type).toBe(PairScreen);
    expect(tree.props.demo).toBe(true);
    expect(tree.props.config).toEqual({ apiKey: "k", authDomain: "p.firebaseapp.com", projectId: "p", appId: "1:1:web:a" });
  });

  it.each([undefined, "", "false", "TRUE", "1"])("on the pilot (DEMO_MODE %j) renders PairScreen with demo off", async (value) => {
    if (value === undefined) vi.stubEnv("DEMO_MODE", undefined as unknown as string);
    else vi.stubEnv("DEMO_MODE", value);
    const tree = (await PairPage()) as ReactElement<{ demo: boolean }>;
    expect(tree.type).toBe(PairScreen);
    expect(tree.props.demo).toBe(false);
  });
});
