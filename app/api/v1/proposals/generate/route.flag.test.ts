import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * R-24 B4: the PROPOSAL_AGENT_V4 flag at the route. The service is mocked so the test sees exactly what the route
 * hands it: `agentV4` is the ADK runner only when the env var is exactly "true", otherwise `null`; everything
 * else the route does (guard, body validation, demo caps, response) is the already-tested route.test.ts path.
 */
const verifyIdToken = vi.fn();
vi.mock("@/lib/firebase/admin", () => ({
  verifyIdToken: (...args: unknown[]) => verifyIdToken(...args),
}));
vi.mock("@/lib/firestore/proposal-store");
vi.mock("@/lib/firestore/demo-store");

vi.mock("@/lib/agents/proposal-agent", () => ({
  adkProposalModel: vi.fn(),
  PROPOSAL_GENERATOR_KIND: "adk",
  PROPOSAL_MODEL: "gemini-3.5-flash",
  PROPOSAL_AGENT_VERSION: "proposal-v3",
}));
const { RUNNER, generateProposal } = vi.hoisted(() => ({ RUNNER: vi.fn(), generateProposal: vi.fn() }));
vi.mock("@/lib/agents/proposal-agent-v4", () => ({
  adkProposalAgentV4: RUNNER,
  PROPOSAL_AGENT_V4_VERSION: "proposal-v4",
}));
vi.mock("@/lib/redact/batch", () => ({ redactBatch: () => async (texts: readonly string[]) => [...texts] }));
vi.mock("@/lib/proposals/service", () => ({ generateProposal: (...args: unknown[]) => generateProposal(...args) }));

import { POST } from "./route";

const BODY = { from_date: "2026-10-01", to_date: "2026-10-02" };
const RESULT = { proposal: { proposal_id: "p" }, reused: false };

function post(role: string, body: unknown = BODY) {
  verifyIdToken.mockResolvedValueOnce({
    uid: "u1",
    email: "x@proofed.test",
    email_verified: true,
    claims: { outlet_id: "proofed", role },
  });
  return POST(
    new NextRequest("http://localhost/api/v1/proposals/generate", {
      method: "POST",
      headers: new Headers({ "content-type": "application/json", authorization: "Bearer t" }),
      body: JSON.stringify(body),
    }),
  );
}
const depsPassed = () => generateProposal.mock.calls[0]![1] as { agentV4: unknown; model: unknown };

beforeEach(() => {
  generateProposal.mockReset();
  generateProposal.mockResolvedValue(RESULT);
  verifyIdToken.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/v1/proposals/generate: PROPOSAL_AGENT_V4", () => {
  it("unset -> agentV4 is null and the v3 model is still wired", async () => {
    vi.stubEnv("PROPOSAL_AGENT_V4", "");
    delete process.env.PROPOSAL_AGENT_V4;
    const res = await post("supervisor");
    expect(res.status).toBe(201);
    expect(depsPassed().agentV4).toBeNull();
    expect(typeof depsPassed().model).toBe("function");
  });

  it.each(["false", "TRUE", "True", "1", "yes", " true", "true "])("%j -> agentV4 is null", async (value) => {
    vi.stubEnv("PROPOSAL_AGENT_V4", value);
    await post("supervisor");
    expect(depsPassed().agentV4).toBeNull();
  });

  it('exactly "true" -> agentV4 is the ADK runner (read per request)', async () => {
    vi.stubEnv("PROPOSAL_AGENT_V4", "true");
    await post("owner");
    expect(depsPassed().agentV4).toBe(RUNNER);
    generateProposal.mockClear();
    vi.stubEnv("PROPOSAL_AGENT_V4", "false");
    await post("owner");
    expect(depsPassed().agentV4).toBeNull();
  });

  it("the guard and body validation are unchanged: no bearer -> 401, a bad body -> 422, and the service is not reached in either", async () => {
    vi.stubEnv("PROPOSAL_AGENT_V4", "true");
    const noAuth = await POST(
      new NextRequest("http://localhost/api/v1/proposals/generate", { method: "POST", body: JSON.stringify(BODY) }),
    );
    expect(noAuth.status).toBe(401);
    expect(generateProposal).not.toHaveBeenCalled();
    const bad = await post("supervisor", { from_date: "nope" });
    expect(bad.status).toBe(422);
    expect(generateProposal).not.toHaveBeenCalled();
  });
});
