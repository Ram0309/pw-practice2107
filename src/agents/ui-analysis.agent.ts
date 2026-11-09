import { z } from 'zod';
import { withPage } from '../browser/browser-session.js';
import { candidateLocators, captureElements, stabilityOf, type RawElement } from '../browser/dom-snapshot.js';
import { probe } from '../browser/locators.js';
import { invokeStructured } from '../llm/structured.js';
import { systemPrompt } from '../llm/prompts.js';
import { UiMapSchema, type UiElement, type UiMap } from '../schemas/index.js';
import { BaseAgent } from './base-agent.js';

/**
 * AGENT 4 — UI ANALYSIS AGENT
 * ---------------------------
 * Opens a page, snapshots the interactive DOM, and produces a UI map in which
 * every element has a recommended locator that was checked to be unique on the
 * live page. The UI map feeds the Script Generator and is the baseline the
 * Healing Agent compares against.
 */
export interface UiAnalysisInput {
  path: string;
  maxElements?: number;
}

const LlmAnnotationSchema = z.object({
  pageSummary: z.string(),
  purposes: z.array(z.object({ ref: z.string(), purpose: z.string() })),
  observations: z.array(z.string())
});

export class UiAnalysisAgent extends BaseAgent<UiAnalysisInput, UiMap> {
  readonly name = 'uiAnalysis' as const;
  readonly description = 'UI Analysis Agent: inspect browser DOM';
  protected readonly outputSchema = UiMapSchema;

  protected async offline({ path, maxElements = 80 }: UiAnalysisInput): Promise<UiMap> {
    return withPage(path, async page => {
      const raw = (await captureElements(page, 250)).filter(e => e.visible && (e.name || e.id || e.text));
      const elements: UiElement[] = [];
      for (const el of raw.slice(0, maxElements)) {
        const candidates = candidateLocators(el);
        // Recommend the first candidate that resolves to exactly one element.
        let recommended = candidates[0];
        for (const c of candidates) {
          if ((await probe(page, c)).matchCount === 1) {
            recommended = c;
            break;
          }
        }
        if (!recommended) continue;
        elements.push({
          ref: `e${elements.length + 1}`,
          tag: el.tag, role: el.role, name: el.name, id: el.id, nameAttr: el.nameAttr,
          classes: el.classes, text: el.text, visible: el.visible,
          recommended,
          alternatives: candidates.filter(c => c !== recommended).slice(0, 3),
          stability: stabilityOf(recommended),
          purpose: guessPurpose(el)
        });
      }
      const low = elements.filter(e => e.stability === 'low').length;
      return {
        url: page.url(),
        title: await page.title(),
        capturedAt: new Date().toISOString(),
        pageSummary: `${await page.title()} — ${elements.length} interactive elements (${elements.filter(e => e.role === 'button').length} buttons, ${elements.filter(e => e.role === 'link').length} links, ${elements.filter(e => e.role === 'textbox').length} text inputs).`,
        elements,
        observations: [
          `${low} element(s) only have low-stability locators (class or text based).`,
          elements.some(e => e.recommended.strategy === 'testId') ? 'data-testid attributes are present.' : 'No data-testid attributes found; ask developers to add them to key controls.'
        ]
      };
    });
  }

  protected async withLlm(input: UiAnalysisInput): Promise<UiMap> {
    const map = await this.offline(input);
    const annotation = await invokeStructured({
      agent: this.name,
      schema: LlmAnnotationSchema,
      schemaName: 'ui_annotation',
      system: await systemPrompt('ui-analysis-agent'),
      user: `PAGE: ${map.title} (${map.url})\nELEMENTS:\n${map.elements.map(e => `${e.ref} ${e.role} "${e.name}" id=${e.id ?? '-'}`).join('\n')}`
    });
    // The LLM may only annotate elements that exist in the snapshot.
    const purposes = new Map(annotation.purposes.map(p => [p.ref, p.purpose]));
    return {
      ...map,
      pageSummary: annotation.pageSummary,
      elements: map.elements.map(e => ({ ...e, purpose: purposes.get(e.ref) ?? e.purpose })),
      observations: [...map.observations, ...annotation.observations]
    };
  }
}

function guessPurpose(el: RawElement): string {
  const n = `${el.name} ${el.id ?? ''} ${el.classes.join(' ')}`.toLowerCase();
  if (n.includes('search')) return 'Product search';
  if (n.includes('cart')) return 'Shopping cart';
  if (n.includes('login') || n.includes('log in')) return 'Authentication';
  if (n.includes('register')) return 'Registration';
  if (n.includes('newsletter')) return 'Newsletter subscription';
  if (el.role === 'link') return 'Navigation';
  return `${el.role} control`;
}

export const uiAnalysisAgent = new UiAnalysisAgent();
