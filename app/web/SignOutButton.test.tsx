// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import type { Auth } from "firebase/auth";
import { SignOutButton } from "@/app/web/SignOutButton";

const signOut = vi.fn();
const replace = vi.fn();
vi.mock("@/lib/auth/client/firebase-client", () => ({
  signOut: (...args: unknown[]) => signOut(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

afterEach(() => {
  cleanup();
  signOut.mockReset();
  replace.mockClear();
});

function renderButton() {
  return render(
    <LangProvider initial="en">
      <SignOutButton auth={{} as Auth} />
    </LangProvider>,
  );
}

describe("SignOutButton", () => {
  it("signs out then navigates to /sign-in", async () => {
    signOut.mockResolvedValue(undefined);
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("still navigates when signOut rejects", async () => {
    signOut.mockRejectedValue(new Error("network"));
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
  });
});
