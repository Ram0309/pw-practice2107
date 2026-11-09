import { END, START, StateGraph } from '@langchain/langgraph';
import { env } from '../config/env.js';
import { logger } from '../core/logger.js';
import { knowledgeBase } from '../knowledge/knowledge-base.js';
import type { AgentResult } from '../agents/base-agent.js';
import {
  apiAgent,
  codeValidatorAgent,
  executionAgent,
  healingAgent,
  knowledgeAgent,
  reportingAgent,
  requirementAgent,
  scriptGeneratorAgent,
  testDesignAgent,
  uiAnalysisAgent
} from '../agents/index.js';
import type { AgentTrace } from '../schemas/index.js';
import { QaState, type QaStateType, type QaStateUpdate, type RunOptions } from './state.js';

/**
 * MASTER ORCHESTRATOR (LangGraph.js)
 * ----------------------------------
 *
 *  START → knowledge → requirement → testDesign → uiAnalysis → scriptGenerator → codeValidator
 *                                                                   ↑                  │
 *                                                                   └── invalid & attempts left
 *                                                                                      │
 *                                       ┌──────────── execute? ───────────────────────┤
 *                                       ▼                                              ▼
 *                                   execution ── locator failures & heal? ──► healing ─┐
 *                                       │  ▲                                           │
 *                                       │  └──── repair applied: re-run once ──────────┘
 *                                       ▼
 *                                      api → reporting → END
 *
 * Each node wraps one agent, records an AgentTrace entry, and converts exceptions
 * into state.errors so one failing agent does not crash the whole run.
 */

const log = logger.child({ agent: 'orchestrator' });

