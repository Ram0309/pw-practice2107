import { z } from 'zod';

export const KnowledgeChunkSchema = z.object({
  id: z.string(),
  source: z.string().describe('File name in project-knowledge/'),
  heading: z.string(),
  text: z.string(),
  score: z.number()
});
export type KnowledgeChunk = z.infer<typeof KnowledgeChunkSchema>;

export const KnowledgeAnswerSchema = z.object({
  query: z.string(),
  answer: z.string().describe('Grounded answer that only uses the retrieved chunks'),
  citations: z.array(z.string()).describe('source#heading of each chunk used'),
  chunks: z.array(KnowledgeChunkSchema),
  gaps: z.array(z.string()).describe('What the knowledge base could not answer')
});
export type KnowledgeAnswer = z.infer<typeof KnowledgeAnswerSchema>;

/** Module metadata parsed from project-knowledge/modules.md */
export const ModuleInfoSchema = z.object({
  name: z.string(),
  keywords: z.array(z.string()),
  risk: z.enum(['high', 'medium', 'low']),
  pages: z.array(z.string()),
  apis: z.array(z.string()),
  rulePrefixes: z.array(z.string()).describe('Business-rule id prefixes owned by the module, e.g. BR-SEARCH'),
  description: z.string()
});
export type ModuleInfo = z.infer<typeof ModuleInfoSchema>;
