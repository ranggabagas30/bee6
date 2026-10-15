// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { WatchPanel } from "@/app/proposals/WatchPanel";
import type { ProposalsWatch, WatchRow } from "@/lib/proposals/review-contract";

afterEach(() => cleanup());

function row(category: WatchRow["category"], dates: number, state: WatchRow["state"]): WatchRow {
  return { category, facts: dates, dates, need_dates: 2, state };
}

function watchOf(categories: WatchRow[]): ProposalsWatch {
  return { from_date: "2026-10-05", to_date: "2026-10-11", categories };
}

function renderPanel(props: Partial<Parameters<typeof WatchPanel>[0]> = {}) {
  const onAsk = vi.fn();
  render(
    <WatchPanel
      lang="en"
      watch={watchOf([])}
      hasProposal={false}
      busy={false}
      onAsk={onAsk}
      {...props}
    />,
  );
  return { onAsk };
}

describe("WatchPanel — rows", () => {
  it("lists one row per category with its label, the seen-on line and a state chip", () => {
    renderPanel({
      watch: watchOf([
        row("CUSTOMER_SERVICE", 2, "ready"),
        row("PHONE_CALL", 1, "needs_more"),
        row("COMPLAINT", 2, "proposed"),
      ]),
    });
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]!).getByText("Customer service")).not.toBeNull();
    expect(within(items[0]!).getByText("seen on 2 of 2 days needed")).not.toBeNull();
    expect(within(items[0]!).getByText("Ready")).not.toBeNull();
    expect(within(items[1]!).getByText("Phone call")).not.toBeNull();
    expect(within(items[1]!).getByText("seen on 1 of 2 days needed")).not.toBeNull();
    expect(within(items[1]!).getByText("Needs 1 more day")).not.toBeNull();
    expect(within(items[2]!).getByText("Proposed")).not.toBeNull();
  });

  it("shows the window as dates, the kicker and the plain-rules note", () => {
    renderPanel();
    expect(screen.getByText("WHAT BEE6 IS WATCHING")).not.toBeNull();
    expect(screen.getByText("Repeated problems, counted by plain rules. Not a guess.")).not.toBeNull();
    expect(screen.getByText("Mon 5 Oct to Sun 11 Oct")).not.toBeNull();
  });

  it("never renders anything but counts: no thread text, no device, no name key", () => {
    const { container } = render(
      <WatchPanel lang="en" watch={watchOf([row("CUSTOMER_SERVICE", 2, "ready")])} hasProposal={false} busy={false} onAsk={() => {}} />,
    );
    expect(container.textContent).not.toMatch(/device|thread|staff/i);
  });
});

describe("WatchPanel — the ask button", () => {
  it("with a ready row and no proposal yet: 'Ask Bee6 for a proposal' sends another=false", () => {
    const { onAsk } = renderPanel({ watch: watchOf([row("CUSTOMER_SERVICE", 2, "ready")]) });
    const button = screen.getByRole("button", { name: "Ask Bee6 for a proposal" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(onAsk).toHaveBeenCalledWith(false);
  });

  it("once a proposal exists: 'Ask for another proposal' sends another=true", () => {
    const { onAsk } = renderPanel({
      watch: watchOf([row("CUSTOMER_SERVICE", 2, "proposed"), row("PHONE_CALL", 2, "ready")]),
      hasProposal: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask for another proposal" }));
    expect(onAsk).toHaveBeenCalledWith(true);
  });

  it("no ready row and nothing proposed: a disabled 'Not enough evidence yet'", () => {
    const { onAsk } = renderPanel({ watch: watchOf([row("PHONE_CALL", 1, "needs_more")]) });
    const button = screen.getByRole("button", { name: "Not enough evidence yet" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(onAsk).not.toHaveBeenCalled();
  });

  it("every seen category already proposed: a disabled 'All asked' line", () => {
    renderPanel({ watch: watchOf([row("CUSTOMER_SERVICE", 2, "proposed")]), hasProposal: true });
    expect((screen.getByRole("button", { name: "All asked · no more evidence to use" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("while busy the button reads 'Asking Bee6…' and is disabled", () => {
    const { onAsk } = renderPanel({ watch: watchOf([row("CUSTOMER_SERVICE", 2, "ready")]), busy: true });
    const button = screen.getByRole("button", { name: "Asking Bee6…" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(onAsk).not.toHaveBeenCalled();
  });

  it("ID copy", () => {
    renderPanel({ lang: "id", watch: watchOf([row("CUSTOMER_SERVICE", 2, "ready")]) });
    expect(screen.getByRole("button", { name: "Minta usulan dari Bee6" })).not.toBeNull();
    expect(screen.getByText("Layanan pelanggan")).not.toBeNull();
    expect(screen.getByText("Siap")).not.toBeNull();
  });
});
