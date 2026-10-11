// @vitest-environment jsdom
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import type { DemoRole } from "@/lib/demo/contract";
import { createMemoryStorage } from "@/lib/demo/testing/memory-storage";
import { DEVICE_ID_KEY, DEVICE_TOKEN_KEY } from "@/lib/capture/browser/client";

/**
 * R-12 PR-B review fix 1 (QA): every credential change must END on the role's landing page, whatever a
 * still-mounted signed-in web page does on the way. This file uses the real startDemo / DemoBar / Landing
 * with a fake Firebase auth that tells a mounted page "signed out" (the redirect to /sign-in that
 * HomeApp, DayRecordApp, ... do) and "user changed" (DayRecordApp's history.replaceState), in three
 * delivery timings (sync, microtask, macrotask).
 */

const CONFIG: FirebaseWebConfig = { apiKey: "k", authDomain: "p.firebaseapp.com", projectId: "p", appId: "1:1:web:a" };
const KEY = "A".repeat(43);
const LANDING: Record<DemoRole, string> = { staff: "/capture", supervisor: "/day", owner: "/home" };
const ROLES: DemoRole[] = ["staff", "supervisor", "owner"];

const h = vi.hoisted(() => {
  const state = { uid: null as string | null, timing: "microtask" as "sync" | "microtask" | "macrotask", pathname: "/" };
  const listeners = new Set<(uid: string | null) => void>();
  const nav: Array<{ via: string; path: string }> = [];
  function emit() {
    const uid = state.uid;
    for (const l of [...listeners]) {
      if (state.timing === "sync") l(uid);
      else if (state.timing === "microtask") queueMicrotask(() => l(uid));
      else setTimeout(() => l(uid), 0);
    }
  }
  return { state, listeners, nav, emit };
});

vi.mock("next/navigation", () => ({
  usePathname: () => h.state.pathname,
  useRouter: () => ROUTER,
}));
const ROUTER = {
  push: (path: string) => void h.nav.push({ via: "router.push", path }),
  replace: (path: string) => void h.nav.push({ via: "router.replace", path }),
};

const AUTH = { kind: "fake-auth" };
vi.mock("@/lib/auth/client/firebase-client", () => ({
  getClientAuth: () => AUTH,
  signOut: async () => {
    h.state.uid = null;
    h.emit();
  },
  signInWithCustomToken: async (_auth: unknown, token: string) => {
    h.state.uid = token;
    h.emit();
  },
}));

import { DemoBar } from "@/app/demo/DemoBar";
import { Landing } from "@/app/demo/Landing";
import { DEMO_STATE_KEY } from "@/app/demo/demo-client";

/** What HomeApp / DayRecordApp / ... do while mounted: bounce to /sign-in on signed_out, re-sync the URL on a new user. */
function MountedWebPage() {
  useEffect(() => {
    let prev = h.state.uid;
    const l = (uid: string | null) => {
      if (prev !== null && uid === null) ROUTER.replace("/sign-in");
      else if (uid !== null && uid !== prev) queueMicrotask(() => h.nav.push({ via: "replaceState", path: "/day/2026-10-11" }));
      prev = uid;
    };
    h.listeners.add(l);
    return () => void h.listeners.delete(l);
  }, []);
  return null;
}

function sessionFor(role: DemoRole, expiresAtMs: number) {
  const base = { role, sandbox_key: KEY, expires_at_ms: expiresAtMs, landing_path: LANDING[role] };
  return role === "staff"
    ? { kind: "device", ...base, device_id: "jdg-1", device_token: "dev-token" }
    : { kind: "web", ...base, custom_token: `uid-${role}` };
}

