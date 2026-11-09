import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PATHS } from '../core/paths.js';
import { knowledgeBase, type MarkdownKnowledgeBase } from '../knowledge/knowledge-base.js';
import { invokeStructured } from '../llm/structured.js';
import { systemPrompt } from '../llm/prompts.js';
import { TestPlanSchema, type RequirementAnalysis, type TestCase, type TestPlan } from '../schemas/index.js';
import { BaseAgent } from './base-agent.js';

/**
 * AGENT 2 — TEST DESIGN AGENT
 * ---------------------------
 * Requirement analysis → complete test plan: positive, negative and boundary
 * cases, each traced to acceptance criteria, with concrete test data and a
 * traceability matrix. Untestable criteria become coverage gaps, not guesses.
 */
const testData = JSON.parse(readFileSync(path.join(PATHS.testData, 'demowebshop.json'), 'utf8'));

export class TestDesignAgent extends BaseAgent<RequirementAnalysis, TestPlan> {
  readonly name = 'testDesign' as const;
  readonly description = 'Test Design Agent: generate test scenarios';
  protected readonly outputSchema = TestPlanSchema;

  constructor(private readonly kb: MarkdownKnowledgeBase = knowledgeBase) {
    super();
  }

  protected async offline(req: RequirementAnalysis): Promise<TestPlan> {
    const cases: TestCase[] = [];
    const gaps: string[] = [];
    const nextId = () => `TC-${req.id}-${String(cases.length + 1).padStart(2, '0')}`;
    const moduleTag = `@${req.module.toLowerCase().replace(/[^a-z]+/g, '-')}`;

    for (const ac of req.acceptanceCriteria) {
      if (!ac.testable) {
        gaps.push(`${ac.id} not automated until clarified: ${ac.clarificationNeeded ?? ac.text}`);
        continue;
      }
      const { input, expectedText } = quotedValues(ac.text);
      const negative = ac.category === 'validation';
      const data = this.dataFor(req.module, ac.text, input, expectedText);

      cases.push({
        id: nextId(),
        title: ac.text.replace(/\.$/, ''),
        type: negative ? 'negative' : 'positive',
        priority: req.risk.level === 'high' && !negative ? 'P1' : negative ? 'P2' : req.risk.level === 'low' ? 'P3' : 'P1',
        acceptanceCriteria: [ac.id],
        preconditions: ['Fresh browser session (anonymous, empty cart)', `Application available at the configured APP_BASE_URL`],
        steps: this.stepsFor(req.module, data, ac.text),
        expectedResult: ac.text,
        testData: data,
        tags: [moduleTag, `@${req.id}`, negative ? '@negative' : '@positive'],
        automationCandidate: true
      });

      // Boundary analysis: "shorter than N characters" / "minimum length is N"
      const min = ac.text.match(/(?:shorter than|minimum(?: length)?(?: is)?|at least)\s+(\d+)\s*characters?/i);
      if (min) {
        const n = Number(min[1]);
        const below = 'lap'.padEnd(n - 1, 'x').slice(0, n - 1);
        const exact = 'laptop'.slice(0, n);
        cases.push({
          id: nextId(),
          title: `Boundary: term of ${n - 1} characters ("${below}") is rejected`,
          type: 'boundary', priority: 'P2', acceptanceCriteria: [ac.id],
          preconditions: ['Fresh browser session'],
          steps: this.stepsFor(req.module, { input: below, expectedText: expectedText ?? '' }, ac.text),
          expectedResult: `The message "${expectedText}" is shown`,
          testData: { input: below, expectedText: expectedText ?? '' },
          tags: [moduleTag, `@${req.id}`, '@boundary'], automationCandidate: true
        });
        cases.push({
          id: nextId(),
          title: `Boundary: term of exactly ${n} characters ("${exact}") is accepted`,
          type: 'boundary', priority: 'P3', acceptanceCriteria: [ac.id],
          preconditions: ['Fresh browser session'],
          steps: this.stepsFor(req.module, { input: exact, expectedText: '' }, ac.text),
          expectedResult: `The minimum-length message is not shown`,
          testData: { input: exact, absentText: expectedText ?? '' },
          tags: [moduleTag, `@${req.id}`, '@boundary'], automationCandidate: true
        });
      }
    }

    if (cases.length === 0) {
      cases.push({
        id: nextId(), title: `Exploratory session for ${req.title}`, type: 'positive', priority: 'P3',
        acceptanceCriteria: req.acceptanceCriteria.map(a => a.id), preconditions: [],
        steps: [{ action: 'Explore the feature against the clarified criteria', data: null, expected: null }],
        expectedResult: 'Findings recorded', testData: {}, tags: ['@manual'], automationCandidate: false
      });
    }

    return {
      requirementId: req.id,
      module: req.module,
      strategy: `Risk ${req.risk.level}. ${cases.filter(c => c.type === 'positive').length} positive, ${cases.filter(c => c.type === 'negative').length} negative and ${cases.filter(c => c.type === 'boundary').length} boundary cases derived from ${req.acceptanceCriteria.length} acceptance criteria. Recommended test types: ${req.recommendedTestTypes.join(', ')}.`,
      testCases: cases,
      traceability: traceability(req, cases),
      coverageGaps: [...gaps, ...req.openQuestions.filter(q => !gaps.some(g => g.startsWith(q.slice(0, 4)))).map(q => `Open question: ${q}`)]
    };
  }

