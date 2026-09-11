# Research: Secret configuration leakage detection approaches

## Sources searched / fetched

- GitHub Secret Scanning custom patterns: https://docs.github.com/en/enterprise-cloud@latest/code-security/how-tos/secure-your-secrets/customize-leak-detection/define-custom-patterns
- Gitleaks default config: https://github.com/gitleaks/gitleaks/blob/master/config/gitleaks.toml
- TruffleHog custom detectors: https://docs.trufflesecurity.com/custom-detectors
- GitGuardian Base64 Generic high entropy detector: https://docs.gitguardian.com/secrets-detection/secrets-detection-engine/detectors/generics/base64_generic_high_entropy_secret
- OWASP Secrets Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html

## Findings applicable to this project

1. Mature scanners avoid one giant regex. They combine keyword/context matching, regex capture groups, entropy/value validation, allowlists/exclusions, and test/dry-run review.
2. GitHub custom patterns support a primary secret regex plus extra surrounding constraints before/after/additional matches, then recommend dry runs to review false positives.
3. Gitleaks-style rules use keywords as a prefilter, regex capture groups for the actual secret, entropy thresholds, and allowlists to reduce false positives.
4. TruffleHog custom detectors support multiple regexes, primary regex selection, exclude regexes/words, entropy, and optional live verification. Live verification is not appropriate here because the proxy must never call leaked endpoints or test user credentials.
5. GitGuardian generic detectors focus on high-entropy values assigned to sensitive variable names and use keyword prevalidators. This supports our context-key approach but suggests adding a score/validator layer instead of masking every URL-like value.
6. OWASP emphasizes secret lifecycle, audit, rotation/revocation, and monitoring. For this proxy fix, that means detection should not only mask but also leave audit metadata sufficient to trigger key rotation workflows outside this code change.

## Recommended approach for this task

Use a structured contextual detector rather than only expanding `SECRET_KEYS`:

- Parse key/value assignments from raw text and synthetic JSON context.
- Normalize keys case-insensitively and separator-insensitively (`apiKey`, `api_key`, `api-key`, `APIKEY` => `apikey`; `baseUrl`, `base_url`, `BASEURL` => `baseurl`).
- Classify keys into groups:
  - `secret`: API keys, tokens, passwords, credentials, private keys.
  - `endpoint`: base URLs, API URLs, endpoints, hosts, server URLs, and reported typo `bashUrl`.
  - `identity`: existing pair-trigger keys such as username/account/session.
- Use score/co-occurrence calibration:
  - Secret-key values are masked directly when value passes suspicious-value validation.
  - Endpoint-key URL values are masked directly for explicit endpoint config keys, but only when value looks endpoint-like or when paired with a secret key in the same payload.
  - If both `secret` and `endpoint` appear in the same payload, mask both as high-confidence config leakage.
  - Preserve existing identity behavior: identity keys mask only when paired with a secret key.
- Validate values by type:
  - Token-like values: length + allowed charset + not plain word/number + optional entropy later.
  - Endpoint-like values: URL/host/path characters accepted; prefer URL/host-ish validation over entropy because URLs are not high-entropy.
- Keep allowlist/exclusion support and add tests as a dry-run equivalent.

## Deferred improvements

- Add Shannon entropy scoring for generic token values if false positives persist.
- Add base64-decoding pass for base64-encoded config snippets in a separate task; this is more invasive and not required for the reported leak.
- Add incident-response guidance in docs: if a config file was forwarded before the fix, rotate exposed API keys and endpoints/access tokens.
