import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { appendJsonLine } from '../core/artifacts.js';
import { PATHS } from '../core/paths.js';
import type { HealingProposal } from '../schemas/index.js';

/**
 * Append-only audit trail of every healing decision (reports/healing/healing-history.jsonl).
 * Used by the Reporting Agent and by humans reviewing what the framework changed and why.
 */
export async function recordHealing(proposal: HealingProposal): Promise<void> {
  await appendJsonLine(PATHS.healingHistory, proposal);
}

export async function readHealingHistory(): Promise<HealingProposal[]> {
  if (!existsSync(PATHS.healingHistory)) return [];
  const text = await readFile(PATHS.healingHistory, 'utf8');
  return text.split('\n').filter(Boolean).map(l => JSON.parse(l) as HealingProposal);
}
