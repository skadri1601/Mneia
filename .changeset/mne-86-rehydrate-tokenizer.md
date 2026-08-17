---
'@mneia/core': patch
---

Rehydrate no longer fails on any project that has items. The BPE token counter loaded
`gpt-tokenizer` through `createRequire` at call time, which no bundler can trace: the
hosted app's `next build --output standalone` therefore shipped without it, and the first
`countItemTokens` call threw `MODULE_NOT_FOUND`. Empty projects returned a slice because
nothing was ever counted. The import is now static, so the tokenizer is resolved when the
bundle is built rather than when a request arrives.
