import { z } from 'zod';

/** Input to the Requirement Agent: a raw user story / requirement text. */
export const RequirementInputSchema = z.object({
  storyId: z.string().optional(),
  text: z.string().min(10, 'Requirement text is too short to analyse'),
  source: z.string().optional()
});
export type RequirementInput = z.infer<typeof RequirementInputSchema>;

export const AcceptanceCriterionSchema = z.object({
  id: z.string().describe('AC-1, AC-2 ...'),
  text: z.string(),
  category: z.enum(['functional', 'validation', 'ui', 'data', 'non-functional']),
  testable: z.boolean().describe('false when the criterion is vague or not measurable'),
  clarificationNeeded: z.string().nullable().describe('What must be clarified when testable=false')
});

/** Output of the Requirement Agent: a structured, testable requirement. */
export const RequirementAnalysisSchema = z.object({
  id: z.string().describe('Requirement id, e.g. REQ-001'),
  title: z.string(),
  module: z.string().describe('Application module from project knowledge, e.g. "Product Search"'),
  userRole: z.string(),
  goal: z.string(),
  businessValue: z.string(),
  summary: z.string(),
  acceptanceCriteria: z.array(AcceptanceCriterionSchema).min(1),
  relatedBusinessRules: z.array(z.object({ id: z.string(), text: z.string() })),
  assumptions: z.array(z.string()),
  openQuestions: z.array(z.string()),
  risk: z.object({ level: z.enum(['high', 'medium', 'low']), rationale: z.string() }),
  recommendedTestTypes: z.array(z.enum(['ui', 'api', 'negative', 'boundary', 'accessibility', 'security', 'performance'])),
  testDataHints: z.array(z.string()),
  sources: z.array(z.string()).describe('Knowledge files used as evidence')
});
export type RequirementAnalysis = z.infer<typeof RequirementAnalysisSchema>;
