import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { env } from '../config/env.js';
import { relative } from '../core/artifacts.js';
import { PATHS } from '../core/paths.js';
import { extractLocator } from '../browser/locators.js';
import { ExecutionResultSchema, type ExecutionResult, type TestFailure } from '../schemas/index.js';
import { BaseAgent } from './base-agent.js';

/**
 * AGENT 7 — EXECUTION AGENT
 * -------------------------
 * Runs Playwright in a child process with a hard timeout, collects the JSON
 * report and turns it into a compact result with structured failures
 * (error, failed locator, page URL) for the Healing and Reporting agents.
 *
 * Safety gate: generated tests only run when ALLOW_GENERATED_TEST_EXECUTION=true
 * and the caller passes only files the Code Validator approved.
 * Execution is deterministic: there is no LLM path.
 */
export interface ExecutionInput {
  project: 'ui' | 'api' | 'generated';
  files?: string[];
  grep?: string;
  runId: string;
  /** Explicit human opt-in (CLI --execute). Defaults to ALLOW_GENERATED_TEST_EXECUTION. */
  allowGenerated?: boolean;
}

const require = createRequire(import.meta.url);
const ANSI = /\u001b\[[0-9;]*m/g;

export class ExecutionAgent extends BaseAgent<ExecutionInput, ExecutionResult> {
  readonly name = 'execution' as const;
  readonly description = 'Execution Agent: run Playwright tests';
  protected readonly outputSchema = ExecutionResultSchema;

  protected withLlm(input: ExecutionInput): Promise<ExecutionResult> {
    return this.offline(input);
  }

  protected async offline(input: ExecutionInput): Promise<ExecutionResult> {
    const skipped = (reason: string): ExecutionResult => ({
      status: 'skipped', command: '', total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0,
      durationMs: 0, failures: [], reportPath: null, reason
    });
    if (input.project === 'generated' && !(input.allowGenerated ?? env.ALLOW_GENERATED_TEST_EXECUTION)) {
      return skipped('Generated-test execution is not enabled. Review the scripts, then pass --execute or set ALLOW_GENERATED_TEST_EXECUTION=true.');
    }
    if (input.files && input.files.length === 0) return skipped('No approved files to execute.');

    const reportFile = path.join(PATHS.reports, 'runs', input.runId, `execution-${input.project}.json`);
    const cli = path.join(path.dirname(require.resolve('@playwright/test/package.json')), 'cli.js');
    const args = [cli, 'test', `--project=${input.project}`, '--reporter=list,json', ...(input.grep ? ['--grep', input.grep] : []), ...(input.files ?? [])];
    const command = `playwright ${args.slice(1).join(' ')}`;
    this.log.info({ command }, 'running Playwright');

    const started = Date.now();
    const { code, timedOut, output } = await run(args, reportFile);
    const durationMs = Date.now() - started;

    if (!existsSync(reportFile)) {
      return { ...skipped(`Playwright produced no report (exit ${code}). ${output.slice(-500)}`), status: timedOut ? 'timedOut' : 'error', command, durationMs };
    }
    const report = JSON.parse(await readFile(reportFile, 'utf8')) as PwReport;
    const summary = summarise(report);
    return {
      status: timedOut ? 'timedOut' : summary.failed > 0 ? 'failed' : summary.total === summary.skipped ? 'skipped' : 'passed',
      command, durationMs, ...summary,
      reportPath: relative(reportFile),
      reason: timedOut ? `Exceeded MAX_TEST_RUN_SECONDS=${env.MAX_TEST_RUN_SECONDS}` : null
    };
  }
}

function run(args: string[], reportFile: string): Promise<{ code: number | null; timedOut: boolean; output: string }> {
  return new Promise((resolve, reject) => {
    // node <playwright cli> avoids shell:true and the Windows .cmd spawn restrictions.
    const child = spawn(process.execPath, args, {
      cwd: PATHS.root,
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: reportFile, FORCE_COLOR: '0' },
      shell: false
    });
    let output = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, env.MAX_TEST_RUN_SECONDS * 1000);
    child.stdout.on('data', c => { output += c; process.stderr.write(c); });
    child.stderr.on('data', c => { output += c; });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, timedOut, output }); });
  });
}

// ── Playwright JSON report (subset) ──
interface PwResult { status: string; duration: number; error?: { message?: string }; errors?: { message?: string }[]; annotations?: { type: string; description?: string }[] }
interface PwTest { status: 'expected' | 'unexpected' | 'flaky' | 'skipped'; annotations?: { type: string; description?: string }[]; results: PwResult[] }
interface PwSpec { title: string; file: string; line: number; tests: PwTest[] }
interface PwSuite { title: string; specs?: PwSpec[]; suites?: PwSuite[] }
interface PwReport { suites: PwSuite[] }

function summarise(report: PwReport) {
  const specs: PwSpec[] = [];
  const walk = (s: PwSuite) => { specs.push(...(s.specs ?? [])); (s.suites ?? []).forEach(walk); };
  report.suites.forEach(walk);

  let passed = 0, failed = 0, skipped = 0, flaky = 0;
  const failures: TestFailure[] = [];
  for (const spec of specs) {
    for (const t of spec.tests) {
      if (t.status === 'expected') passed++;
      else if (t.status === 'skipped') skipped++;
      else if (t.status === 'flaky') flaky++;
      else {
        failed++;
        const last = t.results.at(-1);
        const message = (last?.error?.message ?? last?.errors?.[0]?.message ?? 'unknown error').replace(ANSI, '');
        const annotations = [...(t.annotations ?? []), ...(last?.annotations ?? [])];
        failures.push({
          title: spec.title,
          file: spec.file,
          line: spec.line,
          error: message.slice(0, 2000),
          failedLocator: extractLocator(message),
          pageUrl: annotations.find(a => a.type === 'page-url')?.description ?? null
        });
      }
    }
  }
  return { total: passed + failed + skipped + flaky, passed, failed, skipped, flaky, failures };
}

export const executionAgent = new ExecutionAgent();
