import { isStorableText, NULL_BYTE_ERROR } from '@mneia/core';
import { z } from 'zod';

const NO_NULL_BYTE = { error: NULL_BYTE_ERROR } as const;

export const SourceSessionSchema = z.object({
  ref: z.string().max(500).refine(isStorableText, NO_NULL_BYTE).optional(),
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
