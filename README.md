# AI-QA-AGENT-FRAMEWORK

Autonomous, model-independent, multi-agent QA framework built with **TypeScript, LangGraph.js,
LangChain.js and Playwright**. The application under test is the
**Tricentis Demo Web Shop**: https://demowebshop.tricentis.com, a public, Amazon-like store.

Ten specialist agents, coordinated by a LangGraph master orchestrator, take a user story and
produce: requirement analysis → test plan → UI map → Playwright scripts → validation →
execution → self-healing → API tests → QA report.

Every agent has two implementations:
- **offline**: deterministic rules, no API key needed
- **LLM**: AI reasoning through any supported model provider

Because of the offline path, the whole framework runs and is testable without an API key.

- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Agent catalogue: [docs/AGENT-CATALOG.md](docs/AGENT-CATALOG.md)
- Roadmap: [docs/IMPLEMENTATION-ROADMAP.md](docs/IMPLEMENTATION-ROADMAP.md)

---

## 1. Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | 20.11+ (22 LTS recommended) | `node -v` |
| npm | 10+ | `npm -v` |
| Git | any recent | `git --version` |
| VS Code | recommended, with the *Playwright Test for VS Code* extension | |
| Internet access | for demowebshop.tricentis.com and, optionally, an LLM API | |
| LLM access (optional) | OpenAI / Azure OpenAI / Anthropic / Google key, or a local [Ollama](https://ollama.com) | |

## 2. Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
```

The default `.env` uses `LLM_PROVIDER=mock`, so everything works immediately.
To switch on AI reasoning, set one provider in `.env`:

```env
LLM_PROVIDER=openai          # or anthropic | google | azure-openai | ollama
LLM_MODEL=                   # blank = provider default
OPENAI_API_KEY=sk-...
```

Route different agents to different models:

```env
LLM_AGENT_ROUTES=scriptGenerator=anthropic:claude-sonnet-5-5;healing=ollama:llama3.1;reporting=mock
```

Check the configuration: `npm run agent:providers`

## 3. Verify the installation

```bash
npm run typecheck          # TypeScript
npm run test:framework     # 19 offline unit tests of the agents (no browser, no network)
npm run test:smoke         # 10 curated UI + API tests against the live Demo Web Shop
npm run report             # open the Playwright HTML report
```

## 4. Run the agents

| Command | Agent(s) |
|---|---|
| `npm run agent:requirement -- --file requirements/REQ-001-product-search.md` | 1 Requirement |
| `npm run agent:design -- --file requirements/REQ-002-add-to-cart.md` | 1 + 2 Test Design |
| `npm run agent:knowledge -- "search minimum length"` | 3 Knowledge / RAG |
| `npm run agent:inspect -- --path /search?q=laptop` | 4 UI Analysis |
| `npm run agent -- validate generated-tests/req-001/<file>.spec.ts` | 6 Code Validator |
| `npm run agent -- execute --project ui` | 7 Execution |
| `npm run agent:heal -- --url / --locator "#small-searchterm"` | 8 Self-Healing |
| `npm run agent:api` | 9 API |
| `npm run agent:full -- --file requirements/REQ-001-product-search.md --execute` | 11 Orchestrator: all agents |

Add `--offline` to any command to force deterministic mode without changing `.env`:
`npm run agent -- --offline full`.

Outputs:
- `reports/runs/<runId>/report.html|md|json`
- `reports/agents/*.json`
- `generated-tests/`
- `reports/healing/healing-history.jsonl`
- `logs/framework.log`

## 5. Project layout

```text
├── src/
│   ├── cli.ts                    CLI entry point (commander)
│   ├── config/env.ts             Zod-validated configuration
│   ├── core/                     logger (Pino), paths, guarded artifact writer
│   ├── llm/                      model factory, per-agent routing, structured output, prompt loader
│   ├── schemas/                  Zod contracts between agents
│   ├── knowledge/                Markdown knowledge base + BM25 retriever
│   ├── agents/                   BaseAgent + 10 specialist agents
│   ├── orchestrator/             LangGraph state and graph (master orchestrator)
│   ├── browser/                  DOM snapshot, locator specs, live locator validation
│   ├── healing/                  healing audit trail
│   ├── pages/                    Page Object Model for Demo Web Shop
│   └── fixtures/                 Playwright fixtures (page objects, test data, failure context)
├── project-knowledge/            requirements context: overview, modules, business rules, journeys, API contracts, standards
├── prompts/                      system prompts per agent + shared safety policy
├── requirements/                 input user stories (REQ-001..003)
├── test-data/                    synthetic test data
├── tests/ui | tests/api          curated smoke suites
├── tests/framework               agent unit tests
├── generated-tests/              AI-generated specs (git-ignored, review before promoting)
├── reports/  logs/               outputs (git-ignored)
├── .github/workflows/qa.yml      GitHub Actions
└── Jenkinsfile                   Jenkins pipeline
```

## 6. Safety

- Generated tests run only with `--execute` (or `ALLOW_GENERATED_TEST_EXECUTION=true`), and only if the Code Validator approved them.
- Healing repairs locators only, never assertions. Automatic repair is limited to `generated-tests/` and requires `HEALING_MODE=auto-generated`. Every decision is logged.
- Never confirm orders on the shared demo (rule BR-CHECKOUT-03, enforced by the validator).
- At most 2 workers. Synthetic data only. Secrets only in `.env` or CI secret stores.

## 7. Adapting to another application

1. Rewrite `project-knowledge/*.md`. Keep the `## Module:` / `- Keywords:` / `- Rules:` format and the `BR-` rule ids.
2. Update `APP_BASE_URL`, `test-data/`, `src/pages/` and `prompts/page-object-api.md`.
3. Add module templates in `script-generator.agent.ts`, or rely on the LLM path.
4. Document endpoints in the JSON block of `api-contracts.md`.
