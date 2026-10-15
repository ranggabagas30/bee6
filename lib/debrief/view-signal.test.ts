// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEBRIEF_VIEW_EVENT } from "@/lib/debrief/constants";
import { publishDebriefView, readDebriefView, subscribeDebriefView } from "@/lib/debrief/view-signal";

/**
 * R-19 PR-5 round-4 D2: the debrief tells the same document which screen it shows (its view kind, nothing else)
 * the moment the screen changes, so the capture page's guide bridge follows the page's own question screen
 * instead of waiting for the next config re-poll (up to CONFIG_REPOLL_MS late when the two polls were out of
 * phase). A tiny external store plus a plain window Event: no question ids, no text, no counts.
 */

afterEach(() => publishDebriefView(null));

describe("the debrief view signal", () => {
  it("starts empty, holds the last published view kind, and clears", () => {
    expect(readDebriefView()).toBeNull();
    publishDebriefView("preparing");
    expect(readDebriefView()).toBe("preparing");
    publishDebriefView("question");
    expect(readDebriefView()).toBe("question");
    publishDebriefView(null);
    expect(readDebriefView()).toBeNull();
  });

  it("announces every change on window with a plain, data-less event, and nothing when the kind is unchanged", () => {
    const heard: Event[] = [];
    const listener = (e: Event) => void heard.push(e);
    window.addEventListener(DEBRIEF_VIEW_EVENT, listener);
    try {
      publishDebriefView("preparing");
      publishDebriefView("preparing");
      publishDebriefView("question");
      expect(heard).toHaveLength(2);
      expect(heard[0]!.constructor).toBe(Event);
      expect(DEBRIEF_VIEW_EVENT).toBe("bee6:debrief-view");
    } finally {
      window.removeEventListener(DEBRIEF_VIEW_EVENT, listener);
    }
  });

  it("subscribers are called on change and stop being called after unsubscribing", () => {
    const onChange = vi.fn();
    const off = subscribeDebriefView(onChange);
    publishDebriefView("waiting_more");
    expect(onChange).toHaveBeenCalledTimes(1);
    off();
    publishDebriefView("done");
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
