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

  it("shows the kicker and the plain-rules note, and no date-range line (board D2-03)", () => {
    renderPanel();
    expect(screen.getByText("WHAT BEE6 IS WATCHING")).not.toBeNull();
    expect(screen.getByText("Repeated problems, counted by plain rules. Not a guess.")).not.toBeNull();
    expect(screen.queryByText(/Mon 5 Oct/)).toBeNull();
    expect(screen.queryByText(/ to /)).toBeNull();
  });

  it("the category is a chip, in the order the server sent it (pilot: nothing added)", () => {
    renderPanel({ watch: watchOf([row("PHONE_CALL", 1, "needs_more"), row("COMPLAINT", 2, "proposed")]) });
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]!.querySelector(".b6-chip")?.textContent).toBe("Phone call");
    expect(items[1]!.querySelector(".b6-chip")?.textContent).toBe("Customer complaint");
  });

  it("UI-115: the count never reads above the need (3 days seen shows '2 of 2')", () => {
    renderPanel({ watch: watchOf([row("STAFF_CONSULT", 3, "ready")]) });
    const item = screen.getByRole("listitem");
    expect(within(item).getByText("seen on 2 of 2 days needed")).not.toBeNull();
    expect(item.textContent).not.toMatch(/3 of 2/);
    expect(within(item).getByRole("img", { name: "Days seen: 2/2" })).not.toBeNull();
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

  it("every seen category already proposed: a disabled 'All asked' line (pilot copy)", () => {
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

  // Demo feedback 2 item 18: on a demo sandbox, two or more ready problems read as one ask for all of them.
  it("demo: two ready rows read 'Ask Bee6 for proposals' and still send another=false when no proposal exists", () => {
    const { onAsk } = renderPanel({ demo: true, watch: watchOf([row("CUSTOMER_SERVICE", 2, "ready"), row("PHONE_CALL", 2, "ready")]) });
    fireEvent.click(screen.getByRole("button", { name: "Ask Bee6 for proposals" }));
    expect(onAsk).toHaveBeenCalledWith(false);
  });

  it("demo: two ready rows with a proposal already there still read 'Ask Bee6 for proposals' and send another=true", () => {
    const { onAsk } = renderPanel({ demo: true, hasProposal: true, watch: watchOf([row("CUSTOMER_SERVICE", 2, "ready"), row("PHONE_CALL", 2, "ready")]) });
    fireEvent.click(screen.getByRole("button", { name: "Ask Bee6 for proposals" }));
    expect(onAsk).toHaveBeenCalledWith(true);
  });

  it("demo: one ready row keeps the singular and 'another' labels (a retry after a partial chain reads 'Ask for another proposal')", () => {
    renderPanel({ demo: true, watch: watchOf([row("CUSTOMER_SERVICE", 2, "ready")]) });
    expect(screen.getByRole("button", { name: "Ask Bee6 for a proposal" })).not.toBeNull();
    cleanup();
    renderPanel({ demo: true, hasProposal: true, watch: watchOf([row("CUSTOMER_SERVICE", 2, "proposed"), row("PHONE_CALL", 2, "ready")]) });
    expect(screen.getByRole("button", { name: "Ask for another proposal" })).not.toBeNull();
  });

  it("pilot: two ready rows keep today's one-proposal-per-tap label", () => {
    renderPanel({ watch: watchOf([row("CUSTOMER_SERVICE", 2, "ready"), row("PHONE_CALL", 2, "ready")]) });
    expect(screen.getByRole("button", { name: "Ask Bee6 for a proposal" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Ask Bee6 for proposals" })).toBeNull();
  });

  it("demo, two ready rows, busy: still 'Asking Bee6…' and disabled; ID copy for the all-ask label", () => {
    renderPanel({ demo: true, busy: true, watch: watchOf([row("CUSTOMER_SERVICE", 2, "ready"), row("PHONE_CALL", 2, "ready")]) });
    expect((screen.getByRole("button", { name: "Asking Bee6…" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    renderPanel({ lang: "id", demo: true, watch: watchOf([row("CUSTOMER_SERVICE", 2, "ready"), row("PHONE_CALL", 2, "ready")]) });
    expect(screen.getByRole("button", { name: "Minta semua usulan dari Bee6" })).not.toBeNull();
  });

  it("ID copy", () => {
    renderPanel({ lang: "id", watch: watchOf([row("CUSTOMER_SERVICE", 2, "ready")]) });
    expect(screen.getByRole("button", { name: "Minta usulan dari Bee6" })).not.toBeNull();
    expect(screen.getByText("Layanan pelanggan")).not.toBeNull();
    expect(screen.getByText("Siap")).not.toBeNull();
  });
});

describe("WatchPanel — demo sandbox (R14, board D2-03b / D2-03a)", () => {
  it("before day 1 is processed: both problem rows with 'Not seen yet' and the button locked", () => {
    const { onAsk } = renderPanel({ demo: true });
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]!.querySelector(".b6-chip")?.textContent).toBe("Customer service"); // problem A, the egg-tart question
    expect(items[1]!.querySelector(".b6-chip")?.textContent).toBe("Phone call"); // problem B, the phone order
    for (const li of items) {
      expect(within(li).getByText("Not seen yet")).not.toBeNull();
      expect(within(li).getByText("seen on 0 of 2 days needed")).not.toBeNull();
    }
    const button = screen.getByRole("button", { name: "Not enough evidence yet" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onAsk).not.toHaveBeenCalled();
  });

  it("only the categories the server did not send get a placeholder; the server's row wins, and the other seen ones follow", () => {
    renderPanel({ demo: true, watch: watchOf([row("TRAINING", 1, "needs_more"), row("CUSTOMER_SERVICE", 1, "needs_more")]) });
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.querySelector(".b6-chip")?.textContent)).toEqual(["Customer service", "Phone call", "Training"]);
    expect(within(items[0]!).getByText("seen on 1 of 2 days needed")).not.toBeNull();
    expect(within(items[0]!).getByText("Needs 1 more day")).not.toBeNull();
    expect(within(items[1]!).getByText("Not seen yet")).not.toBeNull();
  });

  it("a placeholder never makes the button live: only the server's rows decide it", () => {
    renderPanel({ demo: true, watch: watchOf([row("PHONE_CALL", 2, "proposed")]), hasProposal: true });
    // demo copy "Both asked"; one real row, proposed (the placeholder for the egg-tart problem does not count as 'not proposed')
    expect((screen.getByRole("button", { name: "Both asked · no more evidence to use" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("the pilot gets no placeholder rows even with nothing seen", () => {
    renderPanel({ demo: false });
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.queryByText("Not seen yet")).toBeNull();
  });

  it("D2-03a: egg-tart row ready, phone row needs a day, nothing proposed: the 'One proposal can be made now' note", () => {
    renderPanel({ demo: true, watch: watchOf([row("CUSTOMER_SERVICE", 2, "ready"), row("PHONE_CALL", 1, "needs_more")]) });
    expect(screen.getByRole("heading", { name: "One proposal can be made now" })).not.toBeNull();
    expect(
      screen.getByText(
        "The bake-date problem showed on 2 days. For a second proposal, run day 3 on the staff phone first, then ask. After you ask for a proposal, “Jump to tomorrow” is locked.",
      ),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "Ask Bee6 for a proposal" })).not.toBeNull();
  });

  it("the note is demo-only and goes once a proposal exists or both problems are ready", () => {
    const watch = watchOf([row("CUSTOMER_SERVICE", 2, "ready"), row("PHONE_CALL", 1, "needs_more")]);
    const { unmount } = render(<WatchPanel lang="en" watch={watch} hasProposal={false} busy={false} onAsk={() => {}} />);
    expect(screen.queryByText("One proposal can be made now")).toBeNull(); // pilot
    unmount();
    const again = render(<WatchPanel lang="en" demo watch={watch} hasProposal busy={false} onAsk={() => {}} />);
    expect(screen.queryByText("One proposal can be made now")).toBeNull(); // a proposal exists
    again.unmount();
    render(<WatchPanel lang="en" demo watch={watchOf([row("CUSTOMER_SERVICE", 2, "ready"), row("PHONE_CALL", 2, "ready")])} hasProposal={false} busy={false} onAsk={() => {}} />);
    expect(screen.queryByText("One proposal can be made now")).toBeNull(); // both ready
  });

  it("ID: 'Belum terlihat' and the note", () => {
    renderPanel({ lang: "id", demo: true, watch: watchOf([row("CUSTOMER_SERVICE", 2, "ready"), row("PHONE_CALL", 1, "needs_more")]) });
    expect(screen.getByRole("heading", { name: "Satu usulan bisa dibuat sekarang" })).not.toBeNull();
  });
});
