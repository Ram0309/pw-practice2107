import { z } from 'zod';

export const AgentTraceSchema = z.object({
  agent: z.string(),
  mode: z.string(),
  provider: z.string(),
  durationMs: z.number(),
  status: z.enum(['ok', 'error', 'skipped']),
  note: z.string().nullable()
});
export type AgentTrace = z.infer<typeof AgentTraceSchema>;

export const QaReportSchema = z.object({
  runId: z.string(),
  generatedAt: z.string(),
  application: z.string(),
  requirementId: z.string().nullable(),
  executiveSummary: z.string(),
  verdict: z.enum(['pass', 'fail', 'not-executed', 'blocked']),
  metrics: z.object({
    acceptanceCriteria: z.number().int(),
    testCases: z.number().int(),
    scriptsGenerated: z.number().int(),
    scriptsApproved: z.number().int(),
    testsExecuted: z.number().int(),
    testsPassed: z.number().int(),
    testsFailed: z.number().int(),
    healingProposals: z.number().int(),
    healingApplied: z.number().int(),
    apiTests: z.number().int()
  }),
  risks: z.array(z.string()),
  nextActions: z.array(z.string()),
  agentTrace: z.array(AgentTraceSchema),
  artifacts: z.array(z.string())
});
export type QaReport = z.infer<typeof QaReportSchema>;

export const LlmReportNarrativeSchema = z.object({
  executiveSummary: z.string(),
  risks: z.array(z.string()),
  nextActions: z.array(z.string())
});
