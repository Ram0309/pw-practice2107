import type { Locator, Page } from '@playwright/test';
import type { LocatorSpec } from '../schemas/index.js';

/**
 * Locators as data. Agents reason about LocatorSpec objects (JSON); this module
 * turns them into a live Playwright Locator (for validation) or source code (for scripts).
 */
type AriaRole = Parameters<Page['getByRole']>[0];

export function toLocator(page: Page, spec: LocatorSpec): Locator {
  const exact = spec.exact ?? true;
  switch (spec.strategy) {
    case 'role':
      return page.getByRole((spec.role ?? 'button') as AriaRole, { name: spec.value, exact });
    case 'label':
      return page.getByLabel(spec.value, { exact });
    case 'placeholder':
      return page.getByPlaceholder(spec.value, { exact });
    case 'text':
      return page.getByText(spec.value, { exact });
    case 'testId':
      return page.getByTestId(spec.value);
    case 'css':
      return page.locator(spec.value);
  }
}

const q = (s: string) => `'${s.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;

export function toCode(spec: LocatorSpec, receiver = 'page'): string {
  switch (spec.strategy) {
    case 'role':
      return `${receiver}.getByRole(${q(spec.role ?? 'button')}, { name: ${q(spec.value)}${spec.exact === false ? '' : ', exact: true'} })`;
    case 'label':
      return `${receiver}.getByLabel(${q(spec.value)})`;
    case 'placeholder':
      return `${receiver}.getByPlaceholder(${q(spec.value)})`;
    case 'text':
      return `${receiver}.getByText(${q(spec.value)})`;
    case 'testId':
      return `${receiver}.getByTestId(${q(spec.value)})`;
    case 'css':
      return `${receiver}.locator(${q(spec.value)})`;
  }
}

/** Resolves a locator against the live page: how many elements match and is the first visible? */
export async function probe(page: Page, spec: LocatorSpec): Promise<{ matchCount: number; visible: boolean }> {
  try {
    const locator = toLocator(page, spec);
    const matchCount = await locator.count();
    const visible = matchCount > 0 ? await locator.first().isVisible() : false;
    return { matchCount, visible };
  } catch {
    return { matchCount: 0, visible: false };
  }
}

/**
 * Extracts a locator description from a Playwright error message or a source snippet, e.g.
 *   locator('#small-searchterm')  |  getByRole('button', { name: 'Serch' })
 */
export function extractLocator(text: string): string | null {
  const patterns = [
    /(getBy(?:Role|Label|Text|Placeholder|TestId)\([^)]*\))/,
    /locator\((['"`])(.+?)\1\)/,
    /waiting for (.+?)(?:\n|$)/
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return p === patterns[1] ? m[2]! : m[1]!.trim();
  }
  return null;
}
