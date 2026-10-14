// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import { createMemoryStorage } from "@/lib/demo/testing/memory-storage";
import { axeViolations } from "@/lib/testing/axe";
import { PAIR_CODE_FILL_EVENT, PairForm } from "@/app/pair/PairForm";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const PAIR_OK = { data: { device_token: "tok-1", device_id: "dev-1", outlet_id: "outlet-7" } };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => void vi.stubGlobal("localStorage", createMemoryStorage()));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderForm(props: Parameters<typeof PairForm>[0] = {}, lang: "en" | "id" = "en") {
  return render(
    <LangProvider initial={lang}>
      <PairForm {...props} />
    </LangProvider>,
  );
}
const input = () => screen.getByLabelText("6-digit code") as HTMLInputElement;
const submitButton = () => screen.getByRole("button", { name: "Set up" }) as HTMLButtonElement;
function submit(code: string) {
  fireEvent.change(input(), { target: { value: code } });
  fireEvent.click(submitButton());
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
    expect(input().getAttribute("aria-describedby")).toContain(screen.getByRole("alert").id);
    expect(input().value).toBe("123456"); // digits kept
  });

  it("starts with an initial code when given one", () => {
    renderForm({ initialCode: "000000" });
    expect(input().value).toBe("000000");
  });

  describe("Set up this device states (R-19 PR-6 §8.1)", () => {
    it("empty: one numeric one-time-code input, six visual boxes, the button disabled with the 'all 6 digits' hint", () => {
      renderForm();
      const field = input();
      expect(field.getAttribute("inputmode")).toBe("numeric");
      expect(field.getAttribute("autocomplete")).toBe("one-time-code");
      expect(field.maxLength).toBe(6);
      expect(screen.getAllByTestId("pair-box")).toHaveLength(6);
      expect(submitButton().disabled).toBe(true);
      expect(screen.getByText("Enter all 6 digits to set up.")).toBeTruthy();
    });

    it("filled: the boxes mirror the digits, the hint goes away and the button enables", () => {
      renderForm();
      fireEvent.change(input(), { target: { value: "12a3" } });
      expect(input().value).toBe("123"); // non-digits dropped
      expect(screen.getAllByTestId("pair-box").map((b) => b.textContent)).toEqual(["1", "2", "3", "", "", ""]);
      expect(submitButton().disabled).toBe(true);
      fireEvent.change(input(), { target: { value: "123456" } });
      expect(screen.getAllByTestId("pair-box").map((b) => b.textContent)).toEqual(["1", "2", "3", "4", "5", "6"]);
      expect(submitButton().disabled).toBe(false);
      expect(screen.queryByText("Enter all 6 digits to set up.")).toBeNull();
    });

    it("submitting: the form is aria-busy and the button says Setting up…", async () => {
      let release!: (r: Response) => void;
      vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => (release = r))));
      renderForm();
      submit("123456");
      expect(input().closest("form")!.getAttribute("aria-busy")).toBe("true");
      expect((screen.getByRole("button", { name: "Setting up…" }) as HTMLButtonElement).disabled).toBe(true);
      await act(async () => release(json(PAIR_OK)));
      expect(input().closest("form")!.getAttribute("aria-busy")).toBe("false");
    });

    it("network: the connection line, digits kept, button enabled again", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("down"))));
      renderForm();
      submit("123456");
      await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("No connection."));
      expect(input().value).toBe("123456");
      expect(submitButton().disabled).toBe(false);
    });

    it(`a ${PAIR_CODE_FILL_EVENT} window event fills the field without submitting (the judge guide's Fill in, PR-5)`, () => {
      vi.stubGlobal("fetch", vi.fn());
      renderForm();
      act(() => {
        window.dispatchEvent(new CustomEvent(PAIR_CODE_FILL_EVENT, { detail: { code: "12-34 56" } }));
      });
      expect(input().value).toBe("123456");
      expect(submitButton().disabled).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("is in Bahasa when the language says so", () => {
      renderForm({}, "id");
      expect(screen.getByLabelText("Kode 6 digit")).toBeTruthy();
      expect(screen.getByText("Isi 6 digit untuk bisa memasang.")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Pasang" })).toBeTruthy();
    });

    it("axe finds no violation, empty and refused", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => json({ error: { code: "UNAUTHORIZED" } }, 401)));
      const { container } = renderForm();
      expect(await axeViolations(container)).toEqual([]);
      submit("123456");
      await screen.findByRole("alert");
      expect(await axeViolations(container)).toEqual([]);
    });
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
      expect(submitButton().disabled).toBe(false);
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
      expect(submitButton().disabled).toBe(false);
    });
  });
});
