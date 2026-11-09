import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute paths for every folder the framework reads from or writes to. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const PATHS = {
  root: ROOT,
  knowledge: path.join(ROOT, 'project-knowledge'),
  prompts: path.join(ROOT, 'prompts'),
  requirements: path.join(ROOT, 'requirements'),
  testData: path.join(ROOT, 'test-data'),
  generatedTests: path.join(ROOT, 'generated-tests'),
  reports: path.join(ROOT, 'reports'),
  logs: path.join(ROOT, 'logs'),
  healingHistory: path.join(ROOT, 'reports', 'healing', 'healing-history.jsonl')
} as const;
