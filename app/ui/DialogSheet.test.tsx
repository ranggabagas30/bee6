// @vitest-environment jsdom
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DialogSheet } from "@/app/ui/DialogSheet";
import { axeViolations } from "@/lib/testing/axe";
import { parseCss, readGlobalsCss, rootTokens, ruleDeclarations } from "@/lib/testing/css";

afterEach(() => cleanup());
const css = readGlobalsCss();

function Sample(props: { centred?: boolean; className?: string }) {
  return (
    <DialogSheet labelledBy="t" describedBy="b" {...props}>
      <h2 id="t" className="b6-dsheet__title">
        Sign out?
      </h2>
      <p id="b" className="b6-dsheet__body">
        Body text.
      </p>
      <button type="button">Stay</button>
    </DialogSheet>
  );
}

describe("DialogSheet", () => {
  it("is a modal dialog named by its title and described by its body", () => {
    render(<Sample />);
    const d = screen.getByRole("dialog", { name: "Sign out?" });
    expect(d.getAttribute("aria-modal")).toBe("true");
    expect(d.getAttribute("aria-describedby")).toBe("b");
    expect(d.className).toContain("b6-dsheet");
    expect(d.contains(screen.getByRole("button", { name: "Stay" }))).toBe(true);
  });

  it("sits in a dim backdrop; the grip is decoration", () => {
    const { container } = render(<Sample />);
    const backdrop = container.firstElementChild as HTMLElement;
    expect(backdrop.className).toContain("b6-dsheet-backdrop");
    expect(backdrop.contains(screen.getByRole("dialog"))).toBe(true);
    expect(container.querySelector(".b6-dsheet__grip")?.getAttribute("aria-hidden")).toBe("true");
    expect(ruleDeclarations(css, ".b6-dsheet-backdrop")["background"]).toBe("var(--b6-scrim)");
    expect(rootTokens(css)["--b6-scrim"]).toBe("rgba(43, 42, 38, 0.42)");
  });

  it("layers above the guide sheet and side panel", () => {
    expect(ruleDeclarations(css, ".b6-dsheet-backdrop")["z-index"]).toBe("var(--b6-z-dialog)");
  });

  it("is a bottom sheet on a phone (24px top radius, 14/24/28 padding) and a centred 460px card from 900px", () => {
    const base = ruleDeclarations(css, ".b6-dsheet");
    expect(base["border-radius"]).toBe("var(--b6-r-sheet) var(--b6-r-sheet) 0 0");
    expect(base["padding"]).toBe("14px 24px 28px");
    expect(base["width"]).toBe("100%");
    const wide = parseCss(css).find((r) => r.prelude === "@media (min-width: 900px)" && r.children.some((c) => c.prelude === ".b6-dsheet"));
    expect(wide).toBeTruthy();
    const card = wide!.children.find((c) => c.prelude === ".b6-dsheet")!.body;
    expect(card).toContain("max-width: 460px");
    expect(card).toContain("border-radius: 22px");
    expect(ruleDeclarations(css, ".b6-dsheet--centred")["max-width"]).toBe("460px");
  });

  it("`centred` adds the centred modifier at every width", () => {
    render(<Sample centred className="mine" />);
    const d = screen.getByRole("dialog");
    expect(d.className).toContain("b6-dsheet--centred");
    expect(d.className).toContain("mine");
  });

  it("passes a ref and div props to the dialog element so the caller can focus the container", () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <DialogSheet labelledBy="t" ref={ref} tabIndex={-1} data-testid="dlg">
        <h2 id="t">Title</h2>
      </DialogSheet>,
    );
    const d = screen.getByRole("dialog");
    expect(ref.current).toBe(d);
    expect(d.getAttribute("tabindex")).toBe("-1");
    expect(d.getAttribute("data-testid")).toBe("dlg");
    expect(d.getAttribute("aria-modal")).toBe("true");
    ref.current?.focus();
    expect(document.activeElement).toBe(d);
  });

  it("holds no focus logic: it does not move focus by itself (the caller owns the trap)", () => {
    render(<Sample />);
    expect(document.activeElement).toBe(document.body);
  });

  it("has no axe violations", async () => {
    const { container } = render(<Sample />);
    expect(await axeViolations(container)).toEqual([]);
  });
});
