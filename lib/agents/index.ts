/**
 * Agents built with Google's Agent Development Kit (ADK) for TypeScript
 * (docs/architecture.md "Named agents and guardrails").
 *
 *   - R-08: built: proposal-agent.ts — ProposalAgent picks an intervention
 *     from the library, cites the rubric plus >=2 dated evidence items
 *     (Gemini 3.5 Flash, ADK `LlmAgent` + `InMemoryRunner`).
 *   - R-11: ReviewAgent — on the review date, decides worked / revise /
 *     revert (Gemini 3.5 Flash + Cloud Scheduler).
 *   - ReviewAgent (review-agent.ts, sandbox only, flag REVIEW_AGENT, built; nothing calls it until the service
 *     wiring ships): explains the before/after counts of one shipped SOP change in plain English. Read-only tools
 *     plus the plain-code checker `check_review`; the verdict stays `suggestVerdict`'s (Gemini 3.5 Flash-Lite, ADK
 *     `LlmAgent` + `InMemoryRunner`). See docs/tasks/review-agent-18oct.md.
 *   - R-15: CriticAgent — checks proposals using the evidence gate
 *     (lib/pipeline) as a tool (Gemini 3.5 Flash).
 *   - R-16: voice debrief (agent speaks first, tap fallback, Live API model) — not built; "if time".
 *   - DebriefAgent (debrief-agent.ts, sandbox only, flag DEBRIEF_AGENT): question WORDING only, no voice. It words
 *     the heading of a debrief question the plain-code evidence gate already created; its one tool is the plain-code
 *     checker `check_question` (Gemini 3.5 Flash-Lite, ADK `LlmAgent` + `InMemoryRunner`). See
 *     docs/tasks/debrief-agent-18oct.md. It never picks moments, never sees the SOP, never writes an SOP change.
 */

export {
  PROPOSAL_MODEL,
  PROPOSAL_AGENT_VERSION,
  PROPOSAL_GENERATOR_KIND,
  PROPOSAL_THINKING_CONFIG,
  adkProposalModel,
  type ProposalModel,
  type ProposalModelUsage,
  type ProposalModelResult,
} from "@/lib/agents/proposal-agent";
