import { z } from 'zod';

export const TestFailureSchema = z.object({
  title: z.string(),
  file: z.string(),
  line: z.number().int().nullable(),
  error: z.string(),
  failedLocator: z.string().nullable().describe('Locator extracted from the Playwright error, if any'),
  pageUrl: z.string().nullable()
});
export type TestFailure = z.infer<typeof TestFailureSchema>;

export const ExecutionResultSchema = z.object({
  status: z.enum(['passed', 'failed', 'timedOut', 'skipped', 'error']),
  command: z.string(),
  total: z.number().int(),
  passed: z.number().int(),
  failed: z.number().int(),
  skipped: z.number().int(),
  flaky: z.number().int(),
  durationMs: z.number(),
  failures: z.array(TestFailureSchema),
  reportPath: z.string().nullable(),
  reason: z.string().nullable().describe('Why execution was skipped or errored')
});
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;
