import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { RequirementAgent, categorise, detectModule, findVagueTerms, parseStory } from '../../src/agents/requirement.agent.js';
import { MarkdownKnowledgeBase } from '../../src/knowledge/knowledge-base.js';
import { RequirementAnalysisSchema } from '../../src/schemas/index.js';

/**
 * Unit tests for Agent 1 (Requirement Agent), offline mode:
 * no browser, no network, no LLM. They run in CI on every commit.
 */
const kb = new MarkdownKnowledgeBase();
const agent = new RequirementAgent(kb);

test.describe('Requirement Agent @framework', () => {
  test('parses role, goal, value and acceptance criteria from a user story', () => {
    const story = parseStory(`# REQ-042 Wishlist\nAs a registered customer, I want to save products so that I can buy them later.\nAcceptance criteria:\n- A saved product appears in the wishlist.\n- Removing it empties the wishlist.`);
    expect(story).toMatchObject({
      id: 'REQ-042',
      title: 'Wishlist',
      role: 'registered customer',
      goal: 'save products',
      value: 'I can buy them later'
    });
    expect(story.criteria).toHaveLength(2);
  });

  test('supports Given/When/Then criteria', () => {
    const story = parseStory('As a guest, I want to search.\nAcceptance criteria:\nGiven I am on the home page\nWhen I search for "book"\nThen books are listed');
    expect(story.criteria).toEqual(['Given I am on the home page', 'When I search for "book"', 'Then books are listed']);
  });

  test('flags every vague term and categorises criteria', () => {
    expect(findVagueTerms('Results load fast and are user friendly')).toEqual(['fast', 'user friendly']);
    expect(categorise('A search term shorter than 3 characters shows an error')).toBe('validation');
    expect(categorise('Cart line total equals unit price multiplied by quantity')).toBe('data');
    expect(categorise('The login page should be secure')).toBe('non-functional');
  });

  test('maps stories to modules defined in project knowledge', async () => {
    const modules = await kb.modules();
    expect(detectModule('I want to add the laptop to my shopping cart', modules)?.name).toBe('Shopping Cart');
    expect(detectModule('I want to log in with my password', modules)?.name).toBe('Customer Login');
    expect(detectModule('I want to fly to the moon', modules)).toBeNull();
  });

  test('REQ-001 produces a schema-valid, grounded analysis', async () => {
    const text = await readFile('requirements/REQ-001-product-search.md', 'utf8');
    const { output, mode } = await agent.run({ text }, { forceOffline: true });

    expect(mode).toBe('offline');
    expect(RequirementAnalysisSchema.safeParse(output).success).toBe(true);
    expect(output.id).toBe('REQ-001');
    expect(output.module).toBe('Product Search');
    expect(output.acceptanceCriteria).toHaveLength(5);
    // AC-5 ("load fast and are user friendly") must be flagged, not silently automated.
    const ac5 = output.acceptanceCriteria[4]!;
    expect(ac5.testable).toBe(false);
    expect(ac5.clarificationNeeded).toContain('fast');
    expect(output.openQuestions.some(q => q.startsWith('AC-5'))).toBe(true);
    // The module's own rules come first; strongly related rules (BR-CART-01, via the
    // "Add to cart" button in AC-4) may follow; unrelated login/checkout rules may not.
    const ruleIds = output.relatedBusinessRules.map(r => r.id);
    expect(ruleIds.slice(0, 4).every(id => id.startsWith('BR-SEARCH-'))).toBe(true);
    expect(ruleIds.some(id => /^BR-(LOGIN|CHECKOUT)-/.test(id))).toBe(false);
    expect(output.recommendedTestTypes).toEqual(expect.arrayContaining(['ui', 'negative', 'boundary']));
  });

  test('REQ-003 login is high risk and needs a secret-managed account', async () => {
    const text = await readFile('requirements/REQ-003-customer-login.md', 'utf8');
    const { output } = await agent.run({ text }, { forceOffline: true });
    expect(output.module).toBe('Customer Login');
    expect(output.risk.level).toBe('high');
    expect(output.assumptions.join(' ')).toContain('CI secret');
    expect(output.acceptanceCriteria.find(a => a.text.includes('secure'))?.testable).toBe(false);
    expect(output.recommendedTestTypes).toContain('security');
  });

  test('undocumented messages become open questions', async () => {
    const { output } = await agent.run(
      { text: 'As a guest, I want to search so that I find things.\nAcceptance criteria:\n- An empty search shows "Nothing to see here, please try again".' },
      { forceOffline: true }
    );
    expect(output.openQuestions.join('\n')).toContain('not documented in project knowledge');
  });

  test('rejects input that is too short to analyse', async () => {
    await expect(agent.run({ text: 'search' }, { forceOffline: true })).rejects.toThrow(/too short/);
  });
});
