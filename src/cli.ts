import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { env } from './config/env.js';
import { newRunId, relative, writeJson } from './core/artifacts.js';
import { logger } from './core/logger.js';
import { PATHS } from './core/paths.js';
import { describeProviders } from './llm/providers.js';
import {
  apiAgent,
  codeValidatorAgent,
  executionAgent,
  healingAgent,
  knowledgeAgent,
  requirementAgent,
  testDesignAgent,
  uiAnalysisAgent
} from './agents/index.js';
import { forceOfflineMode } from './agents/base-agent.js';
import { runQaPipeline } from './orchestrator/qa-graph.js';

/**
 * Command-line entry point. Every agent can be run alone (to learn and debug it)
 * or together through the LangGraph orchestrator (`full`).
 * Results go to stdout as JSON and to reports/agents/*.json.
 */
const program = new Command()
  .name('ai-qa')
  .description('AI-QA-AGENT-FRAMEWORK: autonomous multi-agent QA for the Demo Web Shop')
  .option('--offline', 'force deterministic offline logic for this command (no LLM calls)')
  .hook('preAction', () => forceOfflineMode(Boolean(program.opts().offline)));

async function readStory(opts: { file?: string; text?: string }): Promise<{ text: string; source: string }> {
  if (opts.text) return { text: opts.text, source: 'inline' };
  const file = path.resolve(opts.file ?? path.join(PATHS.requirements, 'REQ-001-product-search.md'));
  return { text: await readFile(file, 'utf8'), source: relative(file) };
}

async function save(name: string, data: unknown) {
  const abs = await writeJson(path.join(PATHS.reports, 'agents', `${name}.json`), data);
  logger.info(`saved ${relative(abs)}`);
}

const print = (data: unknown) => process.stdout.write(JSON.stringify(data, null, 2) + '\n');
const runOpts = () => ({});

program
  .command('providers')
  .description('Show model providers, credentials status and per-agent routing')
  .action(() => {
    console.table(describeProviders());
    console.log(`Active: LLM_PROVIDER=${env.LLM_PROVIDER} LLM_MODEL=${env.LLM_MODEL ?? '(default)'} routes=${env.LLM_AGENT_ROUTES ?? '(none)'}`);
  });

program
  .command('requirement')
  .description('Agent 1: analyse a user story into a structured, testable requirement')
  .option('-f, --file <path>', 'requirement markdown file', 'requirements/REQ-001-product-search.md')
  .option('-t, --text <text>', 'inline requirement text')
  .action(async opts => {
    const story = await readStory(opts);
    const result = await requirementAgent.run({ text: story.text, source: story.source }, runOpts());
    await save('requirement-analysis', result);
    print(result);
  });

program
  .command('design')
  .description('Agents 1+2: requirement analysis followed by test design')
  .option('-f, --file <path>', 'requirement markdown file', 'requirements/REQ-001-product-search.md')
  .action(async opts => {
    const story = await readStory(opts);
    const req = await requirementAgent.run({ text: story.text, source: story.source }, runOpts());
    const plan = await testDesignAgent.run(req.output, runOpts());
    await save('test-plan', plan);
    print(plan);
  });

program
  .command('knowledge <query...>')
  .description('Agent 3: ask the project knowledge base')
  .action(async (query: string[]) => {
    const result = await knowledgeAgent.run({ query: query.join(' ') }, runOpts());
    await save('knowledge-answer', result);
    print(result);
  });

program
  .command('inspect')
  .description('Agent 4: inspect a page and build a UI map with verified locators')
  .option('-p, --path <path>', 'page path', '/')
  .action(async opts => {
    const result = await uiAnalysisAgent.run({ path: opts.path }, runOpts());
    await save(`ui-map${opts.path.replace(/[^a-z0-9]+/gi, '-')}`.replace(/-$/, ''), result);
    print({ ...result, output: { ...result.output, elements: result.output.elements.slice(0, 15) } });
    logger.info(`${result.output.elements.length} elements mapped (first 15 printed)`);
  });

program
  .command('validate <file>')
  .description('Agent 6: validate a generated spec file')
  .action(async (file: string) => {
    const code = await readFile(file, 'utf8');
    const result = await codeValidatorAgent.run({ filePath: file, testCaseId: path.basename(file), code }, runOpts());
    print(result);
  });

program
  .command('execute')
  .description('Agent 7: run a Playwright project and summarise results')
  .option('--project <name>', 'ui | api | generated', 'ui')
  .option('--grep <pattern>', 'only tests matching pattern')
  .action(async opts => {
    const result = await executionAgent.run({ project: opts.project, grep: opts.grep, runId: newRunId(), allowGenerated: true });
    await save('execution', result);
    print(result);
  });

program
  .command('heal')
  .description('Agent 8: diagnose a broken locator on a live page and propose a validated repair')
  .requiredOption('-l, --locator <locator>', `broken locator, e.g. "#small-searchterm" or "getByRole('button', { name: 'Serch' })"`)
  .option('-u, --url <path>', 'page where the locator should exist', '/')
  .option('-e, --error <message>', 'original Playwright error message', 'TimeoutError: waiting for locator')
  .option('--file <path>', 'generated spec file to repair (auto-apply only with HEALING_MODE=auto-generated)')
  .action(async opts => {
    const result = await healingAgent.run(
      { brokenLocator: opts.locator, pageUrl: opts.url, errorMessage: opts.error, testFile: opts.file ?? null },
      runOpts()
    );
    await save('healing-proposal', result);
    print(result);
  });

program
  .command('api')
  .description('Agent 9: design API tests from api-contracts.md and render a Playwright APIRequest spec')
  .option('--focus <words...>', 'restrict to endpoints matching these words')
  .action(async opts => {
    const result = await apiAgent.run({ focus: opts.focus, name: 'storefront' }, runOpts());
    await save('api-plan', result);
    print(result);
  });

program
  .command('full')
  .description('Master orchestrator: run all agents through the LangGraph workflow')
  .option('-f, --file <path>', 'requirement markdown file', 'requirements/REQ-001-product-search.md')
  .option('-t, --text <text>', 'inline requirement text')
  .option('--execute', 'execute approved generated tests (explicit human opt-in)')
  .option('--no-heal', 'do not run the healing agent on failures')
  .option('--max-scripts <n>', 'max scripts to generate', String(env.MAX_GENERATED_SCRIPTS))
  .action(async opts => {
    const story = await readStory(opts);
    const runId = newRunId();
    const final = await runQaPipeline({
      runId,
      story: story.text,
      options: { execute: Boolean(opts.execute) || env.ALLOW_GENERATED_TEST_EXECUTION, heal: opts.heal !== false, maxScripts: Number(opts.maxScripts) }
    });
    const summary = {
      runId,
      verdict: final.report?.verdict,
      summary: final.report?.executiveSummary,
      metrics: final.report?.metrics,
      reports: final.report?.artifacts.filter(a => a.includes('/runs/')),
      errors: final.errors
    };
    print(summary);
    if (final.report?.verdict === 'fail' || final.report?.verdict === 'blocked') process.exitCode = 1;
  });

program.parseAsync().catch(error => {
  logger.error({ err: error instanceof Error ? error.message : String(error) }, 'command failed');
  process.exitCode = 1;
});
