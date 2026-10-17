// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Stage, type StageTone } from "@/app/ui/Stage";
import { axeViolations } from "@/lib/testing/axe";
import { parseCss, readGlobalsCss, ruleDeclarations } from "@/lib/testing/css";

afterEach(() => cleanup());
const css = readGlobalsCss();
const root = (c: HTMLElement) => c.firstElementChild as HTMLElement;

describe("Stage", () => {
  it.each(["idle", "listening", "amber", "done"] as StageTone[])("renders the %s tone: decorative, with a glow, a shell and an orb", (tone) => {
    const { container } = render(<Stage tone={tone} />);
    const el = root(container);
    expect(el.className).toContain("b6-stage");
    expect(el.className).toContain(`b6-stage--${tone}`);
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.querySelector(".b6-stage__glow")).not.toBeNull();
    expect(el.querySelector(".b6-orb-shell")).not.toBeNull();
    expect(el.querySelector(".b6-orb")).not.toBeNull();
    expect(el.textContent).toBe("");
  });

  it("the listening orb has the seven wave bars and the ping ring; the other tones have neither", () => {
    const listening = render(<Stage tone="listening" />).container;
    expect(listening.querySelectorAll(".b6-orb__wave .b6-orb__bar")).toHaveLength(7);
    expect(listening.querySelector(".b6-orb-ping")).not.toBeNull();
    cleanup();
    for (const tone of ["idle", "amber", "done"] as StageTone[]) {
      const c = render(<Stage tone={tone} />).container;
      expect(c.querySelector(".b6-orb__wave"), tone).toBeNull();
      expect(c.querySelector(".b6-orb-ping"), tone).toBeNull();
      cleanup();
    }
  });

  it("the orb label is the only text, and only when given", () => {
    const { container } = render(<Stage tone="idle" label="Start" />);
    expect(container.querySelector(".b6-orb__label")?.textContent).toBe("Start");
  });

  it("animated=false adds no animation class; the default is animated", () => {
    expect(root(render(<Stage tone="listening" animated={false} />).container).className).not.toContain("b6-stage--animated");
    cleanup();
    expect(root(render(<Stage tone="listening" />).container).className).toContain("b6-stage--animated");
  });

  it("is 290px tall with a 176px orb in a 206px shell", () => {
    expect(ruleDeclarations(css, ".b6-stage")["height"]).toBe("290px");
    expect(ruleDeclarations(css, ".b6-orb")["width"]).toBe("176px");
    expect(ruleDeclarations(css, ".b6-orb-shell")["width"]).toBe("206px");
  });

  it("every animation lives inside prefers-reduced-motion: no-preference and only under the animated class", () => {
    const rules = parseCss(css);
    const gated = rules.find((r) => r.prelude === "@media (prefers-reduced-motion: no-preference)");
    expect(gated).toBeTruthy();
    const animated = gated!.children.filter((r) => /animation/.test(r.body));
    expect(animated.length).toBeGreaterThanOrEqual(4);
    for (const r of animated) expect(r.prelude, r.prelude).toContain(".b6-stage--animated");
    // nothing outside that block animates the stage
    for (const r of rules) {
      if (r.prelude.startsWith("@")) continue;
      if (/\.b6-(stage|orb)/.test(r.prelude)) expect(r.body, r.prelude).not.toMatch(/animation/);
    }
    for (const name of ["b6-breathe", "b6-ping", "b6-wave", "b6-spin"]) {
      expect(rules.some((r) => r.prelude === `@keyframes ${name}`), name).toBe(true);
    }
  });

  it("has no axe violations in any tone", async () => {
    const { container } = render(
      <main>
        {(["idle", "listening", "amber", "done"] as StageTone[]).map((t) => (
          <Stage key={t} tone={t} label={t === "idle" ? "Start" : undefined} />
        ))}
        <h1>Listening</h1>
      </main>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
