import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { PATHS } from '../core/paths.js';
import type { KnowledgeChunk, ModuleInfo } from '../schemas/index.js';

/**
 * KNOWLEDGE BASE
 * --------------
 * Loads project-knowledge/*.md, splits them into heading-level chunks and ranks
 * them with BM25 keyword scoring. It sits behind the `KnowledgeRetriever`
 * interface, so a vector database (RAG with embeddings) can replace it later
 * without changing any agent.
 */
export interface KnowledgeRetriever {
  search(query: string, k?: number): Promise<KnowledgeChunk[]>;
}

export interface BusinessRule {
  id: string;
  text: string;
}

const STOP_WORDS = new Set(
  'a an and are as at be by can for from has have i in is it its my of on or so that the this to was when will with want should must able customer user'.split(' ')
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

interface IndexedChunk extends Omit<KnowledgeChunk, 'score'> {
  tokens: string[];
}

export class MarkdownKnowledgeBase implements KnowledgeRetriever {
  private chunks: IndexedChunk[] = [];
  private files = new Map<string, string>();
  private loaded = false;

  constructor(private readonly dir: string = PATHS.knowledge) {}

  async load(): Promise<this> {
    if (this.loaded) return this;
    const names = (await readdir(this.dir)).filter(n => n.endsWith('.md')).sort();
    for (const name of names) {
      const content = await readFile(path.join(this.dir, name), 'utf8');
      this.files.set(name, content);
      this.chunks.push(...this.split(name, content));
    }
    this.loaded = true;
    return this;
  }

  /** One chunk per ## heading (falls back to the whole file). */
  private split(source: string, content: string): IndexedChunk[] {
    const sections = content.split(/^(?=##\s)/m);
    return sections
      .map((section, i) => {
        const heading = section.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim() ?? source;
        const text = section.trim();
        return { id: `${source}#${i}`, source, heading, text, tokens: tokenize(text) };
      })
      .filter(c => c.text.length > 0);
  }

  /** BM25 ranking (k1=1.2, b=0.75). Good enough for a few hundred chunks. */
  async search(query: string, k = 5): Promise<KnowledgeChunk[]> {
    await this.load();
    const terms = [...new Set(tokenize(query))];
    if (terms.length === 0) return [];
    const N = this.chunks.length;
    const avgLen = this.chunks.reduce((s, c) => s + c.tokens.length, 0) / Math.max(N, 1);
    const df = new Map(terms.map(t => [t, this.chunks.filter(c => c.tokens.includes(t)).length]));

    return this.chunks
      .map(chunk => {
        let score = 0;
        for (const term of terms) {
          const tf = chunk.tokens.filter(t => t === term).length;
          if (!tf) continue;
          const n = df.get(term) ?? 0;
          const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
          score += idf * ((tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (chunk.tokens.length / avgLen))));
        }
        return { id: chunk.id, source: chunk.source, heading: chunk.heading, text: chunk.text, score: Number(score.toFixed(3)) };
      })
      .filter(c => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  async file(name: string): Promise<string> {
    await this.load();
    const content = this.files.get(name);
    if (content === undefined) throw new Error(`Knowledge file not found: ${name}`);
    return content;
  }

  /** Parses `## Module: X` sections with Keywords/Risk/Pages/APIs/Rules bullets from modules.md. */
  async modules(): Promise<ModuleInfo[]> {
    const content = await this.file('modules.md');
    return content
      .split(/^## Module:\s*/m)
      .slice(1)
      .map(block => {
        const [nameLine, ...rest] = block.split('\n');
        const field = (label: string) =>
          rest.find(l => l.toLowerCase().startsWith(`- ${label.toLowerCase()}:`))?.split(':').slice(1).join(':').trim() ?? '';
        const list = (label: string) =>
          field(label).split(label === 'APIs' ? /,\s*(?=[A-Z]+\s)/ : ',').map(s => s.trim()).filter(s => s && s !== 'none');
        const risk = field('Risk').toLowerCase();
        return {
          name: nameLine!.trim(),
          keywords: list('Keywords').map(s => s.toLowerCase()),
          risk: (['high', 'medium', 'low'].includes(risk) ? risk : 'medium') as ModuleInfo['risk'],
          pages: list('Pages'),
          apis: list('APIs'),
          rulePrefixes: list('Rules'),
          description: rest.filter(l => !l.startsWith('- ')).join(' ').trim()
        };
      });
  }

  /** Parses `- **BR-XXX-NN**: text` lines from business-rules.md. */
  async businessRules(): Promise<BusinessRule[]> {
    const content = await this.file('business-rules.md');
    return [...content.matchAll(/^-\s+\*\*(BR-[A-Z0-9-]+)\*\*:?\s*(.+)$/gm)].map(m => ({ id: m[1]!, text: m[2]!.trim() }));
  }
}

/** Shared singleton — the knowledge files are read once per process. */
export const knowledgeBase = new MarkdownKnowledgeBase();
