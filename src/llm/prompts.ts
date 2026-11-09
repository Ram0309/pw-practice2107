import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PATHS } from '../core/paths.js';

/** Prompts live in prompts/*.md so QA engineers can tune them without touching code. */
const cache = new Map<string, string>();

async function load(name: string): Promise<string> {
  if (!cache.has(name)) cache.set(name, await readFile(path.join(PATHS.prompts, `${name}.md`), 'utf8'));
  return cache.get(name)!;
}

/** System prompt = shared safety policy + the agent's own instructions. */
export async function systemPrompt(agentPromptFile: string): Promise<string> {
  return `${await load('agent-policy')}\n\n---\n\n${await load(agentPromptFile)}`;
}
