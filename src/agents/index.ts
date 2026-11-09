/** Agent registry: one import point for the orchestrator and CLI. */
export { requirementAgent, RequirementAgent } from './requirement.agent.js';
export { testDesignAgent, TestDesignAgent } from './test-design.agent.js';
export { knowledgeAgent, KnowledgeAgent } from './knowledge.agent.js';
export { uiAnalysisAgent, UiAnalysisAgent } from './ui-analysis.agent.js';
export { scriptGeneratorAgent, ScriptGeneratorAgent } from './script-generator.agent.js';
export { codeValidatorAgent, CodeValidatorAgent } from './code-validator.agent.js';
export { executionAgent, ExecutionAgent } from './execution.agent.js';
export { healingAgent, HealingAgent } from './healing.agent.js';
export { apiAgent, ApiAgent } from './api.agent.js';
export { reportingAgent, ReportingAgent } from './reporting.agent.js';
export { AGENT_NAMES, type AgentName } from './agent-names.js';
