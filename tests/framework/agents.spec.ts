import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { staticIssues } from '../../src/agents/code-validator.agent.js';
import { parseLocator, similarity } from '../../src/agents/healing.agent.js';
import { RequirementAgent } from '../../src/agents/requirement.agent.js';
import { TestDesignAgent, quotedValues } from '../../src/agents/test-design.agent.js';
import { templateBody } from '../../src/agents/script-generator.agent.js';
import { ApiAgent, renderSpec } from '../../src/agents/api.agent.js';
import { extractLocator, toCode } from '../../src/browser/locators.js';
import { MarkdownKnowledgeBase } from '../../src/knowledge/knowledge-base.js';
import { parseRoutes } from '../../src/llm/providers.js';

/** Offline unit tests for the supporting agents and building blocks. */
const kb = new MarkdownKnowledgeBase();

test.describe('Knowledge base @framework', () => {
  test('BM25 search ranks the relevant business rules first', async () => {
    const hits = await kb.search('search term minimum length characters');
    expect(hits[0]!.source).toBe('business-rules.md');
    expect(hits[0]!.text).toContain('BR-SEARCH-01');
  });

  test('parses modules and business rules', async () => {
    const modules = await kb.modules();
    expect(modules.map(m => m.name)).toContain('Shopping Cart');
    expect(modules.find(m => m.name === 'Shopping Cart')).toMatchObject({ risk: 'high', rulePrefixes: ['BR-CART'] });
    const rules = await kb.businessRules();
    expect(rules.find(r => r.id === 'BR-CHECKOUT-03')?.text).toContain('never confirm');
  });
});

test.describe('Test Design Agent @framework', () => {
  test('derives positive, negative and boundary cases with full traceability', async () => {
    const req = (await new RequirementAgent(kb).run({ text: await readFile('requirements/REQ-001-product-search.md', 'utf8') }, { forceOffline: true })).output;
    const plan = (await new TestDesignAgent(kb).run(req, { forceOffline: true })).output;

    expect(plan.testCases.map(t => t.type)).toEqual(expect.arrayContaining(['positive', 'negative', 'boundary']));
    expect(plan.testCases.find(t => t.title.includes('2 characters'))?.testData.input).toBe('la');
    // Every testable AC is covered; the untestable AC-5 is a gap, not a guessed test.
    for (const row of plan.traceability.filter(r => r.acceptanceCriterion !== 'AC-5')) expect(row.testCaseIds.length).toBeGreaterThan(0);
    expect(plan.traceability.find(r => r.acceptanceCriterion === 'AC-5')?.testCaseIds).toEqual([]);
    expect(plan.coverageGaps.join(' ')).toContain('AC-5');
  });

  test('splits quoted values into input and expected text', () => {
    expect(quotedValues('Searching for "laptop" shows "14.1-inch Laptop"')).toEqual({ input: 'laptop', expectedText: '14.1-inch Laptop' });
    expect(quotedValues('No matches shows "No products were found that matched your criteria."')).toEqual({
      input: null,
      expectedText: 'No products were found that matched your criteria.'
    });
  });
});

test.describe('Script Generator + Code Validator @framework', () => {
  const tc = {
    id: 'TC-REQ-001-01', title: 'Search laptop', type: 'positive' as const, priority: 'P1' as const,
    acceptanceCriteria: ['AC-1'], preconditions: [], steps: [{ action: 'search', data: null, expected: null }],
    expectedResult: 'Searching for "laptop" shows "14.1-inch Laptop"', testData: { input: 'laptop', expectedText: '14.1-inch Laptop' },
    tags: ['@search'], automationCandidate: true
  };

  test('template uses page objects and passes validation', () => {
    const { body } = templateBody('Product Search', tc);
    expect(body).toContain('homePage.search("laptop")');
    expect(body).toContain('searchPage.expectProductListed("14.1-inch Laptop")');
    const code = `import { test, expect } from '../../src/fixtures/test-fixtures.js';\ntest('x', async ({ homePage, searchPage }) => {\n${body}\n});\n`;
    expect(staticIssues(code).filter(i => i.severity === 'error')).toEqual([]);
  });

  test('validator blocks unsafe or broken code', () => {
    const bad = `import { test } from '@playwright/test';
import { execSync } from 'child_process';
test.only('x', async ({ page }) => {
  await page.goto('https://evil.example.com');
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: 'Confirm' }).click();
  const k = process.env.SECRET;
});`;
    const rules = staticIssues(bad).map(i => i.rule);
    expect(rules).toEqual(expect.arrayContaining(['no-child-process', 'no-only', 'no-external-url', 'no-hard-wait', 'no-order-confirmation', 'no-env-access', 'has-assertion']));
    expect(staticIssues('test("x", async () => { await expect(1).toBe(1) ').some(i => i.rule === 'typescript-syntax')).toBe(true);
  });
});

test.describe('Healing helpers @framework', () => {
  test('parses locators from Playwright errors and code', () => {
    expect(extractLocator("Error: locator.fill: Timeout 15000ms exceeded.\n  - waiting for locator('#small-searchterm')")).toBe('#small-searchterm');
    expect(extractLocator("waiting for getByRole('button', { name: 'Serch' })")).toBe("getByRole('button', { name: 'Serch' })");
    expect(parseLocator("getByRole('button', { name: 'Add to kart' })")).toMatchObject({ strategy: 'role', role: 'button', value: 'Add to kart' });
    expect(parseLocator('#small-searchterm')).toEqual({ strategy: 'css', value: '#small-searchterm' });
  });

  test('similarity prefers near matches', () => {
    expect(similarity('small-searchterm', 'small-searchterms')).toBeGreaterThan(0.9);
    expect(similarity('small-searchterm', 'newsletter-email')).toBeLessThan(0.4);
  });

  test('renders locator specs to code', () => {
    expect(toCode({ strategy: 'role', role: 'button', value: "Add to cart", exact: true })).toBe("page.getByRole('button', { name: 'Add to cart', exact: true })");
    expect(toCode({ strategy: 'css', value: '#Email' }, 'this.page')).toBe("this.page.locator('#Email')");
  });
});

test.describe('API Agent @framework', () => {
  test('reads contracts and renders a valid APIRequest spec', async () => {
    const endpoints = await new ApiAgent(kb).endpoints();
    expect(endpoints.map(e => e.id)).toEqual(['home', 'search', 'add-to-cart-catalog']);
    const spec = renderSpec([
      { id: 'API-x-1', endpointId: 'add-to-cart-catalog', title: 't', type: 'negative', method: 'POST', path: '/addproducttocart/catalog/999999/1/1', query: {}, expectedStatus: 200, expectJson: { success: false }, expectBodyContains: [] }
    ]);
    expect(spec).toContain('request.post("/addproducttocart/catalog/999999/1/1")');
    expect(staticIssues(spec).filter(i => i.severity === 'error')).toEqual([]);
  });
});

test.describe('Model routing @framework', () => {
  test('parses per-agent provider routes', () => {
    expect(parseRoutes('scriptGenerator=anthropic:claude-sonnet-5-5; healing=ollama:llama3.1:8b ;reporting=mock')).toEqual({
      scriptGenerator: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
      healing: { provider: 'ollama', model: 'llama3.1:8b' },
      reporting: { provider: 'mock', model: undefined }
    });
    expect(() => parseRoutes('x=skynet:1')).toThrow(/Unknown provider/);
  });
});
