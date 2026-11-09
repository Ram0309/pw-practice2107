import { Annotation } from '@langchain/langgraph';
import type {
  AgentTrace,
  ApiPlan,
  ExecutionResult,
  GeneratedScript,
  HealingProposal,
  KnowledgeAnswer,
  QaReport,
  RequirementAnalysis,
  TestPlan,
  UiMap,
  ValidationResult
} from '../schemas/index.js';

/**
 * Shared state passed between graph nodes. Each node returns a partial update;
 * reducers decide how an update merges (replace, append, or upsert by key).
 */
const replace = <T>(fallback: T) => Annotation<T>({ reducer: (_old, next) => next, default: () => fallback });
const append = <T>() => Annotation<T[]>({ reducer: (old, next) => old.concat(next), default: () => [] });
const upsertBy = <T>(key: (t: T) => string) =>
  Annotation<T[]>({
    reducer: (old, next) => {
      const map = new Map(old.map(o => [key(o), o]));
      for (const n of next) map.set(key(n), n);
      return [...map.values()];
    },
    default: () => []
  });

export interface RunOptions {
  execute: boolean;
  heal: boolean;
  maxScripts: number;
}

export const QaState = Annotation.Root({
  // inputs
  runId: Annotation<string>(),
  story: Annotation<string>(),
  storyId: replace<string | undefined>(undefined),
  options: Annotation<RunOptions>(),

  // agent outputs
  knowledge: replace<KnowledgeAnswer | null>(null),
  requirement: replace<RequirementAnalysis | null>(null),
  testPlan: replace<TestPlan | null>(null),
  uiMap: replace<UiMap | null>(null),
  scripts: upsertBy<GeneratedScript>(s => s.testCaseId),
  validations: upsertBy<ValidationResult>(v => v.testCaseId),
  execution: replace<ExecutionResult | null>(null),
  healing: append<HealingProposal>(),
  apiPlan: replace<ApiPlan | null>(null),
  report: replace<QaReport | null>(null),

  // control flow
  generationAttempt: replace<number>(0),
  rerunAfterHealing: replace<boolean>(false),

  // observability
  trace: append<AgentTrace>(),
  errors: append<string>()
});

export type QaStateType = typeof QaState.State;
export type QaStateUpdate = typeof QaState.Update;
