// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  PROPOSALS_PROGRESS_EVENT,
  PROPOSALS_SCREEN_EVENT,
  publishProposalsProgress,
  publishProposalsScreen,
  readProposalsProgressVersion,
  readProposalsScreen,
} from "@/lib/demo/proposals-signal";

/**
 * R-19 after-merge wiring: the proposals page (supervisor PR-12a, owner PR-12b) tells the same document which screen
 * it shows and when it changed the sandbox's progress (an ask that wrote a proposal, a feasible mark, a rejection, an
 * approval), so the judge guide's card and stage follow the page at once instead of on the next open. The same shape
 * as lib/debrief/view-signal: a module value plus a data-less window Event. Only a screen KIND and a counter cross
 * this seam: never a proposal, a summary, an id or a count of anything but events.
 */

afterEach(() => publishProposalsScreen(null));

describe("the proposals screen signal", () => {
  it("starts empty, holds the last published screen, and clears", () => {
    expect(readProposalsScreen()).toBeNull();
    publishProposalsScreen("list");
    expect(readProposalsScreen()).toBe("list");
    publishProposalsScreen("all_decided");
    expect(readProposalsScreen()).toBe("all_decided");
    publishProposalsScreen(null);
    expect(readProposalsScreen()).toBeNull();
  });

  it("announces every screen change on window with a plain, data-less event, and nothing when the screen is unchanged", () => {
    const heard: Event[] = [];
    const listener = (e: Event) => void heard.push(e);
    window.addEventListener(PROPOSALS_SCREEN_EVENT, listener);
    try {
      publishProposalsScreen("generating");
      publishProposalsScreen("generating");
      publishProposalsScreen("detail");
      expect(heard).toHaveLength(2);
      expect(heard[0]!.constructor).toBe(Event);
      expect(PROPOSALS_SCREEN_EVENT).toBe("bee6:proposals-screen");
    } finally {
      window.removeEventListener(PROPOSALS_SCREEN_EVENT, listener);
    }
  });

  it("a progress change bumps a counter and fires its own data-less event, every time", () => {
    const heard: Event[] = [];
    const listener = (e: Event) => void heard.push(e);
    window.addEventListener(PROPOSALS_PROGRESS_EVENT, listener);
    try {
      const before = readProposalsProgressVersion();
      publishProposalsProgress();
      publishProposalsProgress();
      expect(readProposalsProgressVersion()).toBe(before + 2);
      expect(heard).toHaveLength(2);
      expect(heard[0]!.constructor).toBe(Event);
      expect(PROPOSALS_PROGRESS_EVENT).toBe("bee6:proposals-progress");
    } finally {
      window.removeEventListener(PROPOSALS_PROGRESS_EVENT, listener);
    }
  });
});
