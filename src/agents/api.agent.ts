import path from 'node:path';
import { z } from 'zod';
import { env } from '../config/env.js';
import { relative, slugify, writeText } from '../core/artifacts.js';
import { PATHS } from '../core/paths.js';
import { knowledgeBase, type MarkdownKnowledgeBase } from '../knowledge/knowledge-base.js';
import { invokeStructured } from '../llm/structured.js';
import { systemPrompt } from '../llm/prompts.js';
import { ApiEndpointSchema, ApiPlanSchema, ApiTestSchema, type ApiEndpoint, type ApiPlan, type ApiTest } from '../schemas/index.js';
import { BaseAgent } from './base-agent.js';

/**
 * AGENT 9 — API AGENT
 * -------------------
 * Reads the endpoint contracts in project-knowledge/api-contracts.md, designs API
 * tests and renders them as a Playwright APIRequestContext spec.
 * The design can be AI-assisted, but the code is rendered from data by a template,
 * so the generated API code is always well-formed and only hits documented endpoints.
 */
export interface ApiAgentInput {
  /** Restrict to endpoints whose id or path contains one of these words (e.g. module keywords). */
  focus?: string[];
  name?: string;
}

const LlmApiTestsSchema = z.object({ tests: z.array(ApiTestSchema.omit({ id: true })) });

export class ApiAgent extends BaseAgent<ApiAgentInput, ApiPlan> {
  readonly name = 'api' as const;
  readonly description = 'API Agent: generate API tests';
  protected readonly outputSchema = ApiPlanSchema;

  constructor(private readonly kb: MarkdownKnowledgeBase = knowledgeBase) {
    super();
  }

  async endpoints(): Promise<ApiEndpoint[]> {
    const doc = await this.kb.file('api-contracts.md');
    const block = doc.match(/```json\s*([\s\S]+?)```/)?.[1];
    if (!block) throw new Error('api-contracts.md has no ```json block of endpoints');
    return z.array(ApiEndpointSchema).parse(JSON.parse(block));
  }

  protected async offline(input: ApiAgentInput): Promise<ApiPlan> {
    const endpoints = this.filter(await this.endpoints(), input.focus);
    const tests: ApiTest[] = endpoints.flatMap(ep =>
      ep.examples.map((ex, i) => ({
        id: `API-${ep.id}-${i + 1}`,
        endpointId: ep.id,
        title: `${ep.method} ${ep.path}: ${ex.name}`,
        type: ex.expectJson.success === false || /reject|invalid|unknown|no products/i.test(ex.name) ? 'negative' : 'positive',
        method: ep.method,
        path: fillPath(ep.path, ex.pathParams),
        query: ex.query,
        expectedStatus: ex.expectedStatus,
        expectJson: ex.expectJson,
        expectBodyContains: ex.expectBodyContains
      }))
    );
    return this.render(input, tests, endpoints);
  }

  protected async withLlm(input: ApiAgentInput): Promise<ApiPlan> {
    const endpoints = this.filter(await this.endpoints(), input.focus);
    const baseline = await this.offline(input);
    const extra = await invokeStructured({
      agent: this.name,
      schema: LlmApiTestsSchema,
      schemaName: 'api_tests',
      system: await systemPrompt('api-agent'),
      user: `ENDPOINT CONTRACTS:\n${JSON.stringify(endpoints, null, 2)}\n\nEXISTING TESTS (do not repeat):\n${baseline.tests.map(t => `- ${t.title}`).join('\n')}`
    });
    // Guardrails: documented endpoints only; extra tests on state-changing endpoints are dropped.
    const byId = new Map(endpoints.map(e => [e.id, e]));
    const accepted = extra.tests
      .filter(t => byId.get(t.endpointId)?.method === t.method && byId.get(t.endpointId)?.safe)
      .map((t, i) => ({ ...t, id: `API-${t.endpointId}-ai-${i + 1}` }));
    return this.render(input, [...baseline.tests, ...accepted], endpoints);
  }

  private filter(endpoints: ApiEndpoint[], focus?: string[]): ApiEndpoint[] {
    if (!focus?.length) return endpoints;
    const words = focus.map(f => f.toLowerCase());
    const hit = endpoints.filter(e => words.some(w => e.id.includes(w) || e.path.toLowerCase().includes(w) || e.description.toLowerCase().includes(w)));
    return hit.length ? hit : endpoints;
  }

  private async render(input: ApiAgentInput, tests: ApiTest[], endpoints: ApiEndpoint[]): Promise<ApiPlan> {
    const file = path.join(PATHS.generatedTests, 'api', `${slugify(input.name ?? 'storefront')}.api.spec.ts`);
    const abs = await writeText(file, renderSpec(tests));
    const used = new Set(tests.map(t => t.endpointId));
    return {
      baseUrl: env.APP_BASE_URL,
      tests,
      skippedEndpoints: endpoints.filter(e => !used.has(e.id)).map(e => ({ endpointId: e.id, reason: 'No documented examples' })),
      specFile: relative(abs)
    };
  }
}

const fillPath = (p: string, params: Record<string, string>) => p.replace(/\{(\w+)\}/g, (_, k: string) => params[k] ?? `{${k}}`);
const s = (v: unknown) => JSON.stringify(v);

export function renderSpec(tests: ApiTest[]): string {
  const blocks = tests.map(t => {
    const call = `request.${t.method.toLowerCase()}(${s(t.path)}${Object.keys(t.query).length ? `, { params: ${s(t.query)} }` : ''})`;
    const lines = [`const res = await ${call};`, `expect(res.status()).toBe(${t.expectedStatus});`];
    if (Object.keys(t.expectJson).length) lines.push(`expect(await res.json()).toMatchObject(${s(t.expectJson)});`);
    if (t.expectBodyContains.length) {
      lines.push('const body = await res.text();', ...t.expectBodyContains.map(b => `expect(body).toContain(${s(b)});`));
    }
    return `  test(${s(`${t.id} ${t.title} @api @${t.type}`)}, async ({ request }) => {\n${lines.map(l => `    ${l}`).join('\n')}\n  });`;
  });
  return `/**
 * AUTO-GENERATED by AI-QA-AGENT-FRAMEWORK (API Agent) from project-knowledge/api-contracts.md
 * Uses Playwright APIRequestContext. Each test has its own request context (own session/cart).
 */
import { test, expect } from '@playwright/test';

test.describe('Generated API tests', () => {
${blocks.join('\n\n')}
});
`;
}

export const apiAgent = new ApiAgent();
