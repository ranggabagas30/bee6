// @vitest-environment jsdom
import { useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { clearSignInRole, publishSignInRole, readSignInRole, useSignInBridge } from "@/app/demo/guide-bridge";
import type { SignInGuideRole } from "@/lib/demo/guide";

/** Demo feedback 2, finding 4: what DemoAccess does (publish its role, clean up on unmount) and what the guide does (read the hook). */
function Guide() {
  return <p data-testid="guide">{useSignInBridge() ?? "none"}</p>;
}
function Panel({ role }: { role: SignInGuideRole }) {
  useEffect(() => publishSignInRole(role), [role]);
  return null;
}

afterEach(() => {
  cleanup();
  clearSignInRole();
});

describe("useSignInBridge", () => {
  it("is null until the sign-in panel mounts, its role while it is on screen, null again once it unmounts", () => {
    render(<Guide />);
    expect(screen.getByTestId("guide").textContent).toBe("none");
    const panel = render(<Panel role="supervisor" />);
    expect(screen.getByTestId("guide").textContent).toBe("supervisor");
    panel.unmount();
    expect(screen.getByTestId("guide").textContent).toBe("none");
  });

  it("follows a role change in place (the tab moves from supervisor to owner)", () => {
    render(<Guide />);
    const panel = render(<Panel role="supervisor" />);
    panel.rerender(<Panel role="owner" />);
    expect(screen.getByTestId("guide").textContent).toBe("owner");
  });

  it("follows clearSignInRole (the guide drops a stale signal when the route leaves /sign-in)", () => {
    render(<Guide />);
    act(() => void publishSignInRole("owner"));
    expect(screen.getByTestId("guide").textContent).toBe("owner");
    expect(readSignInRole()).toBe("owner");
    act(() => clearSignInRole());
    expect(screen.getByTestId("guide").textContent).toBe("none");
    expect(readSignInRole()).toBeNull();
  });
});
