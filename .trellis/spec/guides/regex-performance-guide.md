# Regex Performance Thinking Guide

> Dated: 2026-08-12. Triggered by a real incident: 1.18MB proxy request took 18.5s due to catastrophic backtracking in two scanners.

## Why This Guide Exists

A privacy-scanning proxy was forwarding 1.18MB LLM requests with 18.5s added latency. Root cause: two regexes with unbounded greedy quantifiers backtracked quadratically on real-world input (base64 tokens, ANSI escape codes, markdown). The fix took 30 minutes; the diagnosis took hours. This guide prevents the diagnosis from being repeated.

## Core Rule

**Before writing a regex with a greedy quantifier (`+`, `*`, `{n,}`), ask: what happens when the NEXT token fails to match?**

Greedy quantifier consumes as much as possible, then backtracks one char at a time when the following pattern fails. If the quantifier can match a long run and the following token is rare, this is O(n²) — catastrophic on inputs >100KB.

## Red Flags (any of these = potential explosion)

| Flag | Example | Why Dangerous |
|---|---|---|
| `[A-Za-z0-9_.-]+` followed by a rare token | `([A-Za-z0-9_.-]+)\s*\[` | base64/token strings match the class; `[` is rare → backtrack every position |
| `[^"']+` (negated class) followed by optional/closing chars | `([^"'\]]+)\s*\]` | IF the closing char is missing, backtracks over the whole run |
| Local part before `@` | `[A-Za-z0-9._%+-]+@` | long alphanumeric runs (base64) match local part; `@` rare → O(n²) |
| Alternation of long prefixes | `(?:api|base|config|secret|token)[^ ]*` | each alternative tries the whole tail |

## Fixes (in order of preference)

1. **Anchored boundary (lookbehind)** — cheapest, keeps semantics:
   ```regex
   // Before (O(n²) on base64): /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
   // After (linear):            /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
   ```
   The lookbehind prevents starting a match inside a longer run, bounding the backtracking.

2. **Tighten the character class** — match what the semantic intends:
   ```regex
   // Before: /([A-Za-z0-9_.-]+)\s*\[/    (matches base64, ANSI remnants, "- [ ]" list items)
   // After:  /(?<![A-Za-z0-9_.-])([A-Za-z_][A-Za-z0-9_.-]{0,63})\s*\[/  (identifier-shaped keys only)
   ```

3. **Length cap** — `{0,63}` bounds the worst-case backtracking to a constant.

4. **Atomic group / possessive quantifier** — JS lacks `(?>...)`; `++` is V8-supported but not portable. Prefer 1-3.

## Verification Checklist

- [ ] Test with real-world-shaped input: base64 blobs, ANSI escapes, long tokens, markdown, URLs
- [ ] Test the **no-match** case (input that should NOT match) — the failure path is where backtracking hides
- [ ] Time it on a 1MB+ input; assert <200ms in a regression test
- [ ] Confirm match count/semantics unchanged (compare old vs new regex on the same corpus)

## Anti-Pattern (do NOT do this)

```text
// "fixing" a slow regex by making it faster via .slice() in a loop
// or by pre-filtering with another regex — measure first, the root cause is usually backtracking
```

## Related

- `src/scanner/context-key.ts` BRACKET pattern (fixed 2026-08-12)
- `src/scanner/pii.ts` EMAIL pattern (fixed 2026-08-12)
- `benchmarks/scan-latency-real.test.ts` — real-payload performance gate