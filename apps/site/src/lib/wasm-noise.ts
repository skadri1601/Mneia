export const WASM_COMPILE_SIGNATURE = 'Wasm code generation disallowed by embedder';

interface ExceptionCarrier {
  readonly exception?:
    | { readonly values?: readonly { readonly type?: string; readonly value?: string }[] }
    | undefined;
  readonly message?: string | undefined;
}

export function isVendoredWasmLexerNoise(event: ExceptionCarrier | null): boolean {
  if (event === null) {
    return false;
  }

  const values = event.exception?.values ?? [];
  const fromException = values.some(
    (value) =>
      value.type === 'CompileError' && (value.value ?? '').includes(WASM_COMPILE_SIGNATURE),
  );

  return fromException || (event.message ?? '').includes(WASM_COMPILE_SIGNATURE);
}
