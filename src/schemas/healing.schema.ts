import { z } from 'zod';
import { LocatorSpecSchema } from './ui.schema.js';

export const HealingCandidateSchema = z.object({
  locator: LocatorSpecSchema,
  code: z.string().describe('Rendered Playwright expression, e.g. page.getByRole(...)'),
  similarity: z.number().min(0).max(1),
  matchCount: z.number().int(),
  visible: z.boolean(),
  validated: z.boolean().describe('true only if it resolves to exactly one visible element on the live page')
});
export type HealingCandidate = z.infer<typeof HealingCandidateSchema>;

export const HealingProposalSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  testFile: z.string().nullable(),
  pageUrl: z.string(),
  brokenLocator: z.string(),
  failureCategory: z.enum(['locator', 'timing', 'assertion', 'application', 'data', 'environment', 'unknown']),
  diagnosis: z.string(),
  candidates: z.array(HealingCandidateSchema),
  recommended: HealingCandidateSchema.nullable(),
  confidence: z.number().min(0).max(1),
  status: z.enum(['proposed', 'applied', 'rejected', 'no-candidate']),
  requiresHumanApproval: z.boolean()
});
export type HealingProposal = z.infer<typeof HealingProposalSchema>;

export const HealingInputSchema = z.object({
  brokenLocator: z.string(),
  pageUrl: z.string(),
  errorMessage: z.string().default(''),
  testFile: z.string().nullable().default(null)
});
export type HealingInput = z.input<typeof HealingInputSchema>;

/** What the LLM is allowed to decide: classify, and pick one of the validated candidates. */
export const LlmHealingDecisionSchema = z.object({
  failureCategory: HealingProposalSchema.shape.failureCategory,
  diagnosis: z.string(),
  chosenCandidateIndex: z.number().int().nullable(),
  confidence: z.number().min(0).max(1)
});
