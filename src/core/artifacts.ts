import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PATHS } from './paths.js';

/**
 * All file output goes through these helpers. Agents may only write inside
 * reports/ and generated-tests/ — a guard against prompt-injected file paths.
 */
const WRITABLE_ROOTS = [PATHS.reports, PATHS.generatedTests];

function guard(target: string): string {
  const abs = path.resolve(PATHS.root, target);
  const allowed = WRITABLE_ROOTS.some(root => abs === root || abs.startsWith(root + path.sep));
  if (!allowed) throw new Error(`Refusing to write outside reports/ or generated-tests/: ${abs}`);
  return abs;
}

export async function writeText(target: string, content: string): Promise<string> {
  const abs = guard(target);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, 'utf8');
  return abs;
}

export async function writeJson(target: string, data: unknown): Promise<string> {
  return writeText(target, JSON.stringify(data, null, 2));
}

export async function appendJsonLine(target: string, data: unknown): Promise<void> {
  const abs = guard(target);
  await mkdir(path.dirname(abs), { recursive: true });
  await appendFile(abs, JSON.stringify(data) + '\n', 'utf8');
}

export async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

/** Repo-relative, forward-slash path for logs and reports. */
export const relative = (abs: string) => path.relative(PATHS.root, abs).replaceAll('\\', '/');

export function newRunId(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `run-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

export const slugify = (text: string, max = 60) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max) || 'untitled';