async function step<T>(
  agent: string,
  fn: () => Promise<AgentResult<T>>
): Promise<{ output: T | null; trace: AgentTrace; error: string | null }> {
  const started = Date.now();
  try {
    const r = await fn();
    return {
      output: r.output,
      trace: { agent, mode: r.mode, provider: r.provider, durationMs: r.durationMs, status: 'ok', note: r.warnings[0] ?? null },
      error: null
    };
  } catch (e) {
    const error = `${agent}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 1000);
    log.error({ err: error }, 'agent failed');
    return { output: null, trace: { agent, mode: '-', provider: '-', durationMs: Date.now() - started, status: 'error', note: error.slice(0, 200) }, error };
  }
}

const skippedTrace = (agent: string, note: string): AgentTrace => ({ agent, mode: '-', provider: '-', durationMs: 0, status: 'skipped', note });
const withError = (error: string | null) => (error ? [error] : []);

// ───────────────────────────── nodes ─────────────────────────────

async function knowledgeNode(s: QaStateType): Promise<QaStateUpdate> {
  const r = await step('knowledge', () => knowledgeAgent.run({ query: s.story, k: 6 }));
  return { knowledge: r.output, trace: [r.trace], errors: withError(r.error) };
}

async function requirementNode(s: QaStateType): Promise<QaStateUpdate> {
  const r = await step('requirement', () => requirementAgent.run({ text: s.story, storyId: s.storyId }));
  return { requirement: r.output, trace: [r.trace], errors: withError(r.error) };
}

async function testDesignNode(s: QaStateType): Promise<QaStateUpdate> {
  const r = await step('testDesign', () => testDesignAgent.run(s.requirement!));
  return { testPlan: r.output, trace: [r.trace], errors: withError(r.error) };
}

async function uiAnalysisNode(s: QaStateType): Promise<QaStateUpdate> {
  const modules = await knowledgeBase.modules();
  const page = modules.find(m => m.name === s.requirement?.module)?.pages.find(p => !p.includes('{')) ?? '/';
  const r = await step('uiAnalysis', () => uiAnalysisAgent.run({ path: page }));
  return { uiMap: r.output, trace: [r.trace], errors: withError(r.error) };
}

async function scriptGeneratorNode(s: QaStateType): Promise<QaStateUpdate> {
  const attempt = s.generationAttempt + 1;
  const failed = new Map(s.validations.filter(v => !v.valid).map(v => [v.testCaseId, v.issues]));
  const cases = (s.testPlan?.testCases ?? [])
    .filter(tc => tc.automationCandidate)
    .slice(0, s.options.maxScripts)
    .filter(tc => attempt === 1 || failed.has(tc.id)); // on retries only regenerate rejected scripts

  const scripts = [];
  const trace: AgentTrace[] = [];
  const errors: string[] = [];
  for (const tc of cases) {
    const r = await step('scriptGenerator', () =>
      scriptGeneratorAgent.run({
        requirementId: s.requirement!.id,
        module: s.requirement!.module,
        testCase: tc,
        uiMap: s.uiMap,
        previousIssues: failed.get(tc.id),
        attempt
      })
    );
    if (r.output) scripts.push(r.output);
    trace.push({ ...r.trace, note: `${tc.id} (attempt ${attempt})${r.trace.note ? ` ${r.trace.note}` : ''}` });
    errors.push(...withError(r.error));
  }
  return { scripts, generationAttempt: attempt, trace, errors };
}

async function codeValidatorNode(s: QaStateType): Promise<QaStateUpdate> {
  const pending = s.scripts.filter(sc => sc.attempt === s.generationAttempt);
  const validations = [];
  const trace: AgentTrace[] = [];
  const errors: string[] = [];
  for (const sc of pending) {
    const r = await step('codeValidator', () => codeValidatorAgent.run({ filePath: sc.filePath, testCaseId: sc.testCaseId, code: sc.code }));
    if (r.output) validations.push(r.output);
    trace.push({ ...r.trace, note: `${sc.testCaseId}: score ${r.output?.score ?? '-'}${r.output?.valid === false ? ' REJECTED' : ''}` });
    errors.push(...withError(r.error));
  }
  return { validations, trace, errors };
}

async function executionNode(s: QaStateType): Promise<QaStateUpdate> {
  const files = s.validations.filter(v => v.approvedForExecution).map(v => v.filePath);
  const r = await step('execution', () => executionAgent.run({ project: 'generated', files, runId: s.runId, allowGenerated: s.options.execute }));
  return { execution: r.output, trace: [r.trace], errors: withError(r.error) };
}

async function healingNode(s: QaStateType): Promise<QaStateUpdate> {
  const failures = (s.execution?.failures ?? []).filter(f => f.failedLocator && f.pageUrl).slice(0, 3);
  const healing = [];
  const trace: AgentTrace[] = [];
  const errors: string[] = [];
  for (const f of failures) {
    const r = await step('healing', () =>
      healingAgent.run({ brokenLocator: f.failedLocator!, pageUrl: f.pageUrl!, errorMessage: f.error, testFile: f.file.startsWith('generated-tests') ? f.file : `generated-tests/${f.file}` })
    );
    if (r.output) healing.push(r.output);
    trace.push({ ...r.trace, note: `${f.failedLocator} → ${r.output?.recommended?.code ?? 'no candidate'} (${r.output?.status ?? 'error'})` });
    errors.push(...withError(r.error));
  }
  const applied = healing.some(h => h.status === 'applied');
  return { healing, trace, errors, rerunAfterHealing: applied && !s.rerunAfterHealing };
}

async function apiNode(s: QaStateType): Promise<QaStateUpdate> {
  const modules = await knowledgeBase.modules();
  const focus = modules.find(m => m.name === s.requirement?.module)?.keywords.filter(k => !k.includes(' ')).slice(0, 4);
  const r = await step('api', () => apiAgent.run({ focus, name: s.requirement?.id ?? 'storefront' }));
  return { apiPlan: r.output, trace: [r.trace], errors: withError(r.error) };
}

async function reportingNode(s: QaStateType): Promise<QaStateUpdate> {
  const r = await step('reporting', () =>
    reportingAgent.run({
      runId: s.runId,
      requirement: s.requirement,
      testPlan: s.testPlan,
      scripts: s.scripts,
      validations: s.validations,
      execution: s.execution,
      healing: s.healing,
      apiPlan: s.apiPlan,
      trace: s.trace,
      errors: s.errors
    })
  );
  return { report: r.output, trace: [r.trace], errors: withError(r.error) };
}

// ───────────────────────────── routing ─────────────────────────────

/** Stop early when the requirement could not be analysed: nothing downstream would be meaningful. */
const afterRequirement = (s: QaStateType) => (s.requirement ? 'testDesignAgent' : 'reportingAgent');
const afterTestDesign = (s: QaStateType) => (s.testPlan ? 'uiAnalysisAgent' : 'reportingAgent');

function afterValidation(s: QaStateType): 'scriptGeneratorAgent' | 'executionAgent' | 'apiAgent' {
  const rejected = s.validations.some(v => !v.valid);
  if (rejected && s.generationAttempt < env.MAX_GENERATION_ATTEMPTS) {
    log.warn({ attempt: s.generationAttempt }, 'validator rejected scripts; regenerating with feedback');
    return 'scriptGeneratorAgent';
  }
  return s.options.execute ? 'executionAgent' : 'apiAgent';
}

function afterExecution(s: QaStateType): 'healingAgent' | 'apiAgent' {
  const healable = s.execution?.failures.some(f => f.failedLocator && f.pageUrl);
  return s.options.heal && healable && !s.rerunAfterHealing ? 'healingAgent' : 'apiAgent';
}

const afterHealing = (s: QaStateType) => (s.rerunAfterHealing ? 'executionAgent' : 'apiAgent');

// ───────────────────────────── graph ─────────────────────────────

export const qaGraph = new StateGraph(QaState)
  .addNode('knowledgeAgent', knowledgeNode)
  .addNode('requirementAgent', requirementNode)
  .addNode('testDesignAgent', testDesignNode)
  .addNode('uiAnalysisAgent', uiAnalysisNode)
  .addNode('scriptGeneratorAgent', scriptGeneratorNode)
  .addNode('codeValidatorAgent', codeValidatorNode)
  .addNode('executionAgent', executionNode)
  .addNode('healingAgent', healingNode)
  .addNode('apiAgent', apiNode)
  .addNode('reportingAgent', reportingNode)
  .addEdge(START, 'knowledgeAgent')
  .addEdge('knowledgeAgent', 'requirementAgent')
  .addConditionalEdges('requirementAgent', afterRequirement, ['testDesignAgent', 'reportingAgent'])
  .addConditionalEdges('testDesignAgent', afterTestDesign, ['uiAnalysisAgent', 'reportingAgent'])
  .addEdge('uiAnalysisAgent', 'scriptGeneratorAgent')
  .addEdge('scriptGeneratorAgent', 'codeValidatorAgent')
  .addConditionalEdges('codeValidatorAgent', afterValidation, ['scriptGeneratorAgent', 'executionAgent', 'apiAgent'])
  .addConditionalEdges('executionAgent', afterExecution, ['healingAgent', 'apiAgent'])
  .addConditionalEdges('healingAgent', afterHealing, ['executionAgent', 'apiAgent'])
  .addEdge('apiAgent', 'reportingAgent')
  .addEdge('reportingAgent', END)
  .compile();

export async function runQaPipeline(input: { runId: string; story: string; storyId?: string; options: RunOptions }) {
  log.info({ runId: input.runId, options: input.options }, 'QA pipeline started');
  const final = await qaGraph.invoke(input, { recursionLimit: 40 });
  log.info({ runId: input.runId, verdict: final.report?.verdict, errors: final.errors.length }, 'QA pipeline finished');
  return final;
}
