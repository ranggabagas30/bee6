// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReviewView } from "@/lib/reviews/contract";
import { VerdictResponseSchema } from "@/lib/reviews/contract";
import { suggestionDomId } from "@/app/reviews/ReviewCard";
import { reviewView } from "@/app/reviews/review-fixtures";
import { VerdictPanel } from "@/app/reviews/VerdictPanel";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const signOut = vi.fn();
vi.mock("@/lib/auth/client/firebase-client", () => ({
  signOut: (...args: unknown[]) => signOut(...args),
}));

const authedPostJson = vi.fn();
vi.mock("@/lib/auth/client/api", () => ({
  authedPostJson: (...args: unknown[]) => authedPostJson(...args),
}));

const FAKE_AUTH = { kind: "fake-auth" } as unknown as import("@/lib/auth/client/firebase-client").Auth;
const onSettled = vi.fn();

const awaitingOwner = (): ReviewView =>
  reviewView({
    status: "awaiting_owner",
    supervisor: { verdict: "revise", reason: null, decided_date: "2026-10-24" },
  });

function renderPanel(role: "owner" | "supervisor", review: ReviewView, lang: "en" | "id" = "en") {
  return render(<VerdictPanel auth={FAKE_AUTH} role={role} review={review} lang={lang} onSettled={onSettled} />);
}

beforeEach(() => {
  authedPostJson.mockReset();
  onSettled.mockReset();
  replace.mockReset();
  signOut.mockReset();
});
afterEach(() => cleanup());

const tap = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const typeReason = (text: string) =>
  fireEvent.change(screen.getByLabelText("Reason (optional)"), { target: { value: text } });
const yes = () => screen.getByRole("button", { name: "Yes" });

describe("VerdictPanel: which actions show", () => {
  it.each([
    ["supervisor", "awaiting_supervisor", true],
    ["supervisor", "awaiting_owner", false],
    ["supervisor", "confirmed", false],
    ["supervisor", "unknown", false],
    ["owner", "awaiting_supervisor", false],
    ["owner", "awaiting_owner", true],
    ["owner", "confirmed", false],
    ["owner", "unknown", false],
  ] as const)("%s x %s -> buttons shown: %s", (role, status, shown) => {
    const review =
      status === "awaiting_supervisor"
        ? reviewView({ status })
        : reviewView({
            status,
            supervisor: { verdict: "revise", reason: null, decided_date: "2026-10-24" },
          });
    const { container } = renderPanel(role, review);
    expect(screen.queryByRole("button", { name: "Worked" }) !== null).toBe(shown);
    if (!shown) expect(container.innerHTML).toBe("");
  });

  it("offers Worked, Revise and Revert as 48px buttons and posts nothing on the first tap", () => {
    renderPanel("supervisor", reviewView());
    for (const name of ["Worked", "Revise", "Revert"]) {
      expect(screen.getByRole("button", { name }).style.minHeight).toBe("48px");
    }
    tap("Revise");
    expect(authedPostJson).not.toHaveBeenCalled();
  });

  it("points the suggested button at the suggestion line, without pre-selecting anything", () => {
    renderPanel("supervisor", reviewView({ suggestion: { verdict: "revise", reason: "no_clear_change", change_ratio: 0 } }));
    expect(screen.getByRole("button", { name: "Revise" }).getAttribute("aria-describedby")).toBe(suggestionDomId(2));
    expect(screen.getByRole("button", { name: "Worked" }).getAttribute("aria-describedby")).toBeNull();
    expect(screen.getByRole("button", { name: "Revert" }).getAttribute("aria-describedby")).toBeNull();
    expect(screen.queryByRole("button", { name: "Yes" })).toBeNull();
  });

  it("points no button at the suggestion when bee6 has none", () => {
    renderPanel(
      "supervisor",
      reviewView({ suggestion: { verdict: null, reason: "not_enough_days", change_ratio: null } }),
    );
    for (const name of ["Worked", "Revise", "Revert"]) {
      expect(screen.getByRole("button", { name }).getAttribute("aria-describedby")).toBeNull();
    }
  });
});

