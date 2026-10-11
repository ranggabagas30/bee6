import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

vi.mock("next/server", () => ({ connection: async () => {} }));

import SignInPage from "@/app/sign-in/page";
import { SignInScreen } from "@/app/sign-in/SignInScreen";

afterEach(() => vi.unstubAllEnvs());

const props = (as?: string | string[]) => ({ searchParams: Promise.resolve(as === undefined ? {} : { as }) });

describe("/sign-in page demo flag (R-12 Task 8.5)", () => {
  it("passes demo=true only when DEMO_MODE is exactly true", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const tree = (await SignInPage(props())) as ReactElement<{ demo: boolean }>;
    expect(tree.type).toBe(SignInScreen);
    expect(tree.props.demo).toBe(true);
  });

  it.each([undefined, "", "false", "TRUE", "1"])("passes demo=false when DEMO_MODE is %j", async (value) => {
    if (value === undefined) vi.stubEnv("DEMO_MODE", undefined as unknown as string);
    else vi.stubEnv("DEMO_MODE", value);
    const tree = (await SignInPage(props())) as ReactElement<{ demo: boolean }>;
    expect(tree.props.demo).toBe(false);
  });
});

describe("/sign-in role from ?as= (R-18 P1)", () => {
  it("on the pilot nothing is preselected, so the page asks who the visitor is", async () => {
    vi.stubEnv("DEMO_MODE", "");
    const tree = (await SignInPage(props())) as ReactElement<{ initialRole: string | null }>;
    expect(tree.props.initialRole).toBeNull();
  });

  it("on a demo deployment Staff is preselected because the judge path starts there", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const tree = (await SignInPage(props())) as ReactElement<{ initialRole: string | null }>;
    expect(tree.props.initialRole).toBe("staff");
  });

  it.each([
    ["staff", "staff"],
    ["supervisor", "supervisor"],
    ["owner", "owner"],
  ] as const)("?as=%s opens that panel on both deployments", async (as, expected) => {
    for (const demo of ["true", ""]) {
      vi.stubEnv("DEMO_MODE", demo);
      const tree = (await SignInPage(props(as))) as ReactElement<{ initialRole: string | null }>;
      expect(tree.props.initialRole).toBe(expected);
    }
  });

  it.each(["foo", "", "OWNER", "owner ", ["owner", "staff"]] as const)("E21: ?as=%j is ignored", async (as) => {
    vi.stubEnv("DEMO_MODE", "");
    const tree = (await SignInPage(props(as as string | string[]))) as ReactElement<{ initialRole: string | null }>;
    expect(tree.props.initialRole).toBeNull();
    vi.stubEnv("DEMO_MODE", "true");
    const demoTree = (await SignInPage(props(as as string | string[]))) as ReactElement<{ initialRole: string | null }>;
    expect(demoTree.props.initialRole).toBe("staff");
  });
});
