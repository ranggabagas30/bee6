import { afterEach, describe, expect, it, vi } from "vitest";

// R-24 D11: the page reads the estimated wait from the runtime env on each request and hands it to the client app.
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/app/proposals/ProposalsApp", () => ({ ProposalsApp: () => null }));

import ProposalsPage from "@/app/proposals/page";

afterEach(() => vi.unstubAllEnvs());

async function propsOf() {
  const element = (await ProposalsPage()) as unknown as { props: { askEstimate: unknown } };
  return element.props;
}

describe("/proposals page (R-24 D11)", () => {
  it("flag unset: askEstimate is null, so the Ask screen is today's", async () => {
    vi.stubEnv("PROPOSAL_AGENT_V4", "");
    expect((await propsOf()).askEstimate).toBeNull();
  });

  it("flag \"TRUE\" or \"1\": still null", async () => {
    vi.stubEnv("PROPOSAL_AGENT_V4", "TRUE");
    expect((await propsOf()).askEstimate).toBeNull();
    vi.stubEnv("PROPOSAL_AGENT_V4", "1");
    expect((await propsOf()).askEstimate).toBeNull();
  });

  it("flag \"true\": the 10-30 second range, read per request", async () => {
    vi.stubEnv("PROPOSAL_AGENT_V4", "true");
    expect((await propsOf()).askEstimate).toEqual({ min_s: 10, max_s: 30 });
    vi.stubEnv("PROPOSAL_AGENT_V4", "false");
    expect((await propsOf()).askEstimate).toBeNull();
  });
});
