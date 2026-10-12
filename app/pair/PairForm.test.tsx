// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import { createMemoryStorage } from "@/lib/demo/testing/memory-storage";
import { PairForm } from "@/app/pair/PairForm";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const PAIR_OK = { data: { device_token: "tok-1", device_id: "dev-1", outlet_id: "outlet-7" } };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => void vi.stubGlobal("localStorage", createMemoryStorage()));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderForm(props: Parameters<typeof PairForm>[0] = {}) {
  return render(
    <LangProvider initial="en">
      <PairForm {...props} />
    </LangProvider>,
  );
}
const input = () => screen.getByLabelText("6-digit code") as HTMLInputElement;
function submit(code: string) {
  fireEvent.change(input(), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: "Set up" }));
}

describe("PairForm", () => {
  it("posts the code, stores the device keys and hands the outlet and device auth to onPaired", async () => {
    const fetchMock = vi.fn(async () => json(PAIR_OK));
    vi.stubGlobal("fetch", fetchMock);
    const onPaired = vi.fn();
    renderForm({ onPaired });
    submit("123456");
    await waitFor(() => expect(onPaired).toHaveBeenCalledTimes(1));
    expect(onPaired).toHaveBeenCalledWith({ outletId: "outlet-7", auth: { deviceToken: "tok-1", deviceId: "dev-1" } });
    expect(window.localStorage.getItem("bee6.device_token")).toBe("tok-1");
    expect(window.localStorage.getItem("bee6.device_id")).toBe("dev-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/devices/pair", expect.objectContaining({ method: "POST", body: JSON.stringify({ code: "123456" }) }));
  });

  it("shows the mapped error line and does not call onPaired on a refusal", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { code: "UNAUTHORIZED" } }, 401)));
    const onPaired = vi.fn();
    renderForm({ onPaired });
    submit("123456");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Code not recognized"));
    expect(onPaired).not.toHaveBeenCalled();
  });

  it("starts with an initial code when given one", () => {
    renderForm({ initialCode: "000000" });
    expect(input().value).toBe("000000");
  });

  describe("demoIntercept (R-18 P1)", () => {
    it("is asked first with the typed code; when it handles the code the pair route is never called", async () => {
      const fetchMock = vi.fn(async () => json(PAIR_OK));
      vi.stubGlobal("fetch", fetchMock);
      const demoIntercept = vi.fn(async () => true);
      const onPaired = vi.fn();
      renderForm({ demoIntercept, onPaired });
      submit("000000");
      await waitFor(() => expect(demoIntercept).toHaveBeenCalledWith("000000"));
      await act(async () => {});
      expect(fetchMock).not.toHaveBeenCalled();
      expect(onPaired).not.toHaveBeenCalled();
      expect(window.localStorage.getItem("bee6.device_token")).toBeNull();
    });

    it("falls through to the real pair route when it does not handle the code", async () => {
      const fetchMock = vi.fn(async () => json(PAIR_OK));
      vi.stubGlobal("fetch", fetchMock);
      const demoIntercept = vi.fn(async () => false);
      const onPaired = vi.fn();
      renderForm({ demoIntercept, onPaired });
      submit("123456");
      await waitFor(() => expect(onPaired).toHaveBeenCalled());
      expect(demoIntercept).toHaveBeenCalledWith("123456");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("an intercept that throws falls through to the real path rather than wedging the form", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => json({ error: { code: "UNAUTHORIZED" } }, 401)));
      renderForm({ demoIntercept: async () => Promise.reject(new Error("boom")) });
      submit("123456");
      await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Code not recognized"));
      expect((screen.getByRole("button", { name: "Set up" }) as HTMLButtonElement).disabled).toBe(false);
    });

    it("keeps the button busy while the intercept runs, and ignores a second submit", async () => {
      vi.stubGlobal("fetch", vi.fn());
      let release!: (v: boolean) => void;
      const demoIntercept = vi.fn(() => new Promise<boolean>((r) => (release = r)));
      renderForm({ demoIntercept });
      submit("000000");
      const form = input().closest("form")!;
      expect((screen.getByRole("button", { name: "Setting up…" }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.submit(form);
      expect(demoIntercept).toHaveBeenCalledTimes(1);
      await act(async () => release(true));
      expect((screen.getByRole("button", { name: "Set up" }) as HTMLButtonElement).disabled).toBe(false);
    });
  });
});
