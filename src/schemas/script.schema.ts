import { z } from 'zod';

export const GeneratedScriptSchema = z.object({
  testCaseId: z.string(),
  fileName: z.string().regex(/^[a-z0-9][a-z0-9._-]*\.spec\.ts$/, 'must be kebab-case *.spec.ts'),
  filePath: z.string(),
  code: z.string().min(20),
  generator: z.enum(['llm', 'template']),
  attempt: z.number().int().min(1),
  notes: z.array(z.string())
});
export type GeneratedScript = z.infer<typeof GeneratedScriptSchema>;

export const ValidationIssueSchema = z.object({
  severity: z.enum(['error', 'warning', 'info']),
  rule: z.string(),
  message: z.string(),
  line: z.number().int().nullable()
});
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

export const ValidationResultSchema = z.object({
  filePath: z.string(),
  testCaseId: z.string(),
  valid: z.boolean().describe('true when there are no error-level issues'),
  approvedForExecution: z.boolean(),
  score: z.number().min(0).max(100),
  issues: z.array(ValidationIssueSchema)
});
export type ValidationResult = z.infer<typeof ValidationResultSchema>;

/** Shape the LLM reviewer returns (merged with static findings). */
export const LlmReviewSchema = z.object({
  issues: z.array(ValidationIssueSchema),
  summary: z.string()
});
