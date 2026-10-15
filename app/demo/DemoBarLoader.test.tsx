// @vitest-environment jsdom
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { declarations, parseCss, readGlobalsCss, ruleDeclarations } from "@/lib/testing/css";

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
    // two lines tall on a phone, one line from 500 px up (see the D2 test below for where that line is drawn)
    expect(ruleDeclarations(css, ".b6-topbar-reserved .b6-topbar-slot--reserve")["min-height"]).toBe("54px");
    const media = parseCss(css).find((r) => r.prelude === "@media (min-width: 500px)");
    expect(media).toBeDefined();
    const wide = media!.children.find((c) => c.prelude === ".b6-topbar-reserved .b6-topbar-slot--reserve");
    expect(wide?.body.replace(/\s+/g, "")).toBe("min-height:36px;");
    expect(parseCss(css).find((r) => r.prelude === "@media (min-width: 431px)")).toBeUndefined();
  });

  // Round-3 D2: the slot was 54 px on a phone while a one-line bar was 36 px, leaving an 18 px empty strip under
  // it (owner EN at 360-430, supervisor EN at 390-430, owner ID at 430). The bar now has the SAME deterministic
  // height as the slot at every width (two-line tall below 500 px, one-line from 500 px), its text centred, so
  // bar height == slot height for every role, language and width: no strip, no shift. The one-line band starts
  // at 500 px because the longest line (ID supervisor, 392 px in the inherited serif) must fit beside the 8 px
  // body margin most pages keep, the bar's 2 x 16 px padding and a classic 15 px scrollbar (the earlier 431 px
  // line wrapped it on /sign-in and the web pages); above it the line may never wrap (ellipsis), so no fallback
  // font can make the bar taller than its slot.
  it("the bar itself is as tall as the slot at every width (54 px below 500 px, 36 px from 500 px), text centred vertically, one line kept one line", () => {
    const bar = ruleDeclarations(css, ".b6-topbar");
    expect(bar["min-height"]).toBe("54px");
    expect(bar["box-sizing"]).toBe("border-box");
    expect(bar["display"]).toBe("flex");
    expect(bar["flex-direction"]).toBe("column");
    expect(bar["justify-content"]).toBe("center");
    const media = parseCss(css).find((r) => r.prelude === "@media (min-width: 500px)");
    const wide = media!.children.find((c) => c.prelude === ".b6-topbar");
    expect(wide?.body.replace(/\s+/g, "")).toBe("min-height:36px;");
    // one breakpoint for both, so they can never disagree
    const slotRule = media!.children.find((c) => c.prelude === ".b6-topbar-reserved .b6-topbar-slot--reserve");
    expect(slotRule?.body.replace(/\s+/g, "")).toBe(wide?.body.replace(/\s+/g, ""));
    const line = media!.children.find((c) => c.prelude === ".b6-topbar > p");
    const decls = Object.fromEntries(declarations(line!.body));
    expect(decls).toEqual({ overflow: "hidden", "white-space": "nowrap", "text-overflow": "ellipsis" });
    // below the band the text may wrap (two lines fit in 54 px): no nowrap at the top level
    expect(ruleDeclarations(css, ".b6-topbar > p")).toEqual({});
  });
});
