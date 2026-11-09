import path from 'node:path';
import { env } from '../config/env.js';
import { relative, writeJson, writeText } from '../core/artifacts.js';
import { PATHS } from '../core/paths.js';
import { invokeStructured } from '../llm/structured.js';
import { systemPrompt } from '../llm/prompts.js';
import {
  LlmReportNarrativeSchema,
  QaReportSchema,
  type AgentTrace,
  type ApiPlan,
  type ExecutionResult,
  type GeneratedScript,
  type HealingProposal,
  type QaReport,
  type RequirementAnalysis,
  type TestPlan,
  type ValidationResult
} from '../schemas/index.js';
import { BaseAgent } from './base-agent.js';

/**
 * AGENT 10 — REPORTING AGENT
 * --------------------------
 * Compiles everything the run produced into report.json, report.md and report.html.
 * Metrics and the verdict are computed deterministically from evidence; an LLM can
 * only write the narrative (summary, risks, next actions). It can never claim
 * a pass that the Execution Agent did not observe.
 */
export interface ReportInput {
  runId: string;
  requirement: RequirementAnalysis | null;
  testPlan: TestPlan | null;
  scripts: GeneratedScript[];
  validations: ValidationResult[];
  execution: ExecutionResult | null;
  healing: HealingProposal[];
  apiPlan: ApiPlan | null;
  trace: AgentTrace[];
  errors: string[];
}

export class ReportingAgent extends BaseAgent<ReportInput, QaReport> {
  readonly name = 'reporting' as const;
  readonly description = 'Reporting Agent: produce QA report';
  protected readonly outputSchema = QaReportSchema;

  protected async offline(input: ReportInput): Promise<QaReport> {
    const report = buildReport(input);
    await this.write(report, input);
    return report;
  }

  protected async withLlm(input: ReportInput): Promise<QaReport> {
    const base = buildReport(input);
    const narrative = await invokeStructured({
      agent: this.name,
      schema: LlmReportNarrativeSchema,
      schemaName: 'report_narrative',
      system: await systemPrompt('reporting-agent'),
      user: `VERDICT (fixed): ${base.verdict}\nMETRICS:\n${JSON.stringify(base.metrics, null, 2)}\nRISKS FOUND:\n${base.risks.join('\n')}\nOPEN QUESTIONS:\n${input.requirement?.openQuestions.join('\n') ?? 'none'}\nFAILURES:\n${input.execution?.failures.map(f => `${f.title}: ${f.error.slice(0, 300)}`).join('\n') || 'none'}`
    });
    const report = { ...base, ...narrative, risks: [...new Set([...base.risks, ...narrative.risks])] };
    await this.write(report, input);
    return report;
  }

  private async write(report: QaReport, input: ReportInput) {
    const dir = path.join(PATHS.reports, 'runs', report.runId);
    report.artifacts.push(relative(path.join(dir, 'report.md')), relative(path.join(dir, 'report.html')), relative(path.join(dir, 'report.json')));
    await writeJson(path.join(dir, 'report.json'), report);
    await writeText(path.join(dir, 'report.md'), toMarkdown(report, input));
    await writeText(path.join(dir, 'report.html'), toHtml(report, input));
    await writeJson(path.join(PATHS.reports, 'latest-report.json'), report);
  }
}

