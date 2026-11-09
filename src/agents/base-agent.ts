import type { z } from 'zod';
import { env } from '../config/env.js';
import { agentLogger } from '../core/logger.js';
import { resolveRoute } from '../llm/providers.js';
import type { AgentName } from './agent-names.js';

export type AgentMode = 'llm' | 'offline' | 'offline-fallback';

export interface AgentResult<O> {
  agent: AgentName;
  mode: AgentMode;
  provider: string;
  durationMs: number;
  output: O;
  warnings: string[];
}

export interface RunOptions {
  /** Force deterministic logic regardless of provider (used by unit tests). */
  forceOffline?: boolean;
}

let offlineEverywhere = false;
/** Process-wide switch (CLI --offline): every agent uses its deterministic logic. */
export function forceOfflineMode(on: boolean): void {
  offlineEverywhere = on;
}

/**
 * BASE AGENT — the contract every specialist agent follows.
 *
 *  offline(input) : deterministic, rule-based implementation. Always available,
 *                   free, repeatable. Used with LLM_PROVIDER=mock, in unit tests,
 *                   and as a safety net when an LLM call fails.
 *  withLlm(input) : AI-reasoning implementation through the model abstraction layer.
 *
 * run() selects the mode, measures time, logs, and validates the output against
 * the agent's Zod schema. An agent can never hand malformed data to the next one.
 */
export abstract class BaseAgent<I, O> {
  abstract readonly name: AgentName;
  abstract readonly description: string;
  protected abstract readonly outputSchema: z.ZodType<O>;

  protected abstract offline(input: I): Promise<O>;
  protected abstract withLlm(input: I): Promise<O>;

  protected get log() {
    return agentLogger(this.name);
  }

  async run(input: I, options: RunOptions = {}): Promise<AgentResult<O>> {
    const route = resolveRoute(this.name);
    let mode: AgentMode = options.forceOffline || offlineEverywhere || route.provider === 'mock' ? 'offline' : 'llm';
    const warnings: string[] = [];
    const started = Date.now();
    this.log.info({ mode, provider: route.provider, model: route.model }, `${this.description} — started`);

    let output: O;
    try {
      output = mode === 'llm' ? await this.withLlm(input) : await this.offline(input);
    } catch (error) {
      if (mode !== 'llm' || !env.LLM_FALLBACK_TO_OFFLINE) throw error;
      const message = `LLM path failed, used offline logic instead: ${String(error).slice(0, 300)}`;
      this.log.warn(message);
      warnings.push(message);
      mode = 'offline-fallback';
      output = await this.offline(input);
    }

    const validated = this.outputSchema.parse(output);
    const durationMs = Date.now() - started;
    this.log.info({ mode, durationMs }, `${this.description} — finished`);
    return {
      agent: this.name,
      mode,
      provider: mode === 'llm' ? `${route.provider}:${route.model ?? 'default'}` : 'offline',
      durationMs,
      output: validated,
      warnings
    };
  }
}
