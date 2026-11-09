import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { env, PROVIDERS, type ProviderName } from '../config/env.js';
import type { AgentName } from '../agents/agent-names.js';

/**
 * MODEL ABSTRACTION LAYER
 * ----------------------
 * Agents never import a vendor SDK. They ask for "the model routed to agent X" and
 * receive a LangChain BaseChatModel. Switching vendor = editing .env only.
 *
 * Vendor packages are loaded with dynamic import(), so only the selected
 * provider's SDK is loaded at runtime.
 *
 * Model ids change often: override them with LLM_MODEL or LLM_AGENT_ROUTES.
 */
export const DEFAULT_MODELS: Record<Exclude<ProviderName, 'mock'>, string> = {
  openai: 'gpt-4o-mini',
  'azure-openai': '(uses AZURE_OPENAI_API_DEPLOYMENT_NAME)',
  anthropic: 'claude-sonnet-5-5',
  google: 'gemini-2.5-flash',
  ollama: 'llama3.1'
};

export interface ModelRoute {
  provider: ProviderName;
  model?: string;
}

/** Parses LLM_AGENT_ROUTES, e.g. "scriptGenerator=anthropic:claude-sonnet-5-5;healing=ollama:llama3.1" */
export function parseRoutes(raw: string | undefined): Partial<Record<string, ModelRoute>> {
  const routes: Partial<Record<string, ModelRoute>> = {};
  for (const entry of (raw ?? '').split(';').map(s => s.trim()).filter(Boolean)) {
    const [agent, target] = entry.split('=').map(s => s.trim());
    if (!agent || !target) throw new Error(`Invalid LLM_AGENT_ROUTES entry "${entry}"`);
    const [provider, ...modelParts] = target.split(':');
    if (!PROVIDERS.includes(provider as ProviderName)) {
      throw new Error(`Unknown provider "${provider}" in LLM_AGENT_ROUTES`);
    }
    routes[agent] = { provider: provider as ProviderName, model: modelParts.join(':') || undefined };
  }
  return routes;
}

const routes = parseRoutes(env.LLM_AGENT_ROUTES);

export function resolveRoute(agent: AgentName): ModelRoute {
  return routes[agent] ?? { provider: env.LLM_PROVIDER, model: env.LLM_MODEL };
}

export function missingCredentials(provider: ProviderName): string | null {
  switch (provider) {
    case 'openai':
      return env.OPENAI_API_KEY || env.OPENAI_BASE_URL ? null : 'OPENAI_API_KEY';
    case 'azure-openai':
      return env.AZURE_OPENAI_API_KEY && env.AZURE_OPENAI_API_INSTANCE_NAME && env.AZURE_OPENAI_API_DEPLOYMENT_NAME
        ? null
        : 'AZURE_OPENAI_API_KEY / AZURE_OPENAI_API_INSTANCE_NAME / AZURE_OPENAI_API_DEPLOYMENT_NAME';
    case 'anthropic':
      return env.ANTHROPIC_API_KEY ? null : 'ANTHROPIC_API_KEY';
    case 'google':
      return env.GOOGLE_API_KEY ? null : 'GOOGLE_API_KEY';
    case 'ollama':
    case 'mock':
      return null;
  }
}

const cache = new Map<string, BaseChatModel>();

export async function createChatModel(route: ModelRoute): Promise<BaseChatModel> {
  if (route.provider === 'mock') {
    throw new Error('The mock provider has no chat model; agents use their offline logic.');
  }
  const missing = missingCredentials(route.provider);
  if (missing) throw new Error(`Provider "${route.provider}" selected but ${missing} is not set in .env`);

  const model = route.model ?? DEFAULT_MODELS[route.provider];
  const key = `${route.provider}:${model}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const common = { temperature: env.LLM_TEMPERATURE, maxRetries: env.LLM_MAX_RETRIES };
  let chat: BaseChatModel;

  switch (route.provider) {
    case 'openai': {
      const { ChatOpenAI } = await import('@langchain/openai');
      chat = new ChatOpenAI({
        ...common,
        model,
        apiKey: env.OPENAI_API_KEY ?? 'not-required-for-local-endpoint',
        timeout: env.LLM_TIMEOUT_MS,
        configuration: env.OPENAI_BASE_URL ? { baseURL: env.OPENAI_BASE_URL } : undefined
      });
      break;
    }
    case 'azure-openai': {
      const { AzureChatOpenAI } = await import('@langchain/openai');
      chat = new AzureChatOpenAI({
        ...common,
        timeout: env.LLM_TIMEOUT_MS,
        azureOpenAIApiKey: env.AZURE_OPENAI_API_KEY,
        azureOpenAIApiInstanceName: env.AZURE_OPENAI_API_INSTANCE_NAME,
        azureOpenAIApiDeploymentName: route.model ?? env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
        azureOpenAIApiVersion: env.AZURE_OPENAI_API_VERSION
      });
      break;
    }
    case 'anthropic': {
      const { ChatAnthropic } = await import('@langchain/anthropic');
      chat = new ChatAnthropic({ ...common, model, apiKey: env.ANTHROPIC_API_KEY });
      break;
    }
    case 'google': {
      const { ChatGoogleGenerativeAI } = await import('@langchain/google-genai');
      chat = new ChatGoogleGenerativeAI({ ...common, model, apiKey: env.GOOGLE_API_KEY });
      break;
    }
    case 'ollama': {
      const { ChatOllama } = await import('@langchain/ollama');
      chat = new ChatOllama({ temperature: env.LLM_TEMPERATURE, model, baseUrl: env.OLLAMA_BASE_URL });
      break;
    }
  }
  cache.set(key, chat);
  return chat;
}

export function describeProviders() {
  return PROVIDERS.map(p => ({
    provider: p,
    defaultModel: p === 'mock' ? '(offline deterministic logic)' : DEFAULT_MODELS[p],
    credentials: missingCredentials(p) ? `missing ${missingCredentials(p)}` : 'ok',
    active: env.LLM_PROVIDER === p
  }));
}
