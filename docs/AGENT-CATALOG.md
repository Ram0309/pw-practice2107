# Agent Catalogue

| # | Agent | File | Input → Output | Offline logic | LLM adds | Guardrail |
|---|---|---|---|---|---|---|
| 1 | Requirement | `requirement.agent.ts` | user story → `RequirementAnalysis` | story/AC parser, module detection from modules.md, rule matching, vague-term detection | better wording, implicit criteria, sharper questions | only known rule ids; stable requirement id |
| 2 | Test Design | `test-design.agent.ts` | requirement → `TestPlan` | one case per testable AC, boundary values from "N characters" rules, test data from test-data/ | extra negative and edge cases | ids and traceability recomputed; untestable AC → gaps |
| 3 | Knowledge (RAG) | `knowledge.agent.ts` | question → `KnowledgeAnswer` | BM25 retrieval plus extractive answer | grounded summary | citations filtered to retrieved chunks |
| 4 | UI Analysis | `ui-analysis.agent.ts` | page path → `UiMap` | DOM snapshot, implicit ARIA roles, locator candidates checked for uniqueness | element purpose and page summary | only refs from the snapshot |
| 5 | Script Generator | `script-generator.agent.ts` | test case (+ UI map, + previous issues) → `GeneratedScript` | page-object templates per module; `test.fixme` when not automatable | free-form spec using page-object API and verified locators | output always goes through agent 6 |
| 6 | Code Validator | `code-validator.agent.ts` | spec source → `ValidationResult` | TS syntax, structure, 12 policy rules, host allow-list, score | semantic review | LLM cannot remove static errors |
| 7 | Execution | `execution.agent.ts` | files/project → `ExecutionResult` | Playwright child process, JSON report parsing, locator and page-URL extraction | (none, deterministic) | explicit opt-in, approved files only, hard timeout |
| 8 | Self-Healing | `healing.agent.ts` | broken locator + page → `HealingProposal` | classify, similarity search over live DOM, validate exactly-one-visible | classification and choice among validated candidates | heals locators only, never assertions; auto-apply only to generated-tests; audit log |
| 9 | API | `api.agent.ts` | api-contracts.md → `ApiPlan` + spec | tests from documented examples, template rendering | extra contract and boundary tests | documented, safe endpoints only; code rendered from data |
| 10 | Reporting | `reporting.agent.ts` | run state → `QaReport` (+ md/html/json) | metrics, verdict, risks, next actions | executive narrative | verdict and metrics never come from the LLM |
| 11 | Master Orchestrator | `orchestrator/qa-graph.ts` | requirement → final state | LangGraph StateGraph with retries, execution and healing loops | (none) | recursion limit, per-node error capture |
| 12 | CI/CD | `.github/workflows/smoke-tests.yml`, `.github/workflows/ai-pipeline.yml`, `Jenkinsfile` | every commit / PR / daily & weekday schedules / manual | framework tests → smoke → AI pipeline | provider from CI variables | keys from secrets; artifacts archived |
