// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Auth, User } from "firebase/auth";
import { useAuthUser } from "@/lib/auth/client/use-auth-user";

/**
 * R-06 Task 4.4. Subscribes with `onAuthStateChanged` in an effect and
 * unsubscribes on unmount; `authStateReady()` is deliberately not used.
 */

const unsubscribe = vi.fn();
const onAuthStateChanged = vi.fn();
vi.mock("firebase/auth", () => ({
  onAuthStateChanged: (...args: unknown[]) => onAuthStateChanged(...args),
}));

afterEach(() => {
  vi.clearAllMocks();
});

function fakeAuth(): Auth {
  return {} as unknown as Auth;
}

describe("useAuthUser", () => {
  it("starts as loading, then signed_out when onAuthStateChanged fires with null", () => {
    let capturedCallback: ((user: User | null) => void) | undefined;
    onAuthStateChanged.mockImplementation((_auth: Auth, cb: (user: User | null) => void) => {
      capturedCallback = cb;
      return unsubscribe;
    });

    const { result } = renderHook(() => useAuthUser(fakeAuth()));
    expect(result.current).toEqual({ status: "loading" });

    act(() => {
      capturedCallback?.(null);
    });
    expect(result.current).toEqual({ status: "signed_out" });
  });

  it("becomes signed_in with the user when onAuthStateChanged fires with a user", () => {
    let capturedCallback: ((user: User | null) => void) | undefined;
    onAuthStateChanged.mockImplementation((_auth: Auth, cb: (user: User | null) => void) => {
      capturedCallback = cb;
      return unsubscribe;
    });
    const fakeUser = { uid: "u1" } as unknown as User;

    const { result } = renderHook(() => useAuthUser(fakeAuth()));
    act(() => {
      capturedCallback?.(fakeUser);
    });
    expect(result.current).toEqual({ status: "signed_in", user: fakeUser });
  });

  it("returns signed_out immediately for a null auth, without subscribing", () => {
    const { result } = renderHook(() => useAuthUser(null));
    expect(result.current).toEqual({ status: "signed_out" });
    expect(onAuthStateChanged).not.toHaveBeenCalled();
  });

  it("unsubscribes on unmount", () => {
    onAuthStateChanged.mockImplementation(() => unsubscribe);
    const { unmount } = renderHook(() => useAuthUser(fakeAuth()));
    expect(unsubscribe).not.toHaveBeenCalled();
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
