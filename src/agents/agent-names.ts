/** Stable identifiers for the 10 specialist agents (used for routing, logs and reports). */
export const AGENT_NAMES = [
  'requirement',
  'testDesign',
  'knowledge',
  'uiAnalysis',
  'scriptGenerator',
  'codeValidator',
  'execution',
  'healing',
  'api',
  'reporting'
] as const;

export type AgentName = (typeof AGENT_NAMES)[number];
