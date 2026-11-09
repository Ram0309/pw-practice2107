import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { env } from '../config/env.js';
import { PATHS } from '../core/paths.js';
import { withPage } from '../browser/browser-session.js';
import { candidateLocators, captureElements, stabilityOf, type RawElement } from '../browser/dom-snapshot.js';
import { probe, toCode } from '../browser/locators.js';
import { recordHealing } from '../healing/healing-history.js';
import { invokeStructured } from '../llm/structured.js';
import { systemPrompt } from '../llm/prompts.js';
import {
  HealingInputSchema,
  HealingProposalSchema,
  LlmHealingDecisionSchema,
  type HealingCandidate,
  type HealingInput,
  type HealingProposal,
  type LocatorSpec
} from '../schemas/index.js';
import { BaseAgent } from './base-agent.js';

/**
 * AGENT 8 — SELF-HEALING AGENT
 * ----------------------------
 *  DETECT   : classify the failure (locator / timing / assertion / environment ...)
 *  PROPOSE  : find DOM elements similar to the broken locator (id, name, text, classes)
 *  VALIDATE : each candidate must resolve to exactly ONE visible element on the live page
 *  DECIDE   : best validated candidate (LLM may choose, but only among validated ones)
 *  APPLY    : only when HEALING_MODE=auto-generated AND the file is in generated-tests/;
 *             curated tests and page objects are never modified automatically
 *  RECORD   : every decision is appended to reports/healing/healing-history.jsonl
 *
 * It never changes assertions or expected values: a failing business check is
 * classified as "assertion"/"application" and left for a human.
 */
export class HealingAgent extends BaseAgent<HealingInput, HealingProposal> {
  readonly name = 'healing' as const;
  readonly description = 'Healing Agent: repair broken locators';
  protected readonly outputSchema = HealingProposalSchema;

  protected async offline(raw: HealingInput): Promise<HealingProposal> {
    const input = HealingInputSchema.parse(raw);
    const analysis = await this.analyse(input);
    const recommended = analysis.candidates.find(c => c.validated) ?? null;
    return this.finish(input, {
      ...analysis,
      recommended,
      confidence: recommended ? Number((recommended.similarity * 0.9 + (stabilityOf(recommended.locator) === 'high' ? 0.1 : 0)).toFixed(2)) : 0
    });
  }

  protected async withLlm(raw: HealingInput): Promise<HealingProposal> {
    const input = HealingInputSchema.parse(raw);
    const analysis = await this.analyse(input);
    const validated = analysis.candidates.filter(c => c.validated);
    const decision = await invokeStructured({
      agent: this.name,
      schema: LlmHealingDecisionSchema,
      schemaName: 'healing_decision',
      system: await systemPrompt('healing-agent'),
      user: [
        `BROKEN LOCATOR: ${input.brokenLocator}`,
        `ERROR:\n${input.errorMessage.slice(0, 1500)}`,
        `DETERMINISTIC CLASSIFICATION: ${analysis.failureCategory} — ${analysis.diagnosis}`,
        `VALIDATED CANDIDATES (index: code, similarity):\n${validated.map((c, i) => `${i}: ${c.code} (${c.similarity})`).join('\n') || 'none'}`
      ].join('\n\n')
    });
    // Guardrail: the model can only pick a validated candidate, never invent one.
    const idx = decision.chosenCandidateIndex;
    const recommended = idx !== null && idx >= 0 && idx < validated.length ? validated[idx]! : null;
    return this.finish(input, {
      ...analysis,
      failureCategory: decision.failureCategory,
      diagnosis: decision.diagnosis,
      recommended,
      confidence: recommended ? decision.confidence : 0
    });
  }

  private async analyse(input: ReturnType<typeof HealingInputSchema.parse>) {
    return withPage(input.pageUrl, async page => {
      const brokenSpec = parseLocator(input.brokenLocator);
      const brokenNow = await probe(page, brokenSpec);
      const { failureCategory, diagnosis } = classify(input.errorMessage, brokenNow);

      let candidates: HealingCandidate[] = [];
      if (failureCategory === 'locator') candidates = await this.findCandidates(page, brokenSpec);
      return { failureCategory, diagnosis, candidates };
    });
  }

  private async findCandidates(page: Page, broken: LocatorSpec): Promise<HealingCandidate[]> {
    const elements = (await captureElements(page, 300)).filter(e => e.visible);
    const target = coreString(broken);
    const ranked = elements
      .map(el => ({ el, similarity: elementSimilarity(target, el, broken) }))
      .filter(r => r.similarity >= 0.45)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 6);

