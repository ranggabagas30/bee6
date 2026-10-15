// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import type { AuthUserState } from "@/lib/auth/client/use-auth-user";
import type { SopChangeView, SopOverview } from "@/lib/sop/contract";
import { SopApp } from "@/app/sop/SopApp";

const CONFIG: FirebaseWebConfig = {
  apiKey: "key-1",
  authDomain: "proj.firebaseapp.com",
  projectId: "proj",
  appId: "1:1:web:abc",
};

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const getClientAuth = vi.fn();
const signOut = vi.fn();
vi.mock("@/lib/auth/client/firebase-client", () => ({
  getClientAuth: (...args: unknown[]) => getClientAuth(...args),
  signOut: (...args: unknown[]) => signOut(...args),
}));

let authUserState: AuthUserState = { status: "signed_out" };
vi.mock("@/lib/auth/client/use-auth-user", () => ({ useAuthUser: () => authUserState }));

const authedGetJson = vi.fn();
vi.mock("@/lib/auth/client/api", () => ({
  authedGetJson: (...args: unknown[]) => authedGetJson(...args),
}));

const FAKE_AUTH = { kind: "fake-auth" };
const getIdTokenResult = vi.fn();
const FAKE_USER = { uid: "u1", getIdTokenResult };

const step = (id: string, role: "staff" | "supervisor" | "owner" = "staff") => ({
  step_id: id,
  title: `Title ${id}`,
  text: `Text ${id}`,
  role,
});
const changeView = (version: number, overrides: Partial<SopChangeView> = {}): SopChangeView => ({
  version,
  previous_version: version - 1,
  effective_from_date: "2026-10-16",
  approved_date: "2026-10-15",
  kind: "modify",
  before: step("stock-01"),
  after: { ...step("stock-01"), text: `New text v${version}` },
  change_title: `Change title v${version}`,
  metric: { category: "CUSTOMER_SERVICE", direction: "decrease", description: "d", baseline_count: 3, baseline_days: 7 },
  failure_condition: "f",
  review_date: "2026-10-23",
  outcome: null,
  ...overrides,
});
const overview = (o: Partial<SopOverview> = {}): SopOverview => ({
  today: "2026-10-15",
  latest: { version: 1, effective_from_date: null, steps: [step("a-01"), step("b-01", "supervisor")] },
  in_force_version: 1,
  first_version_date: "2026-10-05",
  changes: [],
  ...o,
});

