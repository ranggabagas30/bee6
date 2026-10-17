// @vitest-environment jsdom
import { useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { clearPairDone, publishPairDone, usePairBridge } from "@/app/demo/guide-bridge";

/** R-25 R12: what /pair does (publish on mount, clean up on unmount) and what the guide does (read the hook). */
function Guide() {
  return <p data-testid="guide">{usePairBridge() ? "paired" : "unpaired"}</p>;
}
function PairedChecklist() {
  useEffect(() => publishPairDone(), []);
  return null;
}

afterEach(() => {
  cleanup();
  clearPairDone();
});

describe("usePairBridge", () => {
  it("is false until the paired checklist mounts, true while it is on screen, false again once it unmounts", () => {
    render(<Guide />);
    expect(screen.getByTestId("guide").textContent).toBe("unpaired");
    const checklist = render(<PairedChecklist />);
    expect(screen.getByTestId("guide").textContent).toBe("paired");
    checklist.unmount();
    expect(screen.getByTestId("guide").textContent).toBe("unpaired");
  });

  it("follows clearPairDone (the guide drops a stale signal when the route leaves /pair)", () => {
    render(<Guide />);
    act(() => void publishPairDone());
    expect(screen.getByTestId("guide").textContent).toBe("paired");
    act(() => clearPairDone());
    expect(screen.getByTestId("guide").textContent).toBe("unpaired");
  });
});