  protected async withLlm(req: RequirementAnalysis): Promise<TestPlan> {
    const baseline = await this.offline(req);
    const chunks = await this.kb.search(`${req.module} ${req.title}`, 6);
    const plan = await invokeStructured({
      agent: this.name,
      schema: TestPlanSchema,
      schemaName: 'test_plan',
      system: await systemPrompt('test-design-agent'),
      user: [
        `REQUIREMENT:\n${JSON.stringify(req, null, 2)}`,
        `TEST DATA AVAILABLE (test-data/demowebshop.json):\n${JSON.stringify(testData, null, 2)}`,
        `KNOWLEDGE:\n${chunks.map(c => `[${c.source} > ${c.heading}]\n${c.text}`).join('\n\n')}`,
        `BASELINE PLAN (extend and improve; keep its ids):\n${JSON.stringify(baseline, null, 2)}`
      ].join('\n\n')
    });
    // Guardrails: ids follow the convention and the traceability matrix is recomputed, not trusted.
    const known = new Set(req.acceptanceCriteria.map(a => a.id));
    const testCases = plan.testCases.map((tc, i) => ({
      ...tc,
      id: `TC-${req.id}-${String(i + 1).padStart(2, '0')}`,
      acceptanceCriteria: tc.acceptanceCriteria.filter(id => known.has(id))
    }));
    return { ...plan, requirementId: req.id, module: req.module, testCases, traceability: traceability(req, testCases) };
  }

  private dataFor(module: string, text: string, input: string | null, expectedText: string | null): Record<string, string> {
    const d: Record<string, string> = {};
    const lower = text.toLowerCase();
    if (module === 'Customer Login') {
      d.email = /invalid email format|valid email/.test(lower) ? testData.login.invalidEmailFormat : testData.login.unknownEmail;
      d.password = testData.login.anyPassword;
    } else if (module === 'Shopping Cart') {
      d.searchTerm = testData.search.validTerm;
      d.product = testData.search.expectedProduct;
    } else if (input) {
      d.input = input;
    } else if (/no match/.test(lower)) {
      d.input = testData.search.noResultTerm;
    } else if (/shorter than|minimum/.test(lower)) {
      d.input = testData.search.shortTerm;
    } else if (module === 'Product Search') {
      d.input = testData.search.validTerm;
    }
    if (expectedText) d.expectedText = expectedText;
    return d;
  }

  private stepsFor(module: string, data: Record<string, string>, expected: string): TestCase['steps'] {
    switch (module) {
      case 'Product Search':
        return [
          { action: 'Open the home page', data: null, expected: 'Home page is displayed' },
          { action: 'Enter the search term in the header search box and click Search', data: data.input ?? null, expected: null },
          { action: 'Check the search results page', data: null, expected }
        ];
      case 'Shopping Cart':
        return [
          { action: 'Search for the product', data: data.searchTerm ?? null, expected: 'Product is listed' },
          { action: 'Click "Add to cart" on the product tile', data: data.product ?? null, expected: null },
          { action: 'Check the notification, header counter and cart page', data: null, expected }
        ];
      case 'Customer Login':
        return [
          { action: 'Open the login page', data: null, expected: 'Login form is displayed' },
          { action: 'Enter email and password and click "Log in"', data: `${data.email ?? ''} / ********`, expected: null },
          { action: 'Check the result', data: null, expected }
        ];
      default:
        return [{ action: `Perform: ${expected}`, data: null, expected }];
    }
  }
}

/** First short quoted value = input; first long quoted value (4+ words) or the last quoted value = expected text. */
export function quotedValues(text: string): { input: string | null; expectedText: string | null } {
  const quoted = (text.match(/"[^"]+"/g) ?? []).map(q => q.slice(1, -1));
  const long = quoted.find(q => q.split(' ').length >= 4) ?? null;
  const short = quoted.filter(q => q.split(' ').length < 4);
  if (long) return { input: short[0] ?? null, expectedText: long };
  if (short.length >= 2) return { input: short[0]!, expectedText: short[1]! };
  return { input: null, expectedText: short[0] ?? null };
}

function traceability(req: RequirementAnalysis, cases: TestCase[]): TestPlan['traceability'] {
  return req.acceptanceCriteria.map(ac => ({
    acceptanceCriterion: ac.id,
    testCaseIds: cases.filter(c => c.acceptanceCriteria.includes(ac.id)).map(c => c.id)
  }));
}

export const testDesignAgent = new TestDesignAgent();