beforeEach(() => {
  authUserState = { status: "signed_in", user: FAKE_USER } as unknown as AuthUserState;
  getClientAuth.mockReturnValue(FAKE_AUTH);
  getIdTokenResult.mockResolvedValue({ claims: { role: "owner" } });
  authedGetJson.mockResolvedValue({ kind: "ok", data: overview() });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderApp() {
  return render(
    <LangProvider initial="en">
      <SopApp config={CONFIG} />
    </LangProvider>,
  );
}

describe("SopApp header", () => {
  it("5.T4 seed only shows 'Version 1'", async () => {
    renderApp();
    await screen.findByText("Version 1");
  });

  it("5.T4 v2 in force shows 'Version 2, in force since ...'", async () => {
    authedGetJson.mockResolvedValue({
      kind: "ok",
      data: overview({
        latest: { version: 2, effective_from_date: "2026-10-16", steps: [step("a-01")] },
        in_force_version: 2,
        changes: [changeView(2)],
      }),
    });
    renderApp();
    await screen.findByText("Version 2, in force since Fri 16 Oct");
  });

  it("5.T4 v2 pending with no version switch shows when it starts and which version applies until then", async () => {
    // Version 2's change is not in the list, so only version 2 can be shown: no switch, so the pending line carries the date.
    authedGetJson.mockResolvedValue({
      kind: "ok",
      data: overview({
        latest: { version: 2, effective_from_date: "2026-10-16", steps: [step("a-01")] },
        in_force_version: 1,
        changes: [],
      }),
    });
    renderApp();
    await screen.findByText("Version 2 starts on Fri 16 Oct. Until then, version 1 applies.");
    expect(screen.queryByRole("group", { name: "SOP version" })).toBeNull();
  });

  it("v2 pending with a version switch hides the pending line: the switch already carries the date (board-literal)", async () => {
    authedGetJson.mockResolvedValue({
      kind: "ok",
      data: overview({
        latest: { version: 2, effective_from_date: "2026-10-16", steps: [step("a-01")] },
        in_force_version: 1,
        changes: [changeView(2)],
      }),
    });
    renderApp();
    const group = await screen.findByRole("group", { name: "SOP version" });
    expect(Array.from(group.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["05/10/26", "16/10/26 · current"]);
    expect(screen.queryByText(/starts on/)).toBeNull();
    expect(screen.queryByText(/Until then/)).toBeNull();
  });

  it("5.T4 no SOP shows the empty state (owner: with the upload-coming line) and no sections", async () => {
    authedGetJson.mockResolvedValue({ kind: "ok", data: overview({ latest: null, in_force_version: null }) });
    renderApp();
    await screen.findByText("No SOP yet.");
    expect(screen.getByText("Uploading an SOP is coming soon. The demo uses a ready-made SOP.")).not.toBeNull();
    expect(screen.queryByText("Changes")).toBeNull();
    expect(screen.queryByRole("heading", { name: /Steps in version/ })).toBeNull();
    expect(document.querySelector("ol")).toBeNull(); // the nav is a <ul>; the steps list is the only <ol>
  });
});

describe("SopApp sections", () => {
  it("5.T5 changes render newest first, and the latest steps list shows each step with its role", async () => {
    authedGetJson.mockResolvedValue({
      kind: "ok",
      data: overview({
        latest: { version: 3, effective_from_date: "2026-10-18", steps: [step("a-01"), step("b-01", "supervisor")] },
        in_force_version: 2,
        changes: [changeView(3), changeView(2)],
      }),
    });
    renderApp();
    await screen.findByText("Change title v3");
    const titles = screen.getAllByText(/^Change title v/).map((n) => n.textContent);
    expect(titles).toEqual(["Change title v3", "Change title v2"]);
    expect(screen.getByRole("heading", { name: "Steps in version 3" })).not.toBeNull();
    const items = Array.from(document.querySelector("ol")!.querySelectorAll("li")); // the nav <ul> has its own items
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain("Title a-01");
    expect(items[0]!.textContent).toContain("Done by: Staff");
    expect(items[1]!.textContent).toContain("Done by: Supervisor");
  });

  it("5.T5 no changes shows the empty line", async () => {
    renderApp();
    await screen.findByText("No changes yet. The SOP changes only through approved proposals.");
  });
});

describe("SopApp states", () => {
  it("5.T6 a staff role sees the forbidden text and makes no request", async () => {
    getIdTokenResult.mockResolvedValue({ claims: { role: "staff" } });
    renderApp();
    await screen.findByText("Only the owner or a supervisor can see the SOP changes.");
    expect(authedGetJson).not.toHaveBeenCalled();
  });

  it("5.T6 a claims read failure fails closed", async () => {
    getIdTokenResult.mockRejectedValue(new Error("boom"));
    renderApp();
    await screen.findByText("Only the owner or a supervisor can see the SOP changes.");
    expect(authedGetJson).not.toHaveBeenCalled();
  });

  it("5.T6 a forbidden result shows the forbidden text", async () => {
    authedGetJson.mockResolvedValue({ kind: "forbidden" });
    renderApp();
    await screen.findByText("Only the owner or a supervisor can see the SOP changes.");
  });

  it("5.T6 signed_out signs out and redirects", async () => {
    authedGetJson.mockResolvedValue({ kind: "signed_out" });
    renderApp();
    await waitFor(() => expect(signOut).toHaveBeenCalledWith(FAKE_AUTH));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
  });

  it("5.T6 an error result shows the generic text", async () => {
    authedGetJson.mockResolvedValue({ kind: "error" });
    renderApp();
    await screen.findByText("Something went wrong. Try again.");
  });

  it("a signed-out user is sent to /sign-in without any request", async () => {
    authUserState = { status: "signed_out" };
    renderApp();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
    expect(authedGetJson).not.toHaveBeenCalled();
  });

  it("no config shows the sign-in-not-configured message", () => {
    render(
      <LangProvider initial="en">
        <SopApp config={null} />
      </LangProvider>,
    );
    expect(screen.getByText("Sign-in is not set up on this server.")).not.toBeNull();
  });

  it("5.T7 makes exactly one GET to /api/v1/sop on mount", async () => {
    renderApp();
    await screen.findByText("Version 1");
    expect(authedGetJson).toHaveBeenCalledTimes(1);
    expect(authedGetJson).toHaveBeenCalledWith(FAKE_AUTH, "/api/v1/sop", expect.anything());
  });
});

describe("SopApp version switch (R-19 PR-9a §9.1)", () => {
  const v2 = (): SopOverview =>
    overview({
      latest: { version: 2, effective_from_date: "2026-10-16", steps: [step("a-01"), { ...step("stock-01"), text: "New text v2" }] },
      in_force_version: 2,
      changes: [changeView(2)],
    });

  it("lists versions by date, oldest first, with the newest marked current and selected", async () => {
    authedGetJson.mockResolvedValue({ kind: "ok", data: v2() });
    renderApp();
    const group = await screen.findByRole("group", { name: "SOP version" });
    const buttons = Array.from(group.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual(["05/10/26", "16/10/26 · current"]);
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
    expect(screen.getByRole("heading", { name: "Steps in version 2" })).not.toBeNull();
    expect(screen.getByText("IMPROVED · NEW ON 16/10/26")).not.toBeNull();
    expect(document.querySelector("del")?.textContent).toBe("Text stock-01");
    // The steps list (the only <ol>) shows the new text; the Changes section below repeats it in its after block.
    expect(document.querySelector("ol")!.textContent).toContain("New text v2");
  });

  it("switching to the first version shows its steps with the old wording and no badge", async () => {
    authedGetJson.mockResolvedValue({ kind: "ok", data: v2() });
    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: "05/10/26" }));
    expect(screen.getByRole("heading", { name: "Steps in version 1" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "05/10/26" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText(/NEW ON/)).toBeNull();
    expect(document.querySelector("del")).toBeNull();
    // PR-9b: the book opens on chapter 1, "Stock" (a-01 sits in "Other steps", the last chapter), so the steps
    // list is that chapter's; the contents page lists both.
    const items = Array.from(document.querySelector("ol")!.querySelectorAll("li"));
    expect(document.querySelector("ol")!.textContent).not.toContain("New text v2");
    expect(items.map((li) => li.querySelector("p")?.textContent)).toEqual(["Title stock-01"]);
    expect(items[0]!.textContent).toContain("Text stock-01");
    expect(screen.getByRole("button", { name: "Other steps, 1 step" })).not.toBeNull();
  });

  it("a seed-only SOP shows its date '· current' as plain text, with no switch", async () => {
    renderApp();
    await screen.findByText("05/10/26 · current");
    expect(screen.queryByRole("group", { name: "SOP version" })).toBeNull();
    expect(screen.queryByText(/First version/)).toBeNull();
    expect(screen.queryByText(/NEW ON/)).toBeNull();
  });

  it("falls back to 'First version' only when the seed's date is not known", async () => {
    authedGetJson.mockResolvedValue({ kind: "ok", data: { ...v2(), first_version_date: null } });
    renderApp();
    const group = await screen.findByRole("group", { name: "SOP version" });
    expect(Array.from(group.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["First version", "16/10/26 · current"]);
  });

  it("falls back to 'First version · current' on a seed-only SOP whose date is not known", async () => {
    authedGetJson.mockResolvedValue({ kind: "ok", data: overview({ first_version_date: null }) });
    renderApp();
    await screen.findByText("First version · current");
  });

  it("shows the read-only footer and no Add SOP, Download or Open in Sheets control", async () => {
    authedGetJson.mockResolvedValue({ kind: "ok", data: v2() });
    renderApp();
    await screen.findByText("Read-only. Steps change only through an approved proposal.");
    const controls = [...screen.getAllByRole("button"), ...screen.getAllByRole("link")].map((n) => n.textContent ?? "");
    expect(controls.some((c) => /Add SOP|Download|Open in Sheets/i.test(c))).toBe(false);
    expect(document.body.textContent).not.toMatch(/Add SOP page|Download|Open in Sheets/);
  });

  it("the empty state has no footer and no switch", async () => {
    authedGetJson.mockResolvedValue({ kind: "ok", data: overview({ latest: null, in_force_version: null }) });
    renderApp();
    await screen.findByText("No SOP yet.");
    expect(screen.queryByText("Read-only. Steps change only through an approved proposal.")).toBeNull();
    expect(screen.queryByText(/First version/)).toBeNull();
    expect(screen.queryByText(/05\/10\/26/)).toBeNull();
  });
});

describe("SopApp Book/Table toggle (R-19 PR-9b §9.1)", () => {
  const demo = (): SopOverview =>
    overview({
      latest: {
        version: 2,
        effective_from_date: "2026-10-16",
        steps: [step("open-01"), step("bake-01"), { ...step("stock-01"), text: "New text v2" }, step("serve-01"), step("close-01")],
      },
      in_force_version: 2,
      changes: [changeView(2)],
    });

  it("opens in Book view: the toggle says Book / Table with Book pressed, the spread is shown and no table", async () => {
    authedGetJson.mockResolvedValue({ kind: "ok", data: demo() });
    renderApp();
    const group = await screen.findByRole("group", { name: "View" });
    const buttons = Array.from(group.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual(["Book", "Table"]);
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    expect(screen.getByRole("navigation", { name: "Contents" })).not.toBeNull();
    expect(screen.getByText("From your SOP").parentElement!.textContent).toContain("4");
    expect(screen.getByText("Improved with Bee6").parentElement!.textContent).toContain("1");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("Table shows the six-column table with the improved step's origin and hides the spread; Book brings it back", async () => {
    authedGetJson.mockResolvedValue({ kind: "ok", data: demo() });
    renderApp();
    await screen.findByRole("group", { name: "View" });
    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    expect(screen.getByRole("button", { name: "Table" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["CODE", "STEP", "CHAPTER", "WHO", "WHEN", "WHERE IT CAME FROM"]);
    const rows = Array.from(document.querySelectorAll("tbody tr")).map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.textContent));
    expect(rows).toHaveLength(5);
    expect(rows[2]).toEqual(["stock-01", "Title stock-01New text v2", "Stock", "Staff", "16/10/26", "Bee6 proposal, approved 15/10/26"]);
    expect(rows[0]![5]).toBe("Your SOP");
    expect(screen.queryByRole("navigation", { name: "Contents" })).toBeNull();
    expect(screen.queryByText(/NEW ON/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Book" }));
    expect(screen.getByRole("navigation", { name: "Contents" })).not.toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("the view survives a version switch, and the table of the first version has no Bee6 origin", async () => {
    authedGetJson.mockResolvedValue({ kind: "ok", data: demo() });
    renderApp();
    await screen.findByRole("group", { name: "View" });
    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    fireEvent.click(screen.getByRole("button", { name: "05/10/26" }));
    expect(screen.getByRole("heading", { name: "Steps in version 1" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Table" }).getAttribute("aria-pressed")).toBe("true");
    const rows = Array.from(document.querySelectorAll("tbody tr")).map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.textContent));
    expect(rows[2]).toEqual(["stock-01", "Title stock-01Text stock-01", "Stock", "Staff", "05/10/26", "Your SOP"]);
    expect(rows.every((r) => r[5] === "Your SOP")).toBe(true);
  });

  it("the book turns pages to the improved step's chapter, and the seed version's legend shows 0 improved", async () => {
    authedGetJson.mockResolvedValue({ kind: "ok", data: demo() });
    renderApp();
    await screen.findByRole("group", { name: "View" });
    expect(screen.getByText("Page 1 of 4")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stock, 1 step" }));
    expect(screen.getByText("IMPROVED · NEW ON 16/10/26")).not.toBeNull();
    expect(document.querySelector("del")?.textContent).toBe("Text stock-01");
    fireEvent.click(screen.getByRole("button", { name: "05/10/26" }));
    expect(screen.getByText("Improved with Bee6").parentElement!.textContent).toContain("0");
    expect(screen.getByText("From your SOP").parentElement!.textContent).toContain("5");
    expect(screen.queryByText(/NEW ON/)).toBeNull();
  });

  it("the toggle is still shown for a seed-only SOP, with a single 'Other steps' chapter and no page navigation", async () => {
    renderApp();
    await screen.findByRole("group", { name: "View" });
    expect(screen.getByRole("button", { name: "Other steps, 2 steps" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Next page" })).toBeNull();
  });

  it("the open chapter survives a Book -> Table -> Book round trip", async () => {
    authedGetJson.mockResolvedValue({ kind: "ok", data: demo() });
    renderApp();
    await screen.findByRole("group", { name: "View" });
    fireEvent.click(screen.getByRole("button", { name: "Stock, 1 step" }));
    expect(screen.getByText("Page 3 of 4")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    expect(screen.queryByRole("navigation", { name: "Contents" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Book" }));
    expect(screen.getByRole("heading", { level: 3, name: "Stock" })).not.toBeNull();
    expect(screen.getByText("Page 3 of 4")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Stock, 1 step" }).getAttribute("aria-current")).toBe("page");
  });

  it("Bahasa labels the toggle Buku / Tabel", async () => {
    authedGetJson.mockResolvedValue({ kind: "ok", data: demo() });
    render(
      <LangProvider initial="id">
        <SopApp config={CONFIG} />
      </LangProvider>,
    );
    const group = await screen.findByRole("group", { name: "Tampilan" });
    expect(Array.from(group.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["Buku", "Tabel"]);
  });
});
