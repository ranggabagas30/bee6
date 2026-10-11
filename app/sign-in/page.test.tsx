import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

vi.mock("next/server", () => ({ connection: async () => {} }));

import SignInPage from "@/app/sign-in/page";
import { SignInScreen } from "@/app/sign-in/SignInScreen";

afterEach(() => vi.unstubAllEnvs());

describe("/sign-in page demo flag (R-12 Task 8.5)", () => {
  it("passes demo=true only when DEMO_MODE is exactly true", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const tree = (await SignInPage()) as ReactElement<{ demo: boolean }>;
    expect(tree.type).toBe(SignInScreen);
    expect(tree.props.demo).toBe(true);
  });

  it.each([undefined, "", "false", "TRUE", "1"])("passes demo=false when DEMO_MODE is %j", async (value) => {
    if (value === undefined) vi.stubEnv("DEMO_MODE", undefined as unknown as string);
    else vi.stubEnv("DEMO_MODE", value);
    const tree = (await SignInPage()) as ReactElement<{ demo: boolean }>;
    expect(tree.props.demo).toBe(false);
  });
});
