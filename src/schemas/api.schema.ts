import { z } from 'zod';

/** Endpoint contract as documented in project-knowledge/api-contracts.md (json block). */
export const ApiEndpointSchema = z.object({
  id: z.string(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  path: z.string(),
  description: z.string(),
  responseType: z.enum(['json', 'html']),
  safe: z.boolean().describe('false = changes server state beyond the anonymous session'),
  examples: z.array(
    z.object({
      name: z.string(),
      pathParams: z.record(z.string(), z.string()).default({}),
      query: z.record(z.string(), z.string()).default({}),
      expectedStatus: z.number().int(),
      expectJson: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
      expectBodyContains: z.array(z.string()).default([])
    })
  )
});
export type ApiEndpoint = z.infer<typeof ApiEndpointSchema>;

export const ApiTestSchema = z.object({
  id: z.string(),
  endpointId: z.string(),
  title: z.string(),
  type: z.enum(['positive', 'negative', 'contract', 'boundary']),
  method: ApiEndpointSchema.shape.method,
  path: z.string().describe('Concrete path with parameters substituted'),
  query: z.record(z.string(), z.string()),
  expectedStatus: z.number().int(),
  expectJson: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  expectBodyContains: z.array(z.string())
});
export type ApiTest = z.infer<typeof ApiTestSchema>;

export const ApiPlanSchema = z.object({
  baseUrl: z.string(),
  tests: z.array(ApiTestSchema),
  skippedEndpoints: z.array(z.object({ endpointId: z.string(), reason: z.string() })),
  specFile: z.string().nullable()
});
export type ApiPlan = z.infer<typeof ApiPlanSchema>;
