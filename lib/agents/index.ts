/**
 * Agents built with Google's Agent Development Kit (ADK) for TypeScript
 * (docs/architecture.md "Named agents and guardrails").
 *
 * This folder is a placeholder for R-01. Later tasks add, in order:
 *   - R-08: ProposalAgent — picks an intervention from the library, cites
 *     the rubric plus >=2 dated evidence items (Gemini 3.5 Flash).
 *   - R-11: ReviewAgent — on the review date, decides worked / revise /
 *     revert (Gemini 3.5 Flash + Cloud Scheduler).
 *   - R-15: CriticAgent — checks proposals using the evidence gate
 *     (lib/pipeline) as a tool (Gemini 3.5 Flash).
 *   - R-16: DebriefAgent — evening voice debrief, agent speaks first,
 *     tap fallback (Live API model).
 *
 * CLAUDE.md: if the ADK package name/API isn't confirmed and blocks R-08
 * for more than 2 hours, the fallback is a plain state machine calling
 * Gemini directly. Nothing here is wired up yet.
 */

export {};
