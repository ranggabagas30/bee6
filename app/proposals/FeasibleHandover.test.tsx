// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FeasibleActions, FeasibleHandover } from "@/app/proposals/FeasibleHandover";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

const signOut = vi.fn();
vi.mock("@/lib/auth/client/firebase-client", () => ({
  signOut: (...args: unknown[]) => signOut(...args),
}));

const AUTH = { kind: "fake-auth" } as unknown as import("@/lib/auth/client/firebase-client").Auth;

afterEach(() => {
  cleanup();
  replace.mockReset();
  signOut.mockReset();
});

describe("FeasibleHandover (D2-03g)", () => {
  it("announces 'Marked feasible. The owner decides next. Sign out and pick Owner…' and takes focus so the answer is read out", () => {
    render(<FeasibleHandover lang="en" />);
    const banner = screen.getByRole("status");
    expect(banner.textContent).toContain("Marked feasible.");
    expect(banner.textContent).toContain("The owner decides next.");
    expect(banner.textContent).toContain("Sign out and pick Owner to approve or reject.");
    expect(document.activeElement).toBe(banner);
  });

  it("never names who marked it or who the owner is", () => {
    const { container } = render(<FeasibleHandover lang="id" />);
    expect(screen.getByText("Ditandai layak.", { exact: false })).not.toBeNull();
    expect(container.textContent).not.toMatch(/@|device/i);
  });
});

describe("FeasibleActions (D2-03g)", () => {
  it("the done look is not a live control; Sign out · pick Owner signs out and opens the Owner tab", async () => {
    signOut.mockResolvedValue(undefined);
    render(<FeasibleActions lang="en" auth={AUTH} />);
    expect((screen.getByRole("button", { name: "Marked feasible ✓" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Sign out · pick Owner" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in?as=owner"));
    expect(signOut).toHaveBeenCalledWith(AUTH);
  });

  it("still leaves the screen when the sign-out call rejects (best effort, like the top bar)", async () => {
    signOut.mockRejectedValue(new Error("offline"));
    render(<FeasibleActions lang="en" auth={AUTH} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out · pick Owner" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in?as=owner"));
  });

  it("ID copy", () => {
    render(<FeasibleActions lang="id" auth={AUTH} />);
    expect(screen.getByRole("button", { name: "Ditandai layak ✓" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Keluar · pilih Pemilik" })).not.toBeNull();
  });
});
