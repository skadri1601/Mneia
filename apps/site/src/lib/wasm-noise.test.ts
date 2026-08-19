import { describe, expect, it } from 'vitest';
import { isVendoredWasmLexerNoise, WASM_COMPILE_SIGNATURE } from './wasm-noise';

const compileError = {
  exception: {
    values: [
      {
        type: 'CompileError',
        value: `WebAssembly.compile(): ${WASM_COMPILE_SIGNATURE}`,
      },
    ],
  },
};

describe('isVendoredWasmLexerNoise', () => {
  it('matches the CompileError the bundled lexers raise on every cold start', () => {
    expect(isVendoredWasmLexerNoise(compileError)).toBe(true);
  });

  it('matches it when Sentry reports it as a bare message', () => {
    expect(isVendoredWasmLexerNoise({ message: `CompileError: ${WASM_COMPILE_SIGNATURE}` })).toBe(
      true,
    );
  });

  it('keeps a CompileError that is not the embedder refusal', () => {
    expect(
      isVendoredWasmLexerNoise({
        exception: { values: [{ type: 'CompileError', value: 'unexpected section order' }] },
      }),
    ).toBe(false);
  });

  it('keeps an unrelated error that merely mentions WebAssembly', () => {
    expect(
      isVendoredWasmLexerNoise({
        exception: { values: [{ type: 'TypeError', value: 'WebAssembly is not defined' }] },
      }),
    ).toBe(false);
  });

  it('keeps every ordinary error, which is the whole point of matching narrowly', () => {
    for (const value of ['Database connection lost', 'fetch failed', 'boom']) {
      expect(isVendoredWasmLexerNoise({ exception: { values: [{ type: 'Error', value }] } })).toBe(
        false,
      );
    }
  });

  it('handles a null event and an event with no exception at all', () => {
    expect(isVendoredWasmLexerNoise(null)).toBe(false);
    expect(isVendoredWasmLexerNoise({})).toBe(false);
    expect(isVendoredWasmLexerNoise({ exception: { values: [] } })).toBe(false);
  });
});