function buildReport(input: ReportInput): QaReport {
  const ex = input.execution;
  const m = {
    acceptanceCriteria: input.requirement?.acceptanceCriteria.length ?? 0,
    testCases: input.testPlan?.testCases.length ?? 0,
    scriptsGenerated: input.scripts.length,
    scriptsApproved: input.validations.filter(v => v.approvedForExecution).length,
    testsExecuted: ex ? ex.total - ex.skipped : 0,
    testsPassed: ex?.passed ?? 0,
    testsFailed: ex?.failed ?? 0,
    healingProposals: input.healing.length,
    healingApplied: input.healing.filter(h => h.status === 'applied').length,
    apiTests: input.apiPlan?.tests.length ?? 0
  };
  const verdict: QaReport['verdict'] = !input.requirement
    ? 'blocked'
    : !ex || ex.status === 'skipped' || m.testsExecuted === 0
      ? 'not-executed'
      : ex.failed > 0 || ex.status !== 'passed'
        ? 'fail'
        : 'pass';

  const risks: string[] = [];
  const untestable = input.requirement?.acceptanceCriteria.filter(a => !a.testable) ?? [];
  if (untestable.length) risks.push(`${untestable.length} acceptance criteria are not measurable (${untestable.map(a => a.id).join(', ')}) and are not covered by automation.`);
  if (input.requirement?.risk.level === 'high') risks.push(`Module "${input.requirement.module}" is high risk.`);
  const rejected = input.validations.filter(v => !v.valid);
  if (rejected.length) risks.push(`${rejected.length} generated script(s) were rejected by the Code Validator.`);
  if (ex?.failures.length) risks.push(`${ex.failures.length} test(s) failed: ${ex.failures.map(f => f.title).join('; ')}`);
  const pending = input.healing.filter(h => h.status === 'proposed');
  if (pending.length) risks.push(`${pending.length} locator repair(s) await human approval.`);
  if (input.errors.length) risks.push(`${input.errors.length} agent error(s) occurred during the run.`);

  const next: string[] = [];
  if (input.requirement?.openQuestions.length) next.push(`Resolve ${input.requirement.openQuestions.length} open question(s) with the product owner.`);
  if (verdict === 'not-executed') next.push('Review generated scripts in generated-tests/, then run with ALLOW_GENERATED_TEST_EXECUTION=true (or --execute).');
  if (pending.length) next.push('Review healing proposals in reports/healing/healing-history.jsonl and update page objects.');
  if (ex?.failures.some(f => !f.failedLocator)) next.push('Triage non-locator failures as potential product defects.');
  if (m.scriptsApproved) next.push('Promote approved and passing generated tests to tests/ui after code review.');

  const summary = input.requirement
    ? `${input.requirement.id} "${input.requirement.title}" (${input.requirement.module}, ${input.requirement.risk.level} risk): ${m.acceptanceCriteria} acceptance criteria → ${m.testCases} test cases → ${m.scriptsGenerated} scripts (${m.scriptsApproved} approved). ` +
      (verdict === 'not-executed' ? 'Generated tests were not executed in this run.' : `Executed ${m.testsExecuted}: ${m.testsPassed} passed, ${m.testsFailed} failed.`)
    : 'The run was blocked before requirement analysis completed.';

  return {
    runId: input.runId,
    generatedAt: new Date().toISOString(),
    application: env.APP_BASE_URL,
    requirementId: input.requirement?.id ?? null,
    executiveSummary: summary,
    verdict,
    metrics: m,
    risks,
    nextActions: next,
    agentTrace: input.trace,
    artifacts: [...input.scripts.map(s => s.filePath), ...(input.apiPlan?.specFile ? [input.apiPlan.specFile] : []), ...(ex?.reportPath ? [ex.reportPath] : [])]
  };
}

