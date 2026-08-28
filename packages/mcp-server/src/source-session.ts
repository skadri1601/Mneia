import { isStorableText, NULL_BYTE_ERROR } from '@mneia/core';
import { z } from 'zod';

const NO_NULL_BYTE = { error: NULL_BYTE_ERROR } as const;

export const SourceSessionSchema = z.object({
  ref: z.string().max(500).refine(isStorableText, NO_NULL_BYTE).optional(),
  /**
   * The session that spawned this one, when the harness ran it as a sub-agent. Named by the
   * parent's own `ref`, because that is the identifier the harness has; Mneia resolves it to
   * a session row, and records no parentage if it cannot.
   */
  parentRef: z.string().max(500).refine(isStorableText, NO_NULL_BYTE).optional(),
  name: z.string().max(300).refine(isStorableText, NO_NULL_BYTE).optional(),
  url: z
    .url()
    .max(2000)
    .refine(isStorableText, NO_NULL_BYTE)
    .refine((value) => value.startsWith('https://') || value.startsWith('http://'), {
      error: 'url must be an absolute http or https URL',
    })
    .optional(),
});

export type SourceSession = z.infer<typeof SourceSessionSchema>;
