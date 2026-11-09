import ts from 'typescript';
import { env } from '../config/env.js';
import { invokeStructured } from '../llm/structured.js';
import { systemPrompt } from '../llm/prompts.js';
import { LlmReviewSchema, ValidationResultSchema, type ValidationIssue, type ValidationResult } from '../schemas/index.js';
import { BaseAgent } from './base-agent.js';

/**
 * AGENT 6 — CODE VALIDATOR AGENT
 * ------------------------------
 * Quality and safety gate between generated code and execution.
 *  1. TypeScript syntax check (compiler API)
 *  2. Static policy rules (forbidden APIs, external URLs, test.only, sleeps, order confirmation ...)
 *  3. Optional LLM review for semantic issues (wrong assertion, missing step)
 * The LLM can add issues but can never remove a static error.
 */
export interface ValidationInput {
  filePath: string;
  testCaseId: string;
  code: string;
}

interface Rule {
  id: string;
  severity: ValidationIssue['severity'];
  pattern: RegExp;
  message: string;
}

const RULES: Rule[] = [
  { id: 'no-child-process', severity: 'error', pattern: /child_process|\bexecSync\b|\bspawn\(/, message: 'Spawning processes is not allowed in tests.' },
  { id: 'no-eval', severity: 'error', pattern: /\beval\(|new Function\(/, message: 'Dynamic code execution is not allowed.' },
  { id: 'no-fs', severity: 'error', pattern: /from ['"](node:)?fs(\/promises)?['"]|require\(/, message: 'File-system access and require() are not allowed in generated tests.' },
  { id: 'no-env-access', severity: 'error', pattern: /process\.env/, message: 'Read configuration through fixtures, not process.env.' },
  { id: 'no-only', severity: 'error', pattern: /\btest\.only\(|\bdescribe\.only\(/, message: 'test.only would silently skip the rest of the suite.' },
  { id: 'no-pause', severity: 'error', pattern: /page\.pause\(/, message: 'page.pause() blocks unattended runs.' },
  { id: 'no-order-confirmation', severity: 'error', pattern: /name:\s*['"]Confirm['"]|confirm-order|ConfirmOrder/i, message: 'Confirming orders on the shared demo is forbidden (BR-CHECKOUT-03).' },
  { id: 'no-hard-wait', severity: 'warning', pattern: /waitForTimeout\(/, message: 'Use web-first assertions instead of fixed waits.' },
  { id: 'no-xpath', severity: 'warning', pattern: /locator\(['"](\/\/|xpath=)/, message: 'Avoid XPath; prefer role, label or id locators.' },
  { id: 'no-nth-child', severity: 'warning', pattern: /nth-child|:nth-of-type/, message: 'Positional CSS is brittle.' },
  { id: 'no-hardcoded-secret', severity: 'warning', pattern: /password['"]?\s*[:=,]\s*['"][^'"]{4,}['"]/i, message: 'Use test data fixtures for passwords.' },
  { id: 'fixme-present', severity: 'info', pattern: /test\.fixme\(/, message: 'Test is marked fixme and will be skipped.' }
];

export class CodeValidatorAgent extends BaseAgent<ValidationInput, ValidationResult> {
  readonly name = 'codeValidator' as const;
  readonly description = 'Code Validator Agent: check generated code';
  protected readonly outputSchema = ValidationResultSchema;

  protected async offline(input: ValidationInput): Promise<ValidationResult> {
    return finalise(input, staticIssues(input.code));
  }

  protected async withLlm(input: ValidationInput): Promise<ValidationResult> {
    const issues = staticIssues(input.code);
    const review = await invokeStructured({
      agent: this.name,
      schema: LlmReviewSchema,
      schemaName: 'code_review',
      system: await systemPrompt('code-validator-agent'),
      user: `FILE: ${input.filePath}\n\n${numbered(input.code)}\n\nSTATIC FINDINGS:\n${issues.map(i => `- ${i.rule}: ${i.message}`).join('\n') || 'none'}`
    });
    return finalise(input, [...issues, ...review.issues.map(i => ({ ...i, rule: `ai:${i.rule}` }))]);
  }
}

export function staticIssues(code: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 1. Syntax check with the TypeScript compiler.
  const out = ts.transpileModule(code, {
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  });
  for (const d of out.diagnostics ?? []) {
    const line = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : null;
    issues.push({ severity: 'error', rule: 'typescript-syntax', message: ts.flattenDiagnosticMessageText(d.messageText, '\n'), line });
  }

  // 2. Structural requirements.
  if (!/from ['"](@playwright\/test|[./]+src\/fixtures\/test-fixtures(\.js)?)['"]/.test(code)) {
    issues.push({ severity: 'error', rule: 'import-test-runner', message: 'Must import test/expect from the project fixtures or @playwright/test.', line: null });
  }
  if (!/\btest\(/.test(code)) issues.push({ severity: 'error', rule: 'has-test', message: 'No test() block found.', line: null });
  if (!/test\.fixme\(/.test(code) && !/expect\(|\.expect[A-Z]\w*\(/.test(code)) {
    issues.push({ severity: 'error', rule: 'has-assertion', message: 'Test has no assertion.', line: null });
  }

  // 3. Policy rules, line by line.
  const lines = code.split('\n');
  for (const rule of RULES) {
    lines.forEach((text, i) => {
      if (rule.pattern.test(text)) issues.push({ severity: rule.severity, rule: rule.id, message: rule.message, line: i + 1 });
    });
  }

  // 4. Only the application under test may be contacted.
  const allowedHost = new URL(env.APP_BASE_URL).host;
  for (const m of code.matchAll(/https?:\/\/([^/'"`\s]+)/g)) {
    if (m[1] !== allowedHost) {
      issues.push({ severity: 'error', rule: 'no-external-url', message: `External host "${m[1]}" is not the application under test.`, line: null });
    }
  }
  return issues;
}

function finalise(input: ValidationInput, issues: ValidationIssue[]): ValidationResult {
  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.filter(i => i.severity === 'warning').length;
  const infos = issues.filter(i => i.severity === 'info').length;
  const score = Math.max(0, 100 - errors * 25 - warnings * 5 - infos);
  return {
    filePath: input.filePath,
    testCaseId: input.testCaseId,
    valid: errors === 0,
    approvedForExecution: errors === 0 && score >= 70,
    score,
    issues
  };
}

const numbered = (code: string) => code.split('\n').map((l, i) => `${String(i + 1).padStart(3)} ${l}`).join('\n');

export const codeValidatorAgent = new CodeValidatorAgent();
