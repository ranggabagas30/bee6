import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const mockRedirect = vi.fn();

vi.mock("next/server", () => ({ 
  connection: async () => {},
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    mockRedirect(url);
    throw new Error(`REDIRECT_TO:${url}`);
  },
}));

import SignInPage from "@/app/sign-in/page";
import { SignInScreen } from "@/app/sign-in/SignInScreen";

afterEach(() => {
  vi.unstubAllEnvs();
  mockRedirect.mockClear();
});

const props = (as?: string | string[]) => ({ searchParams: Promise.resolve(as === undefined ? {} : { as }) });

describe("/sign-in page demo flag (R-12 Task 8.5)", () => {
  it("passes demo=true only when DEMO_MODE is exactly true", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    // Don't redirect because as=supervisor will be rendered
    vi.stubEnv("DEMO_MODE", "");
    const tree = (await SignInPage(props())) as ReactElement<{ demo: boolean }>;
    expect(tree.type).toBe(SignInScreen);
    expect(tree.props.demo).toBe(false);
    
    vi.stubEnv("DEMO_MODE", "true");
    // as=supervisor will not redirect because it's supervisor (not staff, not null)
    const tree2 = (await SignInPage(props("supervisor"))) as ReactElement<{ demo: boolean }>;
    expect(tree2.props.demo).toBe(true);
  });

  it.each([undefined, "", "false", "TRUE", "1"])("passes demo=false when DEMO_MODE is %j", async (value) => {
    if (value === undefined) vi.stubEnv("DEMO_MODE", undefined as unknown as string);
    else vi.stubEnv("DEMO_MODE", value);
    const tree = (await SignInPage(props("supervisor"))) as ReactElement<{ demo: boolean }>;
    expect(tree.props.demo).toBe(false);
  });
});

describe("/sign-in role from ?as= (R-18 P1)", () => {
  it("on the pilot nothing is preselected, so the page asks who the visitor is", async () => {
    vi.stubEnv("DEMO_MODE", "");
    const tree = (await SignInPage(props())) as ReactElement<{ initialRole: string | null }>;
    expect(tree.props.initialRole).toBeNull();
  });

  it("on the pilot staff is preselected because the judge path starts there (pre-R19)", async () => {
    vi.stubEnv("DEMO_MODE", "");
    const tree = (await SignInPage(props("staff"))) as ReactElement<{ initialRole: string | null }>;
    expect(tree.props.initialRole).toBe("staff");
  });

  it.each([
    ["staff", "staff"],
    ["supervisor", "supervisor"],
    ["owner", "owner"],
  ] as const)("?as=%s on pilot (no demo) renders that panel", async (as, expected) => {
    vi.stubEnv("DEMO_MODE", "");
    const tree = (await SignInPage(props(as))) as ReactElement<{ initialRole: string | null }>;
    expect(tree.props.initialRole).toBe(expected);
  });

  it.each([
    ["supervisor", "supervisor"],
    ["owner", "owner"],
  ] as const)("?as=%s on demo renders that panel (solo form)", async (as, expected) => {
    vi.stubEnv("DEMO_MODE", "true");
    const tree = (await SignInPage(props(as))) as ReactElement<{ initialRole: string | null }>;
    expect(tree.props.initialRole).toBe(expected);
  });

  it.each(["foo", "", "OWNER", "owner ", ["owner", "staff"]] as const)("E21: ?as=%j is ignored on pilot", async (as) => {
    vi.stubEnv("DEMO_MODE", "");
    const tree = (await SignInPage(props(as as string | string[]))) as ReactElement<{ initialRole: string | null }>;
    expect(tree.props.initialRole).toBeNull();
  });
});

describe("/sign-in demo redirects (demo-feedback-2 items 12/13/14)", () => {
  it("demo + no ?as redirects to /", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    await expect(async () => {
      await SignInPage(props());
    }).rejects.toThrow("REDIRECT_TO:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("demo + ?as=staff redirects to /pair", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    await expect(async () => {
      await SignInPage(props("staff"));
    }).rejects.toThrow("REDIRECT_TO:/pair");
    expect(mockRedirect).toHaveBeenCalledWith("/pair");
  });

  it("demo + ?as=invalid redirects to /", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    await expect(async () => {
      await SignInPage(props("invalid"));
    }).rejects.toThrow("REDIRECT_TO:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("demo + ?as=supervisor renders the solo form (no redirect)", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const tree = (await SignInPage(props("supervisor"))) as ReactElement<{ initialRole: string | null }>;
    expect(tree.type).toBe(SignInScreen);
    expect(tree.props.initialRole).toBe("supervisor");
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("demo + ?as=owner renders the solo form (no redirect)", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const tree = (await SignInPage(props("owner"))) as ReactElement<{ initialRole: string | null }>;
    expect(tree.type).toBe(SignInScreen);
    expect(tree.props.initialRole).toBe("owner");
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("pilot (no demo) has no redirects regardless of ?as", async () => {
    vi.stubEnv("DEMO_MODE", "");
    
    // no as
    const tree1 = (await SignInPage(props())) as ReactElement<{ initialRole: string | null }>;
    expect(tree1.type).toBe(SignInScreen);
    expect(mockRedirect).not.toHaveBeenCalled();
    mockRedirect.mockClear();

    // as=staff
    const tree2 = (await SignInPage(props("staff"))) as ReactElement<{ initialRole: string | null }>;
    expect(tree2.type).toBe(SignInScreen);
    expect(mockRedirect).not.toHaveBeenCalled();
    mockRedirect.mockClear();

    // as=supervisor
    const tree3 = (await SignInPage(props("supervisor"))) as ReactElement<{ initialRole: string | null }>;
    expect(tree3.type).toBe(SignInScreen);
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
