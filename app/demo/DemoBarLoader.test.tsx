// @vitest-environment jsdom
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { parseCss, readGlobalsCss, ruleDeclarations } from "@/lib/testing/css";

let pathname = "/day";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
// The real bar is loaded lazily and only in the browser; the slot around it is what is under test.
vi.mock("next/dynamic", () => ({ default: () => () => <aside data-testid="bar" /> }));

import { DemoBarLoader } from "@/app/demo/DemoBarLoader";

afterEach(() => cleanup());

describe("DemoBarLoader slot (R-19 PR-5, CLS)", () => {
  it("renders on the server a slot that reserves the bar's space, so the bar mounting after hydration does not push the page down", () => {
    pathname = "/day";
    const html = renderToString(<DemoBarLoader config={null} />);
    expect(html).toContain("b6-topbar-slot");
    expect(html).toContain("b6-topbar-slot--reserve");
  });

  it.each(["/day", "/home", "/questions", "/sop", "/reviews", "/proposals", "/sign-in", "/pair"])("reserves the space on %s", (p) => {
    pathname = p;
    const { container } = render(<DemoBarLoader config={null} />);
    expect(container.querySelector(".b6-topbar-slot--reserve")).not.toBeNull();
  });

  it("reserves nothing on / where the bar hides itself", () => {
    pathname = "/";
    const { container } = render(<DemoBarLoader config={null} />);
    const slot = container.querySelector(".b6-topbar-slot");
    expect(slot).not.toBeNull();
    expect(slot!.classList.contains("b6-topbar-slot--reserve")).toBe(false);
  });

  it("keeps the bar inside the slot", () => {
    pathname = "/day";
    const { container, getByTestId } = render(<DemoBarLoader config={null} />);
    expect(container.querySelector(".b6-topbar-slot")!.contains(getByTestId("bar"))).toBe(true);
  });
});

describe("demo slot CSS contract", () => {
  const css = readGlobalsCss();

  it("reserves a bar's height only while this browser holds a demo state (class on <html>, set before first paint)", () => {
    expect(ruleDeclarations(css, ".b6-topbar-slot")["min-height"]).toBeUndefined();
    expect(ruleDeclarations(css, ".b6-topbar-slot--reserve")["min-height"]).toBeUndefined();
    // two lines on a phone (the bar's text wraps below ~430 px), one line wider than that
    expect(ruleDeclarations(css, ".b6-topbar-reserved .b6-topbar-slot--reserve")["min-height"]).toBe("54px");
    const media = parseCss(css).find((r) => r.prelude === "@media (min-width: 431px)");
    expect(media).toBeDefined();
    const wide = media!.children.find((c) => c.prelude === ".b6-topbar-reserved .b6-topbar-slot--reserve");
    expect(wide?.body.replace(/\s+/g, "")).toBe("min-height:36px;");
  });
});
