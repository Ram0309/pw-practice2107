# Architecture

## 1. Layers

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ ENTRY POINTS     CLI (src/cli.ts)   ·   CI: GitHub Actions / Jenkins       │
├────────────────────────────────────────────────────────────────────────────┤
│ ORCHESTRATION    Master Orchestrator: LangGraph StateGraph                 │
│                  (src/orchestrator) state + reducers + conditional routing │
├────────────────────────────────────────────────────────────────────────────┤
│ AGENTS (10)      BaseAgent contract: offline() | withLlm() → Zod-validated │
│                  Requirement · TestDesign · Knowledge · UiAnalysis ·       │
│                  ScriptGenerator · CodeValidator · Execution · Healing ·   │
│                  Api · Reporting                                           │
├──────────────────────────┬──────────────────────────┬──────────────────────┤
│ MODEL ABSTRACTION        │ KNOWLEDGE                │ BROWSER / RUNNER     │
│ src/llm                  │ src/knowledge            │ src/browser          │
│ providers.ts (factory,   │ BM25 retriever over      │ DOM snapshot,        │
│  per-agent routing)      │ project-knowledge/*.md   │ locator specs,       │
│ structured.ts (Zod +     │ (KnowledgeRetriever      │ live validation      │
│  retry with feedback)    │  interface → vector DB)  │ Playwright CLI       │
│ prompts.ts (prompts/*.md)│                          │                      │
├──────────────────────────┴──────────────────────────┴──────────────────────┤
│ TEST ASSETS      src/pages (page objects) · src/fixtures · test-data/      │
│                  tests/ui · tests/api (curated) · generated-tests/ (AI)    │
├────────────────────────────────────────────────────────────────────────────┤
│ CROSS-CUTTING    src/config/env.ts (Zod) · src/core/logger.ts (Pino) ·     │
│                  src/core/artifacts.ts (guarded writes) · src/schemas (Zod)│
└────────────────────────────────────────────────────────────────────────────┘
```

## 2. Orchestration graph

```text
START → knowledge → requirement ─┬─► testDesign ─┬─► uiAnalysis → scriptGenerator → codeValidator
                                 │               │                     ▲                 │
                                 └── failed ─────┴──► reporting        └─ rejected and   │
                                                                          attempts left ─┤
                                         ┌──────────── --execute ────────────────────────┤
                                         ▼                                               ▼
                                     execution ── locator failures ──► healing ──┐      api
                                         │  ▲                                    │       │
                                         │  └──── repair applied: re-run once ───┘       │
                                         └──────────────────────────────────────────────►│
                                                                                         ▼
                                                                          reporting → END
```

Node ids in code carry an `Agent` suffix (`requirementAgent`) because LangGraph forbids a
node and a state channel having the same name.

State (`src/orchestrator/state.ts`) uses reducers:
- `replace`: requirement, testPlan, uiMap, execution, report
- `upsertBy(testCaseId)`: scripts and validations, so a regenerated script replaces the rejected one
- `append`: healing proposals, agent trace and errors

Each node wraps its agent in `step()`. An exception becomes an entry in `state.errors` and a
trace row, so one failing agent never crashes the run. The report shows it.

## 3. The agent contract (`src/agents/base-agent.ts`)

| Piece | Purpose |
|---|---|
| `offline(input)` | Deterministic rule-based logic. Always available: no key, no cost, repeatable. Used with `LLM_PROVIDER=mock`, in unit tests and CI, and as a fallback. |
| `withLlm(input)` | AI reasoning through the model abstraction. Every LLM path first computes the offline baseline and passes it to the model as grounding. |
| `outputSchema` | Zod schema. `run()` validates every output, so malformed data never reaches the next agent. |
| guardrails | After an LLM call, agents filter what the model may not decide: invented rule ids, locators that were not validated, endpoints that are not documented, or the verdict. |

## 4. Model independence

- Agents never import a vendor SDK. `createChatModel(route)` returns a LangChain `BaseChatModel`.
- Providers: `openai` (plus any OpenAI-compatible URL), `azure-openai`, `anthropic`, `google`, `ollama` (local), and `mock`.
- Per-agent routing: `LLM_AGENT_ROUTES=scriptGenerator=anthropic:claude-sonnet-5-5;healing=ollama:llama3.1`.
- `withStructuredOutput(zodSchema)` gives typed output from every provider. `invokeStructured` re-validates
  and, on a schema error, sends the issues back to the model for a corrected answer.
- `LLM_FALLBACK_TO_OFFLINE=true`: provider outage → agent uses offline logic and the trace records it.

## 5. Safety model

| Risk | Control |
|---|---|
| Prompt injection via requirements, DOM or knowledge | Shared policy prompt treats all of these as data; outputs are schema-checked and filtered |
| Unsafe generated code | Code Validator: TypeScript syntax check plus policy rules (no child_process, fs, eval, process.env, external hosts, test.only, order confirmation) |
| Running unreviewed code | Execution needs `--execute` or `ALLOW_GENERATED_TEST_EXECUTION=true`, and only runs files the validator approved |
| Wrong "healing" that hides bugs | Only `locator` failures are healed; candidates must match exactly one visible element; assertions are never changed |
| Silent changes to curated code | Auto-repair only in `generated-tests/` with `HEALING_MODE=auto-generated`; page objects and curated tests are suggestion-only |
| Writes outside the project | `artifacts.ts` only writes to `reports/` and `generated-tests/` |
| Load on the shared demo | 2 workers, no load tests, fresh session per test |
| Secrets | `.env` is git-ignored; CI secrets; Pino redacts `apiKey`, `password`, `token` |

## 6. Data flow and artifacts

| Artifact | Producer | Location |
|---|---|---|
| Requirement analysis | Requirement Agent | `reports/agents/requirement-analysis.json` |
| Test plan and traceability | Test Design Agent | `reports/agents/test-plan.json`, run report |
| UI map | UI Analysis Agent | `reports/agents/ui-map*.json` |
| Generated specs | Script Generator / API Agent | `generated-tests/<req>/*.spec.ts`, `generated-tests/api/*.api.spec.ts` |
| Execution JSON | Execution Agent | `reports/runs/<runId>/execution-generated.json` |
| Healing audit trail | Healing Agent | `reports/healing/healing-history.jsonl` |
| QA report | Reporting Agent | `reports/runs/<runId>/report.{md,html,json}`, `reports/latest-report.json` |
| Playwright reports | Playwright | `reports/playwright-html`, `reports/junit.xml`, `reports/playwright-results.json` |
| Logs | Pino | `logs/framework.log` (JSON lines) |
