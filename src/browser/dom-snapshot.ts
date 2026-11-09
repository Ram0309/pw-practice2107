import type { Page } from '@playwright/test';
import type { LocatorSpec, UiElement } from '../schemas/index.js';

/**
 * DOM SNAPSHOT
 * Collects interactive elements with the attributes a tester needs to choose a
 * locator: implicit ARIA role, accessible name, id, name, classes, visibility.
 * Then proposes locators in the order defined by automation-standards.md.
 */
export interface RawElement {
  tag: string;
  role: string;
  name: string;
  id: string | null;
  nameAttr: string | null;
  type: string | null;
  classes: string[];
  text: string;
  placeholder: string | null;
  label: string | null;
  testId: string | null;
  visible: boolean;
}

export async function captureElements(page: Page, limit = 200): Promise<RawElement[]> {
  // tsx/esbuild wraps named inner functions in __name(); define it in the page so the
  // serialised function below runs. (String form, so it is not transformed itself.)
  await page.evaluate('globalThis.__name = globalThis.__name || (fn => fn)');
  return page.evaluate(max => {
    const implicitRole = (el: Element): string => {
      const explicit = el.getAttribute('role');
      if (explicit) return explicit;
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute('type') ?? '').toLowerCase();
      if (tag === 'a' && el.hasAttribute('href')) return 'link';
      if (tag === 'button') return 'button';
      if (tag === 'input') {
        if (['submit', 'button', 'reset', 'image'].includes(type)) return 'button';
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'hidden') return 'hidden';
        return 'textbox';
      }
      if (tag === 'select') return 'combobox';
      if (tag === 'textarea') return 'textbox';
      if (/^h[1-6]$/.test(tag)) return 'heading';
      return tag;
    };
    const labelFor = (el: Element): string | null => {
      const id = el.getAttribute('id');
      const byFor = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
      return (byFor?.textContent ?? el.closest('label')?.textContent ?? '').trim() || null;
    };
    const accessibleName = (el: Element): string => {
      const aria = el.getAttribute('aria-label');
      if (aria) return aria.trim();
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) return labelledBy.split(' ').map(id => document.getElementById(id)?.textContent ?? '').join(' ').trim();
      const tag = el.tagName.toLowerCase();
      if (tag === 'input') {
        const type = (el.getAttribute('type') ?? '').toLowerCase();
        if (['submit', 'button', 'reset'].includes(type)) return (el as HTMLInputElement).value.trim();
        return labelFor(el) ?? el.getAttribute('title') ?? '';
      }
      if (tag === 'img') return el.getAttribute('alt') ?? '';
      return ((el as HTMLElement).innerText || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ');
    };

    const nodes = Array.from(document.querySelectorAll('a[href], button, input, select, textarea, h1, h2, [role], [data-testid]'));
    return nodes
      .filter(el => (el.getAttribute('type') ?? '').toLowerCase() !== 'hidden')
      .slice(0, max)
      .map(el => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          tag: el.tagName.toLowerCase(),
          role: implicitRole(el),
          name: accessibleName(el).slice(0, 120),
          id: el.getAttribute('id'),
          nameAttr: el.getAttribute('name'),
          type: el.getAttribute('type'),
          classes: Array.from(el.classList).slice(0, 5),
          text: ((el as HTMLElement).innerText ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
          placeholder: el.getAttribute('placeholder'),
          label: labelFor(el),
          testId: el.getAttribute('data-testid'),
          visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
        };
      });
  }, limit);
}

const GENERATED_ID = /\d{4,}|[a-f0-9]{8,}|^ember|^react|^ui-id/i;

/** Candidate locators for one element, best first (automation-standards.md order). */
export function candidateLocators(el: RawElement): LocatorSpec[] {
  const out: LocatorSpec[] = [];
  if (el.testId) out.push({ strategy: 'testId', value: el.testId });
  if (['button', 'link', 'heading', 'checkbox', 'radio', 'combobox'].includes(el.role) && el.name) {
    out.push({ strategy: 'role', role: el.role, value: el.name, exact: true });
  }
  if (el.label) out.push({ strategy: 'label', value: el.label.replace(/:$/, ''), exact: false });
  if (el.placeholder) out.push({ strategy: 'placeholder', value: el.placeholder });
  if (el.id && !GENERATED_ID.test(el.id)) out.push({ strategy: 'css', value: `#${el.id}` });
  if (el.nameAttr) out.push({ strategy: 'css', value: `${el.tag}[name="${el.nameAttr}"]` });
  if (el.role === 'textbox' && el.name) out.push({ strategy: 'role', role: 'textbox', value: el.name, exact: true });
  if (el.classes.length) out.push({ strategy: 'css', value: `${el.tag}.${el.classes.join('.')}` });
  if (!out.length && el.text) out.push({ strategy: 'text', value: el.text, exact: true });
  return out;
}

export function stabilityOf(spec: LocatorSpec | undefined): UiElement['stability'] {
  if (!spec) return 'low';
  if (spec.strategy === 'testId' || spec.strategy === 'role' || spec.strategy === 'label') return 'high';
  if (spec.strategy === 'css' && spec.value.startsWith('#')) return 'high';
  if (spec.strategy === 'css' && spec.value.includes('[name=')) return 'medium';
  return 'low';
}