function toMarkdown(r: QaReport, input: ReportInput): string {
  const req = input.requirement;
  return [
    `# QA Run Report: ${r.runId}`,
    '',
    `**Application:** ${r.application}  `,
    `**Requirement:** ${r.requirementId ?? '-'}  `,
    `**Verdict:** ${r.verdict.toUpperCase()}  `,
    `**Generated:** ${r.generatedAt}`,
    '',
    '## Executive summary',
    r.executiveSummary,
    '',
    '## Metrics',
    '| Metric | Value |',
    '|---|---|',
    ...Object.entries(r.metrics).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    ...(req
      ? ['## Acceptance criteria', '| AC | Testable | Category | Text |', '|---|---|---|---|', ...req.acceptanceCriteria.map(a => `| ${a.id} | ${a.testable ? 'yes' : 'NO'} | ${a.category} | ${a.text.replaceAll('|', '\\|')} |`), '']
      : []),
    ...(input.testPlan
      ? ['## Traceability', '| AC | Test cases |', '|---|---|', ...input.testPlan.traceability.map(t => `| ${t.acceptanceCriterion} | ${t.testCaseIds.join(', ') || '**not covered**'} |`), '']
      : []),
    ...(input.validations.length
      ? ['## Generated scripts', '| Test case | File | Score | Approved | Issues |', '|---|---|---|---|---|', ...input.validations.map(v => `| ${v.testCaseId} | ${v.filePath} | ${v.score} | ${v.approvedForExecution ? 'yes' : 'no'} | ${v.issues.map(i => `${i.severity}:${i.rule}`).join(', ') || '-'} |`), '']
      : []),
    ...(input.execution?.failures.length ? ['## Failures', ...input.execution.failures.map(f => `- **${f.title}** (${f.file}:${f.line ?? '?'})\n  - locator: \`${f.failedLocator ?? '-'}\`\n  - ${f.error.split('\n')[0]}`), ''] : []),
    ...(input.healing.length ? ['## Healing', '| Broken | Category | Recommended | Confidence | Status |', '|---|---|---|---|---|', ...input.healing.map(h => `| \`${h.brokenLocator}\` | ${h.failureCategory} | \`${h.recommended?.code ?? '-'}\` | ${h.confidence} | ${h.status} |`), ''] : []),
    '## Risks',
    ...(r.risks.length ? r.risks.map(x => `- ${x}`) : ['- none identified']),
    '',
    '## Next actions',
    ...(r.nextActions.length ? r.nextActions.map(x => `- ${x}`) : ['- none']),
    '',
    '## Agent trace',
    '| Agent | Mode | Provider | Status | ms | Note |',
    '|---|---|---|---|---|---|',
    ...r.agentTrace.map(t => `| ${t.agent} | ${t.mode} | ${t.provider} | ${t.status} | ${t.durationMs} | ${t.note ?? ''} |`),
    ''
  ].join('\n');
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function toHtml(r: QaReport, input: ReportInput): string {
  const colour = { pass: '#1a7f37', fail: '#cf222e', 'not-executed': '#9a6700', blocked: '#cf222e' }[r.verdict];
  const row = (cells: (string | number)[]) => `<tr>${cells.map(c => `<td>${esc(String(c))}</td>`).join('')}</tr>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QA Report ${esc(r.runId)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:0;padding:24px;color:#1f2328;background:#fff;max-width:1100px}
h1{font-size:22px}h2{font-size:17px;margin-top:28px;border-bottom:1px solid #d0d7de;padding-bottom:4px}
.badge{display:inline-block;padding:2px 10px;border-radius:12px;color:#fff;background:${colour};font-weight:600}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}
.card{border:1px solid #d0d7de;border-radius:6px;padding:8px 12px}.card b{display:block;font-size:20px}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #d0d7de;padding:4px 8px;text-align:left;vertical-align:top}
th{background:#f6f8fa}code{font-size:12px}</style></head><body>
<h1>QA Run Report <small>${esc(r.runId)}</small></h1>
<p><span class="badge">${r.verdict.toUpperCase()}</span> ${esc(r.application)} · ${esc(r.requirementId ?? '-')} · ${esc(r.generatedAt)}</p>
<p>${esc(r.executiveSummary)}</p>
<h2>Metrics</h2><div class="grid">${Object.entries(r.metrics).map(([k, v]) => `<div class="card">${esc(k)}<b>${v}</b></div>`).join('')}</div>
${input.testPlan ? `<h2>Test cases</h2><table><tr><th>ID</th><th>Type</th><th>Priority</th><th>Title</th><th>AC</th></tr>${input.testPlan.testCases.map(t => row([t.id, t.type, t.priority, t.title, t.acceptanceCriteria.join(', ')])).join('')}</table>` : ''}
${input.validations.length ? `<h2>Generated scripts</h2><table><tr><th>Test case</th><th>File</th><th>Score</th><th>Approved</th></tr>${input.validations.map(v => row([v.testCaseId, v.filePath, v.score, v.approvedForExecution ? 'yes' : 'no'])).join('')}</table>` : ''}
${input.execution?.failures.length ? `<h2>Failures</h2><table><tr><th>Test</th><th>Locator</th><th>Error</th></tr>${input.execution.failures.map(f => row([f.title, f.failedLocator ?? '-', f.error.split('\n')[0] ?? ''])).join('')}</table>` : ''}
${input.healing.length ? `<h2>Healing</h2><table><tr><th>Broken</th><th>Category</th><th>Recommended</th><th>Confidence</th><th>Status</th></tr>${input.healing.map(h => row([h.brokenLocator, h.failureCategory, h.recommended?.code ?? '-', h.confidence, h.status])).join('')}</table>` : ''}
<h2>Risks</h2><ul>${r.risks.map(x => `<li>${esc(x)}</li>`).join('') || '<li>none</li>'}</ul>
<h2>Next actions</h2><ul>${r.nextActions.map(x => `<li>${esc(x)}</li>`).join('') || '<li>none</li>'}</ul>
<h2>Agent trace</h2><table><tr><th>Agent</th><th>Mode</th><th>Provider</th><th>Status</th><th>ms</th><th>Note</th></tr>${r.agentTrace.map(t => row([t.agent, t.mode, t.provider, t.status, t.durationMs, t.note ?? ''])).join('')}</table>
</body></html>`;
}

export const reportingAgent = new ReportingAgent();
