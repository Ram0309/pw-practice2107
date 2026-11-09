import { createHash } from 'node:crypto';
import { env } from '../config/env.js';
import { knowledgeBase, tokenize, type MarkdownKnowledgeBase } from '../knowledge/knowledge-base.js';
import { invokeStructured } from '../llm/structured.js';
import { systemPrompt } from '../llm/prompts.js';
import {
  RequirementAnalysisSchema,
  RequirementInputSchema,
  type ModuleInfo,
  type RequirementAnalysis,
  type RequirementInput
} from '../schemas/index.js';
import { BaseAgent } from './base-agent.js';

/**
 * AGENT 1 — REQUIREMENT AGENT
 * ---------------------------
 * Turns a free-text user story into a structured, testable requirement:
 * role/goal/value, numbered acceptance criteria (each flagged testable or not),
 * the module it belongs to, related business rules, assumptions, open
 * questions, risk and recommended test types.
 *
 * It is the entry point of the pipeline. Everything downstream (test design,
 * scripts, traceability, reports) keys off its acceptance-criterion ids.
 */

type AcCategory = RequirementAnalysis['acceptanceCriteria'][number]['category'];

/** Vague words that make a criterion unmeasurable, with what to ask for instead. */
const VAGUE_TERMS: Record<string, string> = {
  fast: 'a maximum response time (e.g. results visible within 2 s at p95)',
  quick: 'a maximum response time in seconds',
  'user friendly': 'concrete UI or accessibility criteria (e.g. WCAG 2.1 AA, keyboard operable)',
  'user-friendly': 'concrete UI or accessibility criteria',
  easy: 'an observable usability criterion',
  intuitive: 'an observable usability criterion',
  secure: 'specific security controls (e.g. HTTPS only, password masked, lockout after N failed attempts)',
  appropriate: 'the exact expected behaviour or message',
  properly: 'the exact expected outcome',
  correctly: 'the exact expected outcome',
  seamless: 'an observable success criterion',
  robust: 'specific failure conditions that must be handled'
};

export class RequirementAgent extends BaseAgent<RequirementInput, RequirementAnalysis> {
  readonly name = 'requirement' as const;
  readonly description = 'Requirement Agent: analyse user story';
  protected readonly outputSchema = RequirementAnalysisSchema;

  constructor(private readonly kb: MarkdownKnowledgeBase = knowledgeBase) {
    super();
  }

