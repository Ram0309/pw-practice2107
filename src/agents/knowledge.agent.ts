import { z } from 'zod';
import { knowledgeBase, tokenize, type MarkdownKnowledgeBase } from '../knowledge/knowledge-base.js';
import { invokeStructured } from '../llm/structured.js';
import { systemPrompt } from '../llm/prompts.js';
import { KnowledgeAnswerSchema, type KnowledgeAnswer } from '../schemas/index.js';
import { BaseAgent } from './base-agent.js';

/**
 * AGENT 3 — KNOWLEDGE / RAG AGENT
 * -------------------------------
 * Retrieval-augmented answers from project-knowledge/*.md.
 * Retrieval is always deterministic (BM25 today, a vector store later). The LLM
 * only writes a grounded answer from the retrieved chunks and must cite them.
 */
export interface KnowledgeQuery {
  query: string;
  k?: number;
}

const LlmAnswerSchema = z.object({ answer: z.string(), citations: z.array(z.string()), gaps: z.array(z.string()) });

export class KnowledgeAgent extends BaseAgent<KnowledgeQuery, KnowledgeAnswer> {
  readonly name = 'knowledge' as const;
  readonly description = 'Knowledge Agent: retrieve project knowledge';
  protected readonly outputSchema = KnowledgeAnswerSchema;

  constructor(private readonly kb: MarkdownKnowledgeBase = knowledgeBase) {
    super();
  }

  protected async offline({ query, k = 5 }: KnowledgeQuery): Promise<KnowledgeAnswer> {
    const chunks = await this.kb.search(query, k);
    const terms = new Set(tokenize(query));
    // Extractive answer: the lines of the top chunks that mention a query term.
    const lines = chunks.flatMap(c =>
      c.text
        .split('\n')
        .filter(l => /^\s*(-|\d+\.)/.test(l) && tokenize(l).some(t => terms.has(t)))
        .slice(0, 4)
        .map(l => `${l.trim()} [${c.source}]`)
    );
    return {
      query,
      answer: lines.length ? lines.slice(0, 10).join('\n') : 'No matching project knowledge found.',
      citations: chunks.map(c => `${c.source}#${c.heading}`),
      chunks,
      gaps: chunks.length ? [] : [`Nothing in project-knowledge/ matches "${query}". Add documentation for it.`]
    };
  }

  protected async withLlm({ query, k = 5 }: KnowledgeQuery): Promise<KnowledgeAnswer> {
    const chunks = await this.kb.search(query, k);
    if (chunks.length === 0) return this.offline({ query, k });
    const result = await invokeStructured({
      agent: this.name,
      schema: LlmAnswerSchema,
      schemaName: 'knowledge_answer',
      system: await systemPrompt('knowledge-agent'),
      user: `QUESTION: ${query}\n\nCHUNKS:\n${chunks.map(c => `[${c.source}#${c.heading}]\n${c.text}`).join('\n\n')}`
    });
    const valid = new Set(chunks.map(c => `${c.source}#${c.heading}`));
    return { query, ...result, citations: result.citations.filter(c => valid.has(c)), chunks };
  }
}

export const knowledgeAgent = new KnowledgeAgent();
