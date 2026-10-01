// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { DevPanel } from "@/app/capture/DevPanel";

afterEach(() => cleanup());

describe("DevPanel", () => {
  it("renders a labelled container", () => {
    const { container } = render(<DevPanel />);
    const panel = container.querySelector('[data-testid="dev-panel"]');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toMatch(/developer/i);
  });
});