  // ───────────────────────── Offline (deterministic) path ─────────────────────────
  protected async offline(rawInput: RequirementInput): Promise<RequirementAnalysis> {
    const input = RequirementInputSchema.parse(rawInput);
    const story = parseStory(input.text);
    const modules = await this.kb.modules();
    const module = detectModule(input.text, modules);
    const rules = await this.relatedRules(input.text, module);
    const allKnowledge = (await Promise.all(['business-rules.md', 'user-journeys.md', 'modules.md'].map(f => this.kb.file(f)))).join('\n');

    const acceptanceCriteria = story.criteria.map((text, i) => {
      const vague = findVagueTerms(text);
      return {
        id: `AC-${i + 1}`,
        text,
        category: categorise(text),
        testable: vague.length === 0,
        clarificationNeeded: vague.length
          ? vague.map(term => `"${term}" is not measurable; define ${VAGUE_TERMS[term]}.`).join(' ')
          : null
      };
    });

    const assumptions = [
      `Tests run against the shared public environment ${env.APP_BASE_URL}; other users may change data at any time.`,
      'Each test starts from a fresh browser session (anonymous, empty cart).'
    ];
    if (/registered|logged[- ]in|existing customer/i.test(story.role + input.text)) {
      assumptions.push('A registered test account is provided through secure configuration (CI secret), never in source code.');
    }
    if (story.criteria.some(c => /"[^"]+"/.test(c))) {
      assumptions.push('Quoted texts in the acceptance criteria are exact UI messages and are asserted verbatim.');
    }

    const openQuestions: string[] = [];
    for (const ac of acceptanceCriteria) {
      if (ac.clarificationNeeded) openQuestions.push(`${ac.id}: ${ac.clarificationNeeded}`);
      for (const quoted of ac.text.match(/"[^"]+"/g) ?? []) {
        const phrase = quoted.slice(1, -1);
        const isMessage = phrase.split(' ').length >= 4;
        if (isMessage && !allKnowledge.toLowerCase().includes(phrase.toLowerCase())) {
          openQuestions.push(`${ac.id}: message "${phrase}" is not documented in project knowledge. Confirm the exact wording.`);
        }
      }
    }
    if (!story.role) openQuestions.push('The user role is not stated. Which persona does this requirement serve?');
    if (!story.value) openQuestions.push('The business value ("so that ...") is not stated.');
    if (!module) openQuestions.push('The requirement could not be mapped to a documented module. Which module owns it?');

    const fullText = input.text.toLowerCase();
    const testTypes = new Set<RequirementAnalysis['recommendedTestTypes'][number]>(['ui']);
    if (acceptanceCriteria.some(a => a.category === 'validation') || /invalid|unknown|no match|error|shorter|wrong/.test(fullText)) testTypes.add('negative');
    if (/minimum|maximum|at least|at most|shorter|longer|\d+\s*characters|limit/.test(fullText)) testTypes.add('boundary');
    if (module && module.apis.length > 0) testTypes.add('api');
    if (/accessib|screen reader|keyboard|user friendly|user-friendly/.test(fullText)) testTypes.add('accessibility');
    if (/secure|password|login|log in|authentic/.test(fullText)) testTypes.add('security');
    if (/fast|performance|load time|response time|quick/.test(fullText)) testTypes.add('performance');

    // Quoted short values: the first one in a criterion is usually the input, later ones are expected output.
    const testDataHints = [
      ...new Set(
        story.criteria.flatMap(c =>
          (c.match(/"[^"]+"/g) ?? [])
            .map(q => q.slice(1, -1))
            .filter(q => q.split(' ').length < 4)
            .map((q, i) => (i === 0 && /search|enter|type|for /i.test(c) ? `Input: "${q}"` : `Expected value: "${q}"`))
        )
      ),
      'Reusable data: test-data/demowebshop.json'
    ];

    const risk = module?.risk ?? 'medium';
    return {
      id: input.storyId ?? story.id ?? `REQ-${createHash('sha1').update(input.text).digest('hex').slice(0, 6).toUpperCase()}`,
      title: story.title ?? truncate(story.goal || input.text, 80),
      module: module?.name ?? 'Unclassified',
      userRole: story.role || 'unspecified',
      goal: story.goal || 'unspecified',
      businessValue: story.value || 'unspecified',
      summary: `${capitalise(story.role || 'A user')} needs to ${thirdPerson(story.goal || 'complete the described behaviour')}${story.value ? ` so that ${thirdPerson(story.value)}` : ''}. ${acceptanceCriteria.length} acceptance criteria, ${acceptanceCriteria.filter(a => !a.testable).length} need clarification.`,
      acceptanceCriteria,
      relatedBusinessRules: rules,
      assumptions,
      openQuestions,
      risk: {
        level: risk,
        rationale: module
          ? `Module "${module.name}" is rated ${risk} risk in project-knowledge/modules.md.`
          : 'Module unknown; defaulting to medium risk until classified.'
      },
      recommendedTestTypes: [...testTypes],
      testDataHints,
      sources: ['modules.md', 'business-rules.md']
    };
  }

  // ───────────────────────────── LLM (AI reasoning) path ─────────────────────────────
  protected async withLlm(rawInput: RequirementInput): Promise<RequirementAnalysis> {
    const input = RequirementInputSchema.parse(rawInput);
    // Ground the model: deterministic baseline + retrieved knowledge as evidence.
    const baseline = await this.offline(input);
    const chunks = await this.kb.search(input.text, 6);
    const modules = await this.kb.modules();
    const rules = await this.kb.businessRules();

    const result = await invokeStructured({
      agent: this.name,
      schema: RequirementAnalysisSchema,
      schemaName: 'requirement_analysis',
      system: await systemPrompt('requirement-agent'),
      user: [
        `REQUIREMENT ID: ${baseline.id}`,
        `USER STORY:\n${input.text}`,
        `KNOWN MODULES:\n${modules.map(m => `- ${m.name} (risk ${m.risk}; keywords: ${m.keywords.join(', ')})`).join('\n')}`,
        `BUSINESS RULES:\n${rules.map(r => `- ${r.id}: ${r.text}`).join('\n')}`,
        `RETRIEVED KNOWLEDGE:\n${chunks.map(c => `[${c.source} > ${c.heading}]\n${c.text}`).join('\n\n')}`,
        `DETERMINISTIC BASELINE (improve on it, do not contradict facts):\n${JSON.stringify(baseline, null, 2)}`
      ].join('\n\n')
    });

    // Guardrails: keep the id stable and drop any business rule the model invented.
    const knownRuleIds = new Set(rules.map(r => r.id));
    return {
      ...result,
      id: baseline.id,
      relatedBusinessRules: result.relatedBusinessRules.filter(r => knownRuleIds.has(r.id)),
      sources: [...new Set([...result.sources, ...chunks.map(c => c.source)])]
    };
  }

  /**
   * Related rules = rules owned by the detected module (modules.md "Rules:" prefix)
   * + general rules + any other rule with strong word overlap with the story.
   */
  private async relatedRules(text: string, module: ModuleInfo | null) {
    const storyTokens = new Set(tokenize(text));
    const owned = (id: string) => module?.rulePrefixes.some(p => id.startsWith(`${p}-`)) ?? false;
    const rules = await this.kb.businessRules();
    return rules
      .map(rule => ({ rule, overlap: tokenize(rule.text).filter(t => storyTokens.has(t)).length }))
      .filter(({ rule, overlap }) => owned(rule.id) || rule.id.startsWith('BR-GEN-') || overlap >= 5)
      .sort((a, b) => Number(owned(b.rule.id)) - Number(owned(a.rule.id)) || b.overlap - a.overlap)
      .slice(0, 10)
      .map(({ rule }) => rule);
  }
}

// ───────────────────────────── helpers (exported for unit tests) ─────────────────────────────

export interface ParsedStory {
  id: string | null;
  title: string | null;
  role: string;
  goal: string;
  value: string;
  criteria: string[];
}

export function parseStory(text: string): ParsedStory {
  const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
  const id = (heading ?? text).match(/\b(REQ-\d+)\b/i)?.[1]?.toUpperCase() ?? null;
  const title = heading ? heading.replace(/\bREQ-\d+\b\s*[-:]?\s*/i, '').trim() || heading : null;

  const story = text.match(/As an?\s+(.+?),\s*I (?:want|need|would like)(?: to)?\s+(.+?)(?:,?\s+so that\s+(.+?))?(?:\.\s|\.$|\n|$)/is);
  const role = story?.[1]?.trim() ?? '';
  const goal = story?.[2]?.trim().replace(/\.$/, '') ?? '';
  const value = story?.[3]?.trim().replace(/\.$/, '') ?? '';

  const lines = text.split(/\r?\n/);
  const acStart = lines.findIndex(l => /acceptance criteria/i.test(l));
  const scope = acStart >= 0 ? lines.slice(acStart + 1) : lines;
  const criteria = scope
    .map(l => l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.+)$/)?.[1] ?? l.match(/^\s*((?:Given|When|Then|And)\s+.+)$/i)?.[1])
    .filter((l): l is string => Boolean(l))
    .map(l => l.trim());

  if (criteria.length === 0 && goal) criteria.push(`The user is able to ${goal}.`);
  return { id, title, role, goal, value, criteria };
}

