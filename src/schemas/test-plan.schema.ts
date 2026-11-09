import { z } from 'zod';

export const TestStepSchema = z.object({
  action: z.string(),
  data: z.string().nullable(),
  expected: z.string().nullable()
});

export const TestCaseSchema = z.object({
  id: z.string().describe('TC-<REQ>-01 ...'),
  title: z.string(),
  type: z.enum(['positive', 'negative', 'boundary', 'edge', 'api', 'accessibility']),
  priority: z.enum(['P1', 'P2', 'P3']),
  acceptanceCriteria: z.array(z.string()).describe('AC ids this case covers'),
  preconditions: z.array(z.string()),
  steps: z.array(TestStepSchema).min(1),
  expectedResult: z.string(),
  testData: z.record(z.string(), z.string()),
  tags: z.array(z.string()),
  automationCandidate: z.boolean()
});
export type TestCase = z.infer<typeof TestCaseSchema>;

export const TestPlanSchema = z.object({
  requirementId: z.string(),
  module: z.string(),
  strategy: z.string(),
  testCases: z.array(TestCaseSchema).min(1),
  traceability: z.array(z.object({ acceptanceCriterion: z.string(), testCaseIds: z.array(z.string()) })),
  coverageGaps: z.array(z.string())
});
export type TestPlan = z.infer<typeof TestPlanSchema>;
