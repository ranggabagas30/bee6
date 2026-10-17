// @vitest-environment jsdom
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

// The real bar is loaded lazily and only in the browser; what wraps it is what is under test.
vi.mock("next/dynamic", () => ({ default: () => () => <aside data-testid="bar" /> }));

import { DemoBarLoader } from "@/app/demo/DemoBarLoader";

afterEach(() => cleanup());

// R-25 R6: the bar is headless, so the slot that held its room (R-19 PR-5, CLS) is gone.
describe("DemoBarLoader (R-25 R6: no slot, no reserved room)", () => {
  it("renders the lazily loaded bar and nothing around it", () => {
    const { container, getByTestId } = render(<DemoBarLoader config={null} />);
    expect(container.firstElementChild).toBe(getByTestId("bar"));
    expect(container.children).toHaveLength(1);
  });

  it("the server render holds no room: no slot element and no reserve class", () => {
    const html = renderToString(<DemoBarLoader config={null} />);
    expect(html).not.toContain("b6-topbar");
  });
});