export function detectModule(text: string, modules: ModuleInfo[]): ModuleInfo | null {
  const lower = text.toLowerCase();
  let best: { module: ModuleInfo; score: number } | null = null;
  for (const module of modules) {
    const score = module.keywords.reduce((sum, kw) => {
      const hits = lower.split(kw).length - 1;
      return sum + hits * (kw.includes(' ') ? 2 : 1);
    }, 0);
    if (score > 0 && (!best || score > best.score)) best = { module, score };
  }
  return best?.module ?? null;
}

export function findVagueTerms(text: string): string[] {
  const lower = text.toLowerCase();
  return Object.keys(VAGUE_TERMS).filter(term => new RegExp(`\\b${term}\\b`).test(lower));
}

export function categorise(text: string): AcCategory {
  const t = text.toLowerCase();
  if (/fast|performance|secure|friendly|accessib|responsive|load time/.test(t)) return 'non-functional';
  if (/invalid|error|minimum|maximum|required|shorter|longer|must be|unknown|no match|wrong/.test(t)) return 'validation';
  if (/total|sum|equals|multiplied|quantity|count|increases|decreases/.test(t)) return 'data';
  if (/shows|display|visible|button|header|lists|page/.test(t)) return 'ui';
  return 'functional';
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const thirdPerson = (s: string) =>
  s.replace(/\bI am\b/g, 'they are').replace(/\bI\b/g, 'they').replace(/\bmy\b/gi, 'their').replace(/\bme\b/g, 'them');

export const requirementAgent = new RequirementAgent();