let assign: ReturnType<typeof vi.fn>;
beforeEach(() => {
  h.nav.length = 0;
  h.listeners.clear();
  h.state.uid = null;
  vi.stubGlobal("localStorage", createMemoryStorage());
  assign = vi.fn((path: string) => void h.nav.push({ via: "assign", path }));
  vi.stubGlobal("location", { assign, pathname: "/", href: "http://localhost/" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_path: string, init: { body: string }) => {
      const { role } = JSON.parse(init.body) as { role: DemoRole };
      return new Response(JSON.stringify({ data: sessionFor(role, Date.now() + 2 * 3_600_000) }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  for (const m of ["log", "info", "warn", "error"]) vi.spyOn(console, m as "log").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const settle = () => new Promise((r) => setTimeout(r, 20));

function expectEndedOn(target: string, opts: { noRouterMovesAtAll: boolean }) {
  const assigns = h.nav.filter((n) => n.via === "assign");
  expect(assigns).toEqual([{ via: "assign", path: target }]);
  const at = h.nav.findIndex((n) => n.via === "assign");
  expect(h.nav.some((n) => n.via === "router.push")).toBe(false);
  const lateRouter = h.nav.slice(at + 1).filter((n) => n.via.startsWith("router."));
  expect(lateRouter).toEqual([]); // nothing the page does AFTER the hard navigation can win
  if (opts.noRouterMovesAtAll) expect(h.nav.filter((n) => n.via.startsWith("router."))).toEqual([]);
}

const SWITCHES: Array<[DemoRole, DemoRole]> = ROLES.flatMap((from) => ROLES.filter((to) => to !== from).map((to) => [from, to] as [DemoRole, DemoRole]));
const PATH_OF: Record<DemoRole, string> = { staff: "/capture", supervisor: "/day", owner: "/home" };
const LABEL: Record<DemoRole, string> = { staff: "Staff", supervisor: "Supervisor", owner: "Owner" };

describe("DemoBar role switch ends on the new role's landing page, whatever the mounted page does", () => {
  for (const timing of ["sync", "microtask", "macrotask"] as const) {
    describe(`auth listeners notified ${timing}`, () => {
      it.each(SWITCHES)("%s -> %s", async (from, to) => {
        h.state.timing = timing;
        h.state.pathname = PATH_OF[from];
        h.state.uid = from === "staff" ? null : `uid-${from}`;
        window.localStorage.setItem(DEMO_STATE_KEY, JSON.stringify({ sandbox_key: KEY, expires_at_ms: Date.now() + 3_600_000, role: from }));
        if (from === "staff") {
          window.localStorage.setItem(DEVICE_TOKEN_KEY, "old-token");
          window.localStorage.setItem(DEVICE_ID_KEY, "old-id");
        }
        render(
          <LangProvider initial="en">
            <MountedWebPage />
            <DemoBar config={CONFIG} />
          </LangProvider>,
        );
        fireEvent.click(screen.getByRole("button", { name: `Switch to ${LABEL[to]}` }));
        await waitFor(() => expect(assign).toHaveBeenCalled());
        await settle();
        // From a signed-in web user to another web user there is no signed-out moment at all.
        expectEndedOn(LANDING[to], { noRouterMovesAtAll: from !== "staff" && to !== "staff" });
        expect(JSON.parse(window.localStorage.getItem(DEMO_STATE_KEY)!).role).toBe(to);
      });
    });
  }
});

describe("Landing Try-as buttons end on the role's landing page", () => {
  for (const timing of ["sync", "microtask", "macrotask"] as const) {
    it.each(ROLES)(`Try as %s (listeners ${timing})`, async (role) => {
      h.state.timing = timing;
      h.state.pathname = "/";
      render(
        <LangProvider initial="en">
          <MountedWebPage />
          <Landing config={CONFIG} />
        </LangProvider>,
      );
      fireEvent.click(screen.getByRole("button", { name: `Try as ${LABEL[role]}` }));
      await waitFor(() => expect(assign).toHaveBeenCalled());
      await settle();
      expectEndedOn(LANDING[role], { noRouterMovesAtAll: true });
    });
  }
});