describe("VerdictPanel: confirm step", () => {
  it("a tap opens the confirm region, moves focus to it, and shows the optional reason field with its hint", () => {
    renderPanel("supervisor", reviewView());
    tap("Revise");
    const question = screen.getByText('Record "Revise" as your verdict?');
    expect(document.activeElement).toBe(question);
    const textarea = screen.getByLabelText("Reason (optional)") as HTMLTextAreaElement;
    expect(textarea.maxLength).toBe(300);
    const hint = screen.getByText("No names or phone numbers.");
    expect(textarea.getAttribute("aria-describedby")).toContain(hint.id);
    expect(screen.queryByRole("button", { name: "Worked" })).toBeNull();
  });

  it("Cancel returns to the three buttons, focuses the one tapped, and drops the typed reason", () => {
    renderPanel("supervisor", reviewView());
    tap("Revert");
    typeReason("some words");
    tap("Cancel");
    expect(authedPostJson).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Revert" }));
    tap("Worked");
    expect((screen.getByLabelText("Reason (optional)") as HTMLTextAreaElement).value).toBe("");
  });

  it("Yes is disabled for a 1 or 2 character reason and enabled when blank, whitespace or 3+", () => {
    renderPanel("supervisor", reviewView());
    tap("Worked");
    expect((yes() as HTMLButtonElement).disabled).toBe(false);
    typeReason("ab");
    expect((yes() as HTMLButtonElement).disabled).toBe(true);
    typeReason("  a  ");
    expect((yes() as HTMLButtonElement).disabled).toBe(true);
    typeReason("abc");
    expect((yes() as HTMLButtonElement).disabled).toBe(false);
    typeReason("   ");
    expect((yes() as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("VerdictPanel: posting", () => {
  it("posts exactly { verdict } once when the reason is blank", async () => {
    authedPostJson.mockResolvedValue({ kind: "ok", data: { result: "recorded", status: "awaiting_owner" } });
    renderPanel("supervisor", reviewView());
    tap("Revise");
    fireEvent.click(yes());
    await waitFor(() => expect(onSettled).toHaveBeenCalled());
    expect(authedPostJson).toHaveBeenCalledTimes(1);
    expect(authedPostJson).toHaveBeenCalledWith(
      FAKE_AUTH,
      "/api/v1/reviews/2/verdict",
      { verdict: "revise" },
      VerdictResponseSchema,
    );
  });

  it("posts { verdict, reason } with the reason trimmed when one is given", async () => {
    authedPostJson.mockResolvedValue({ kind: "ok", data: { result: "recorded", status: "awaiting_owner" } });
    renderPanel("supervisor", reviewView());
    tap("Worked");
    typeReason("  It helped on busy days  ");
    fireEvent.click(yes());
    await waitFor(() => expect(onSettled).toHaveBeenCalled());
    expect(authedPostJson.mock.calls[0]![2]).toEqual({ verdict: "worked", reason: "It helped on busy days" });
  });

  it("a whitespace-only reason is not sent", async () => {
    authedPostJson.mockResolvedValue({ kind: "ok", data: { result: "recorded", status: "awaiting_owner" } });
    renderPanel("supervisor", reviewView());
    tap("Worked");
    typeReason("     ");
    fireEvent.click(yes());
    await waitFor(() => expect(onSettled).toHaveBeenCalled());
    expect(authedPostJson.mock.calls[0]![2]).toEqual({ verdict: "worked" });
  });

  it("the owner posts to the same route", async () => {
    authedPostJson.mockResolvedValue({ kind: "ok", data: { result: "recorded", status: "confirmed" } });
    renderPanel("owner", awaitingOwner());
    tap("Worked");
    fireEvent.click(yes());
    await waitFor(() => expect(onSettled).toHaveBeenCalledWith("C-rev-done"));
    expect(authedPostJson.mock.calls[0]![1]).toBe("/api/v1/reviews/2/verdict");
  });

  it("a double tap on Yes sends one request and disables every control meanwhile", async () => {
    let resolve!: (v: unknown) => void;
    authedPostJson.mockReturnValue(new Promise((r) => (resolve = r)));
    renderPanel("supervisor", reviewView());
    tap("Revise");
    fireEvent.click(yes());
    fireEvent.click(yes());
    expect(authedPostJson).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "Yes" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Reason (optional)") as HTMLTextAreaElement).disabled).toBe(true);
    await act(async () => resolve({ kind: "ok", data: { result: "recorded", status: "awaiting_owner" } }));
    expect(onSettled).toHaveBeenCalledTimes(1);
  });
});

describe("VerdictPanel: answers", () => {
  it("recorded -> C-rev-done, unchanged -> C-rev-done-unchanged", async () => {
    authedPostJson.mockResolvedValueOnce({ kind: "ok", data: { result: "recorded", status: "awaiting_owner" } });
    const first = renderPanel("supervisor", reviewView());
    tap("Revise");
    fireEvent.click(yes());
    await waitFor(() => expect(onSettled).toHaveBeenLastCalledWith("C-rev-done"));
    first.unmount();

    authedPostJson.mockResolvedValueOnce({ kind: "ok", data: { result: "unchanged", status: "awaiting_owner" } });
    renderPanel("supervisor", reviewView());
    tap("Revise");
    fireEvent.click(yes());
    await waitFor(() => expect(onSettled).toHaveBeenLastCalledWith("C-rev-done-unchanged"));
  });

  it.each([
    ["ALREADY_DECIDED", "C-rev-err-decided"],
    ["NOT_YET_REVIEWABLE", "C-rev-err-not-yet"],
    ["EXPIRED", "C-rev-err-expired"],
    ["NOTHING_TO_REVIEW", "C-srv-generic"],
    ["SOMETHING_NEW", "C-srv-generic"],
    ["constructor", "C-srv-generic"], // prototype keys must not resolve through the lookup table
    ["__proto__", "C-srv-generic"],
    ["toString", "C-srv-generic"],
  ])("conflict %s -> %s", async (code, key) => {
    authedPostJson.mockResolvedValue({ kind: "conflict", code });
    renderPanel("supervisor", reviewView());
    tap("Revise");
    fireEvent.click(yes());
    await waitFor(() => expect(onSettled).toHaveBeenCalledWith(key));
  });

  it("invalid stays in the confirm step with the reason kept and an inline length error", async () => {
    authedPostJson.mockResolvedValue({ kind: "invalid" });
    renderPanel("supervisor", reviewView());
    tap("Revise");
    typeReason("keep this text");
    fireEvent.click(yes());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("A reason must be 3 to 300 characters.");
    expect((screen.getByLabelText("Reason (optional)") as HTMLTextAreaElement).value).toBe("keep this text");
    expect(onSettled).not.toHaveBeenCalled();
    expect((yes() as HTMLButtonElement).disabled).toBe(false);
  });

  it("forbidden shows the inline forbidden text and posts nothing more", async () => {
    authedPostJson.mockResolvedValue({ kind: "forbidden" });
    renderPanel("supervisor", reviewView());
    tap("Revise");
    fireEvent.click(yes());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Only the owner or a supervisor can see reviews.");
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("signed_out signs out and redirects to /sign-in", async () => {
    authedPostJson.mockResolvedValue({ kind: "signed_out" });
    renderPanel("supervisor", reviewView());
    tap("Revise");
    fireEvent.click(yes());
    await waitFor(() => expect(signOut).toHaveBeenCalledWith(FAKE_AUTH));
    expect(replace).toHaveBeenCalledWith("/sign-in");
  });

  it("a generic error stays in confirm with the reason kept, and Yes retries", async () => {
    authedPostJson.mockResolvedValueOnce({ kind: "error" });
    renderPanel("supervisor", reviewView());
    tap("Revise");
    typeReason("still here");
    fireEvent.click(yes());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Something went wrong. Try again.");
    expect((screen.getByLabelText("Reason (optional)") as HTMLTextAreaElement).value).toBe("still here");
    authedPostJson.mockResolvedValueOnce({ kind: "ok", data: { result: "recorded", status: "awaiting_owner" } });
    fireEvent.click(yes());
    await waitFor(() => expect(onSettled).toHaveBeenCalledWith("C-rev-done"));
    expect(authedPostJson).toHaveBeenCalledTimes(2);
  });
});

describe("VerdictPanel: settled state", () => {
  it("after an answer no action shows until a fresh review object arrives, then the buttons come back", async () => {
    authedPostJson.mockResolvedValue({ kind: "conflict", code: "ALREADY_DECIDED" });
    const review = reviewView();
    const { rerender, container } = renderPanel("supervisor", review);
    tap("Revise");
    typeReason("typed before the answer");
    fireEvent.click(yes());
    await waitFor(() => expect(onSettled).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");

    // Same object again (an unrelated parent render): still hidden.
    rerender(<VerdictPanel auth={FAKE_AUTH} role="supervisor" review={review} lang="en" onSettled={onSettled} />);
    expect(container.innerHTML).toBe("");

    // The reload returned the review, still open, as a new object: the panel recovers, clean.
    rerender(<VerdictPanel auth={FAKE_AUTH} role="supervisor" review={{ ...review }} lang="en" onSettled={onSettled} />);
    expect(screen.getByRole("button", { name: "Revise" })).not.toBeNull();
    tap("Revise");
    expect((screen.getByLabelText("Reason (optional)") as HTMLTextAreaElement).value).toBe("");
  });

  it("recovers after an 'unchanged' answer the same way", async () => {
    authedPostJson.mockResolvedValue({ kind: "ok", data: { result: "unchanged", status: "awaiting_supervisor" } });
    const review = reviewView();
    const { rerender, container } = renderPanel("supervisor", review);
    tap("Worked");
    fireEvent.click(yes());
    await waitFor(() => expect(onSettled).toHaveBeenCalledWith("C-rev-done-unchanged"));
    expect(container.innerHTML).toBe("");
    rerender(<VerdictPanel auth={FAKE_AUTH} role="supervisor" review={{ ...review }} lang="en" onSettled={onSettled} />);
    expect(screen.getByRole("button", { name: "Worked" })).not.toBeNull();
  });

  it("renders in Bahasa Indonesia", () => {
    renderPanel("supervisor", reviewView(), "id");
    screen.getByRole("button", { name: "Berhasil" });
    screen.getByRole("button", { name: "Perlu direvisi" });
    screen.getByRole("button", { name: "Kembalikan" });
  });
});
