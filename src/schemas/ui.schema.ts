import { z } from 'zod';

/** A Playwright locator described as data, so it can be validated, ranked and rendered to code. */
export const LocatorSpecSchema = z.object({
  strategy: z.enum(['role', 'label', 'placeholder', 'text', 'testId', 'css']),
  value: z.string(),
  role: z.string().optional(),
  exact: z.boolean().optional()
});
export type LocatorSpec = z.infer<typeof LocatorSpecSchema>;

export const UiElementSchema = z.object({
  ref: z.string().describe('e1, e2 ... stable within one snapshot'),
  tag: z.string(),
  role: z.string(),
  name: z.string(),
  id: z.string().nullable(),
  nameAttr: z.string().nullable(),
  classes: z.array(z.string()),
  text: z.string(),
  visible: z.boolean(),
  recommended: LocatorSpecSchema,
  alternatives: z.array(LocatorSpecSchema),
  stability: z.enum(['high', 'medium', 'low']),
  purpose: z.string()
});
export type UiElement = z.infer<typeof UiElementSchema>;

export const UiMapSchema = z.object({
  url: z.string(),
  title: z.string(),
  capturedAt: z.string(),
  pageSummary: z.string(),
  elements: z.array(UiElementSchema),
  observations: z.array(z.string())
});
export type UiMap = z.infer<typeof UiMapSchema>;
