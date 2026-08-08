import { z } from 'zod';
import { isStorableText, NULL_BYTE_ERROR } from '../domain/text.js';
import { ACCESS_SCOPES, ITEM_KINDS } from '../store/schema.js';

export type ExtractionErrorCode = 'not_json' | 'invalid_shape' | 'invalid_options';

export class ExtractionError extends Error {
  readonly code: ExtractionErrorCode;

  constructor(code: ExtractionErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ExtractionError';
    this.code = code;
  }
}

export const MAX_TITLE_LENGTH = 300;
export const MAX_BODY_LENGTH = 8000;
export const MAX_RATIONALE_LENGTH = 4000;
export const MAX_SOURCE_REF_LENGTH = 500;

const KIND_ERROR = `kind must be one of: ${ITEM_KINDS.join(', ')}`;
const SCOPE_ERROR = `accessScope must be one of: ${ACCESS_SCOPES.join(', ')}`;
const NO_NULL_BYTE = { error: NULL_BYTE_ERROR } as const;

export const ExtractionCandidateSchema = z.object({
  kind: z.enum(ITEM_KINDS, { error: KIND_ERROR }),
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH).refine(isStorableText, NO_NULL_BYTE),
  body: z
    .string()
    .max(MAX_BODY_LENGTH)
    .refine(isStorableText, NO_NULL_BYTE)
    .nullable()
    .default(null),
  rationale: z
    .string()
    .max(MAX_RATIONALE_LENGTH)
    .refine(isStorableText, NO_NULL_BYTE)
    .nullable()
    .default(null),
  confidence: z.number().min(0).max(1).default(0.5),
  loadBearing: z.boolean().default(false),
  accessScope: z.enum(ACCESS_SCOPES, { error: SCOPE_ERROR }).default('project'),
  sourceRef: z
    .string()
    .max(MAX_SOURCE_REF_LENGTH)
    .refine(isStorableText, NO_NULL_BYTE)
    .nullable()
    .default(null),
});

export const ExtractionOutputSchema = z.object({
  candidates: z.array(ExtractionCandidateSchema),
});

export type ExtractionCandidate = z.infer<typeof ExtractionCandidateSchema>;
export type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>;

const EXPECTED_SHAPE =
  '{"candidates":[{"kind","title","body","rationale","confidence","loadBearing","accessScope","sourceRef"}]}';

const DISCARD_WHOLE_RESPONSE =
  'Discard the entire response and run the extraction again — no candidate from a malformed response is written, because a partly valid batch cannot be told apart from an invented one.';

function preview(value: string): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length > 200 ? `${collapsed.slice(0, 200)}…` : collapsed;
}

function describeValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return `an array of ${value.length}`;
  }
  return typeof value;
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

function decodeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new ExtractionError(
      'not_json',
      `The extraction response is not valid JSON. Expected ${EXPECTED_SHAPE}; received ${preview(text) === '' ? 'an empty response' : `"${preview(text)}"`}. ${DISCARD_WHOLE_RESPONSE}`,
      { cause },
    );
  }
}

export function parseExtractionOutput(raw: unknown): ExtractionOutput {
  const value = typeof raw === 'string' ? decodeJson(raw) : raw;
  const parsed = ExtractionOutputSchema.safeParse(value);

  if (parsed.success) {
    return parsed.data;
  }

  throw new ExtractionError(
    'invalid_shape',
    `The extraction response does not match the extraction schema. Expected ${EXPECTED_SHAPE}; received ${describeValue(value)} failing on — ${describeIssues(parsed.error)}. ${DISCARD_WHOLE_RESPONSE}`,
    { cause: parsed.error },
  );
}
