# Implementation Roadmap

## Step 1 (done): foundation and first working agent
- Prerequisites, project setup, pinned dependencies, Zod-validated config, Pino logging
- Model abstraction (6 providers + per-agent routing + offline fallback)
- Project knowledge for Demo Web Shop (verified against the live site), test data
- Agent 1 Requirement Agent: offline and LLM paths, 8 unit tests
- Page objects, fixtures, curated UI and API smoke suite (10 tests, passing on the live site)

## Step 1 also includes: full agent baseline
- All 10 agents with offline logic + LLM path, LangGraph orchestrator, CLI, CI pipelines
- End-to-end pipeline verified on REQ-001: 3 generated tests approved and passing

## Next steps (recommended order)
1. **Connect a real model**: set `LLM_PROVIDER` and a key, run `npm run agent:requirement`, and compare with offline output.
2. **Human approval gate**: LangGraph `interrupt()` before execution and before applying repairs,
   with a persistent checkpointer (`@langchain/langgraph-checkpoint-sqlite` or Postgres) so runs can pause and resume.
3. **RAG upgrade**: implement `KnowledgeRetriever` with embeddings and a vector store (e.g. pgvector, Chroma or LanceDB);
   ingest more sources (Jira stories, Confluence, OpenAPI).
4. **Allure reporting**: add `allure-playwright`, publish in CI next to the Playwright HTML report.
5. **More page objects and templates**: Checkout (up to shipping), Registration, Category sort/filter, Wishlist.
6. **Authenticated flows**: one registered account in CI secrets, `storageState` login setup project.
7. **Token and cost tracking**: LangChain callbacks → per-agent token usage in the report.
8. **Flaky-test intelligence**: track pass/fail history per test across runs; quarantine and report flakiness.
9. **Accessibility and visual checks**: `@axe-core/playwright` scans, `toHaveScreenshot` baselines.
10. **Test management integration**: push test cases and results to Jira Xray / TestRail.
11. **Sandboxed execution**: run generated tests in an isolated container with network egress limited to the app host.
12. **Observability**: LangSmith or OpenTelemetry tracing of every graph step.
