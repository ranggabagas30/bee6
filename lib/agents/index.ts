/**
 * Agents built with Google's Agent Development Kit (ADK) for TypeScript
 * (docs/architecture.md "Named agents and guardrails").
 *
 *   - R-08: built: proposal-agent.ts — ProposalAgent picks an intervention
 *     from the library, cites the rubric plus >=2 dated evidence items
 *     (Gemini 3.5 Flash, ADK `LlmAgent` + `InMemoryRunner`).
 *   - R-11: ReviewAgent — on the review date, decides worked / revise /
 *     revert (Gemini 3.5 Flash + Cloud Scheduler).
 *   - R-15: CriticAgent — checks proposals using the evidence gate
 *     (lib/pipeline) as a tool (Gemini 3.5 Flash).
 *   - R-16: DebriefAgent — evening voice debrief, agent speaks first,
 *     tap fallback (Live API model).
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