    const out: HealingCandidate[] = [];
    const seen = new Set<string>();
    for (const { el, similarity } of ranked) {
      for (const spec of candidateLocators(el).slice(0, 3)) {
        const code = toCode(spec);
        if (seen.has(code)) continue;
        seen.add(code);
        const { matchCount, visible } = await probe(page, spec);
        out.push({ locator: spec, code, similarity: Number(similarity.toFixed(2)), matchCount, visible, validated: matchCount === 1 && visible });
      }
    }
    // Validated first, then by similarity, then by locator stability.
    const rank = (c: HealingCandidate) => (c.validated ? 10 : 0) + c.similarity + (stabilityOf(c.locator) === 'high' ? 0.05 : 0);
    return out.sort((a, b) => rank(b) - rank(a)).slice(0, 8);
  }

  private async finish(
    input: ReturnType<typeof HealingInputSchema.parse>,
    result: Pick<HealingProposal, 'failureCategory' | 'diagnosis' | 'candidates' | 'recommended' | 'confidence'>
  ): Promise<HealingProposal> {
    let status: HealingProposal['status'] = result.recommended ? 'proposed' : 'no-candidate';
    if (result.failureCategory !== 'locator') status = 'rejected';

    const autoAllowed =
      env.HEALING_MODE === 'auto-generated' &&
      status === 'proposed' &&
      result.confidence >= 0.6 &&
      input.testFile !== null &&
      path.resolve(PATHS.root, input.testFile).startsWith(PATHS.generatedTests + path.sep);

    if (autoAllowed && result.recommended && (await applyRepair(input.testFile!, input.brokenLocator, result.recommended))) {
      status = 'applied';
    }

    const proposal: HealingProposal = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      testFile: input.testFile,
      pageUrl: input.pageUrl,
      brokenLocator: input.brokenLocator,
      ...result,
      status,
      requiresHumanApproval: status !== 'applied'
    };
    await recordHealing(proposal);
    return proposal;
  }
}

// ───────────────────────────── helpers (exported for unit tests) ─────────────────────────────

/** "getByRole('button', { name: 'Serch' })" | "#id" | ".class" → LocatorSpec */
export function parseLocator(text: string): LocatorSpec {
  const role = text.match(/getByRole\(\s*['"](\w+)['"]\s*,\s*\{[^}]*name:\s*['"]([^'"]+)['"]/);
  if (role) return { strategy: 'role', role: role[1], value: role[2]!, exact: true };
  const by = text.match(/getBy(Label|Text|Placeholder|TestId)\(\s*['"]([^'"]+)['"]/);
  if (by) return { strategy: (by[1]![0]!.toLowerCase() + by[1]!.slice(1)) as LocatorSpec['strategy'], value: by[2]! };
  const css = text.match(/locator\(\s*['"](.+?)['"]\s*\)/);
  return { strategy: 'css', value: css ? css[1]! : text.trim() };
}

function coreString(spec: LocatorSpec): string {
  if (spec.strategy !== 'css') return spec.value.toLowerCase();
  // '#small-searchterm' -> 'small-searchterm'; 'input[name="q"]' -> 'q'
  const attr = spec.value.match(/\[\w+=['"]?([^'"\]]+)/);
  return (attr?.[1] ?? spec.value.replace(/^[#.]/, '').replace(/^[a-z]+[#.]/, '')).toLowerCase();
}

export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  a = a.toLowerCase();
  b = b.toLowerCase();
  if (a === b) return 1;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return 1 - dp[a.length]![b.length]! / Math.max(a.length, b.length);
}

function elementSimilarity(target: string, el: RawElement, broken: LocatorSpec): number {
  const fields = [el.id, el.nameAttr, el.name, el.label, el.placeholder, el.testId, ...el.classes].filter((v): v is string => Boolean(v));
  let best = Math.max(0, ...fields.map(f => similarity(target, f)));
  if (broken.strategy === 'role' && broken.role && el.role === broken.role) best = Math.min(1, best + 0.1);
  return best;
}

function classify(error: string, brokenNow: { matchCount: number; visible: boolean }): Pick<HealingProposal, 'failureCategory' | 'diagnosis'> {
  const e = error.toLowerCase();
  if (/net::err|econnrefused|enotfound|502|503|504/.test(e)) return { failureCategory: 'environment', diagnosis: 'Network or environment error; not a test defect.' };
  if (brokenNow.matchCount === 0) return { failureCategory: 'locator', diagnosis: 'The locator matches no element on the live page; the UI probably changed.' };
  if (brokenNow.matchCount > 1) return { failureCategory: 'locator', diagnosis: `The locator is ambiguous (${brokenNow.matchCount} matches); it needs to be more specific.` };
  if (/expect\(|tohave|tocontain|tobe/.test(e)) return { failureCategory: 'assertion', diagnosis: 'The element exists; the assertion failed. Possible product defect: investigate, do not heal.' };
  if (/timeout/.test(e)) return { failureCategory: 'timing', diagnosis: 'The element exists now; the failure was likely timing related. Prefer web-first assertions.' };
  return { failureCategory: 'unknown', diagnosis: 'The locator resolves correctly now; cause unknown.' };
}

/** Rewrites the broken locator expression in a generated spec. Returns true if something was replaced. */
async function applyRepair(testFile: string, broken: string, candidate: HealingCandidate): Promise<boolean> {
  const abs = path.resolve(PATHS.root, testFile);
  const source = await readFile(abs, 'utf8');
  const spec = parseLocator(broken);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern =
    spec.strategy === 'css'
      ? new RegExp(`(\\b[\\w.]+)\\.locator\\(\\s*(['"\`])${esc(spec.value)}\\2\\s*\\)`, 'g')
      : new RegExp(`(\\b[\\w.]+)\\.${esc(broken.replace(/^.*?(getBy)/, '$1'))}`, 'g');
  const updated = source.replace(pattern, (_m, receiver: string) => toCode(candidate.locator, receiver));
  if (updated === source) return false;
  await writeFile(abs, `// HEALED ${new Date().toISOString()}: ${broken} -> ${candidate.code}\n${updated}`, 'utf8');
  return true;
}

export const healingAgent = new HealingAgent();
