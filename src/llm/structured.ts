import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import type { z } from 'zod';
import { env } from '../config/env.js';
import { agentLogger } from '../core/logger.js';
import type { AgentName } from '../agents/agent-names.js';
import { createChatModel, resolveRoute } from './providers.js';

/**
 * Calls the model routed to an agent and forces a response matching a Zod schema.
 * LLM output is treated as untrusted input: it is always re-parsed with Zod, and
 * when validation fails the issues are fed back to the model for a corrected attempt.
 */
export async function invokeStructured<S extends z.ZodType>(args: {
  agent: AgentName;
  schema: S;
  schemaName: string;
  system: string;
  user: string;
}): Promise<z.infer<S>> {
  const log = agentLogger(args.agent);
  const route = resolveRoute(args.agent);
  const model = await createChatModel(route);
  // The cast keeps this layer independent of each vendor's generic overloads.
  const runnable = model.withStructuredOutput(args.schema as never, { name: args.schemaName });

  const messages: BaseMessage[] = [new SystemMessage(args.system), new HumanMessage(args.user)];
  let lastError: unknown;

  for (let attempt = 1; attempt <= env.LLM_MAX_RETRIES + 1; attempt++) {
    const started = Date.now();
    try {
      const raw = await runnable.invoke(messages);
      const parsed = args.schema.safeParse(raw);
      if (parsed.success) {
        log.debug({ route, attempt, ms: Date.now() - started }, 'structured LLM call succeeded');
        return parsed.data;
      }
      lastError = parsed.error;
      const issues = parsed.error.issues
        .slice(0, 10)
        .map(i => `${i.path.join('.')}: ${i.message}`)
        .join('\n');
      log.warn({ attempt, issues }, 'LLM output failed schema validation; retrying with feedback');
      messages.push(new HumanMessage(`Your previous answer did not match the schema:\n${issues}\nReturn a corrected answer.`));
    } catch (error) {
      lastError = error;
      log.warn({ attempt, err: String(error) }, 'LLM call failed');
    }
  }
  throw new Error(`[${args.agent}] structured LLM call failed after retries: ${String(lastError)}`);
}
