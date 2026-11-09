import 'dotenv/config';
import { z } from 'zod';

/**
 * Single source of truth for configuration.
 * Every setting is validated with Zod at start-up, so a typo in .env fails fast
 * with a clear message instead of failing deep inside an agent.
 */
export const PROVIDERS = ['mock', 'openai', 'azure-openai', 'anthropic', 'google', 'ollama'] as const;
export type ProviderName = (typeof PROVIDERS)[number];

const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalString = z.preprocess(blankToUndefined, z.string().optional());
const flag = (fallback: boolean) =>
  z.preprocess(blankToUndefined, z.enum(['true', 'false', '1', '0', 'yes', 'no']).optional())
    .transform(v => (v === undefined ? fallback : ['true', '1', 'yes'].includes(v)));

const EnvSchema = z.object({
  LLM_PROVIDER: z.preprocess(blankToUndefined, z.enum(PROVIDERS).default('mock')),
  LLM_MODEL: optionalString,
  LLM_TEMPERATURE: z.preprocess(blankToUndefined, z.coerce.number().min(0).max(2).default(0)),
  LLM_MAX_RETRIES: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).max(5).default(2)),
  LLM_TIMEOUT_MS: z.preprocess(blankToUndefined, z.coerce.number().int().positive().default(60_000)),
  LLM_FALLBACK_TO_OFFLINE: flag(true),
  LLM_AGENT_ROUTES: optionalString,

  OPENAI_API_KEY: optionalString,
  OPENAI_BASE_URL: z.preprocess(blankToUndefined, z.url().optional()),
  AZURE_OPENAI_API_KEY: optionalString,
  AZURE_OPENAI_API_INSTANCE_NAME: optionalString,
  AZURE_OPENAI_API_DEPLOYMENT_NAME: optionalString,
  AZURE_OPENAI_API_VERSION: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  GOOGLE_API_KEY: optionalString,
  OLLAMA_BASE_URL: z.preprocess(blankToUndefined, z.url().default('http://localhost:11434')),

  APP_BASE_URL: z.preprocess(blankToUndefined, z.url().default('https://demowebshop.tricentis.com')),
  HEADLESS: flag(true),

  ALLOW_GENERATED_TEST_EXECUTION: flag(false),
  HEALING_MODE: z.preprocess(blankToUndefined, z.enum(['suggest', 'auto-generated']).default('suggest')),
  MAX_GENERATED_SCRIPTS: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(20).default(3)),
  MAX_GENERATION_ATTEMPTS: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(5).default(2)),
  MAX_TEST_RUN_SECONDS: z.preprocess(blankToUndefined, z.coerce.number().int().positive().default(300)),

  LOG_LEVEL: z.preprocess(
    blankToUndefined,
    z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info')
  )
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration in .env:\n${details}`);
  }
  return parsed.data;
}

export const env = loadEnv();
