#!/usr/bin/env bash
set -euo pipefail

PROXY="http://localhost:3000"
PASS=0
FAIL=0

assert_status() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  ✓ $label (status: $actual)"
    PASS=$((PASS+1))
  else
    echo "  ✗ $label — expected $expected, got $actual"
    FAIL=$((FAIL+1))
  fi
}

assert_contains() {
  local label="$1" needle="$2" haystack="$3"
  if echo "$haystack" | grep -q "$needle"; then
    echo "  ✓ $label"
    PASS=$((PASS+1))
  else
    echo "  ✗ $label — '$needle' not found in response"
    FAIL=$((FAIL+1))
  fi
}

assert_not_contains() {
  local label="$1" needle="$2" haystack="$3"
  if echo "$haystack" | grep -q "$needle"; then
    echo "  ✗ $label — '$needle' should NOT be present"
    FAIL=$((FAIL+1))
  else
    echo "  ✓ $label"
    PASS=$((PASS+1))
  fi
}

echo "========================================="
echo " Privacy Proxy Integration Tests"
echo "========================================="
echo ""

# ---- 1. Clean request (allow) ----
echo "--- 1. Clean request → allow ---"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$PROXY/api/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4","messages":[{"role":"user","content":"Hello"}]}')
STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert_status "Clean JSON forwarded" "200" "$STATUS"
assert_contains "Body forwarded to upstream" "Hello" "$BODY"
echo ""

# ---- 2. Bearer token → mask ----
echo "--- 2. Bearer token → mask ---"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$PROXY/api/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"auth":"Bearer abc123token456def","msg":"test"}')
STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert_status "Bearer masked, forwarded" "200" "$STATUS"
assert_not_contains "Bearer token removed" "abc123token456def" "$BODY"
assert_contains "Mask tag present" '\[BEARER_TOKEN\]' "$BODY"
echo ""

# ---- 3. Private key → mask ----
echo "--- 3. Private key → mask ---"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$PROXY/api/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"key":"-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----"}')
STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert_status "Private key masked, forwarded" "200" "$STATUS"
assert_not_contains "Key content removed" "MIIEow" "$BODY"
assert_contains "Mask tag present" '\[PRIVATE_KEY\]' "$BODY"
echo ""

# ---- 4. DB URI → mask ----
echo "--- 4. DB URI → mask ---"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$PROXY/api/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"db":"postgres://admin:s3cret@db.host:5432/production"}')
STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert_status "DB URI masked, forwarded" "200" "$STATUS"
assert_not_contains "DB credentials removed" "admin:s3cret" "$BODY"
assert_contains "Mask tag present" '\[DB_URI\]' "$BODY"
echo ""

# ---- 5. Phone → mask ----
echo "--- 5. Phone (PII) → mask ---"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$PROXY/api/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"contact":"13912345678"}')
STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert_status "Phone masked, forwarded" "200" "$STATUS"
assert_not_contains "Phone removed" "13912345678" "$BODY"
assert_contains "Mask tag present" '\[PHONE\]' "$BODY"
echo ""

# ---- 6. Email → mask ----
echo "--- 6. Email (PII) → mask ---"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$PROXY/api/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"msg":"send to admin@company.com"}')
STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert_status "Email masked, forwarded" "200" "$STATUS"
assert_not_contains "Email removed" "admin@company.com" "$BODY"
assert_contains "Mask tag present" '\[EMAIL\]' "$BODY"
echo ""

# ---- 7. ID card → mask ----
echo "--- 7. ID card (PII) → mask ---"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$PROXY/api/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"id":"330106200002020012"}')
STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert_status "ID card masked, forwarded" "200" "$STATUS"
assert_not_contains "ID card removed" "330106200002020012" "$BODY"
assert_contains "Mask tag present" '\[ID_CARD\]' "$BODY"
echo ""

# ---- 8. JWT → mask ----
echo "--- 8. JWT → mask ---"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$PROXY/api/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"token":"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def"}')
STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert_status "JWT masked, forwarded" "200" "$STATUS"
assert_not_contains "JWT removed" "eyJhbGciOiJIUzI1NiJ9" "$BODY"
assert_contains "Mask tag present" '\[JWT\]' "$BODY"
echo ""

# ---- 9. Context key → mask ----
echo "--- 9. Contextual secret → mask ---"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$PROXY/api/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"api_key":"aBcDeFgHiJkLmNoPqRsTuVwXyZ012"}')
STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert_status "Context key masked, forwarded" "200" "$STATUS"
assert_not_contains "Secret removed" "aBcDeFgHiJkLmNoPqRsTuVwXyZ012" "$BODY"
assert_contains "Mask tag present" '\[CONTEXTUAL_SECRET\]' "$BODY"
echo ""

# ---- 10. AWS key → mask ----
echo "--- 10. AWS access key → mask ---"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$PROXY/api/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"key":"AKIAIOSFODNN7EXAMPLE"}')
STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert_status "AWS key masked, forwarded" "200" "$STATUS"
assert_not_contains "AWS key removed" "AKIAIOSFODNN7EXAMPLE" "$BODY"
assert_contains "Mask tag present" '\[AWS_ACCESS_KEY\]' "$BODY"
echo ""

# ---- 11. GitHub token → mask ----
echo "--- 11. GitHub token → mask ---"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$PROXY/api/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"gh":"ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij"}')
STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert_status "GitHub token masked, forwarded" "200" "$STATUS"
assert_not_contains "GitHub token removed" "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij" "$BODY"
assert_contains "Mask tag present" '\[GITHUB_TOKEN\]' "$BODY"
echo ""

# ---- 12. Cookie header → mask ----
echo "--- 12. Cookie header → mask ---"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$PROXY/api/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"hdr":"Cookie: session=abc123xyz"}')
STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert_status "Cookie masked, forwarded" "200" "$STATUS"
assert_not_contains "Cookie removed" "session=abc123xyz" "$BODY"
assert_contains "Mask tag present" '\[COOKIE_HEADER\]' "$BODY"
echo ""

# ---- 13. Mixed secrets + PII → all masked ----
echo "--- 13. Mixed secrets + PII → all masked ---"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$PROXY/api/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"auth":"Bearer tok123abc","phone":"13912345678","email":"user@test.com","db":"postgres://u:p@h/d"}')
STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert_status "Mixed masked, forwarded" "200" "$STATUS"
assert_not_contains "Bearer removed" "tok123abc" "$BODY"
assert_not_contains "Phone removed" "13912345678" "$BODY"
assert_not_contains "Email removed" "user@test.com" "$BODY"
assert_not_contains "DB URI removed" "postgres://u:p@h/d" "$BODY"
assert_contains "BEARER tag" '\[BEARER_TOKEN\]' "$BODY"
assert_contains "PHONE tag" '\[PHONE\]' "$BODY"
assert_contains "EMAIL tag" '\[EMAIL\]' "$BODY"
assert_contains "DB_URI tag" '\[DB_URI\]' "$BODY"
echo ""

# ---- 14. Sensitive filename (id_rsa) → block ----
echo "--- 14. id_rsa upload → block ---"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$PROXY/api/v1/upload" \
  -H "Content-Type: multipart/form-data; boundary=----TestBoundary123" \
  --data-binary $'------TestBoundary123\r\nContent-Disposition: form-data; name="file"; filename="id_rsa"\r\nContent-Type: application/octet-stream\r\n\r\nfake key\r\n------TestBoundary123--\r\n')
STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert_status "id_rsa blocked" "403" "$STATUS"
assert_contains "Error present" "blocked_by_privacy_proxy" "$BODY"
assert_contains "Type correct" "SENSITIVE_FILENAME" "$BODY"
echo ""

# ---- 15. .env file → block ----
echo "--- 15. .env upload → block ---"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$PROXY/api/v1/upload" \
  -H "Content-Type: multipart/form-data; boundary=----TestBoundary123" \
  --data-binary $'------TestBoundary123\r\nContent-Disposition: form-data; name="file"; filename=".env"\r\nContent-Type: text/plain\r\n\r\nSECRET=abc\r\n------TestBoundary123--\r\n')
STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert_status ".env blocked" "403" "$STATUS"
assert_contains "Error present" "blocked_by_privacy_proxy" "$BODY"
echo ""

# ---- 16. Normal file upload → allow ----
echo "--- 16. Normal file upload → allow ---"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$PROXY/api/v1/upload" \
  -H "Content-Type: multipart/form-data; boundary=----TestBoundary123" \
  --data-binary $'------TestBoundary123\r\nContent-Disposition: form-data; name="file"; filename="report.pdf"\r\nContent-Type: application/pdf\r\n\r\nfake pdf\r\n------TestBoundary123--\r\n')
STATUS=$(echo "$RESP" | tail -1)
assert_status "Normal file forwarded" "200" "$STATUS"
echo ""

# ---- 17. GET request → allow ----
echo "--- 17. GET request → allow ---"
RESP=$(curl -s -w "\n%{http_code}" "$PROXY/api/v1/models")
STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert_status "GET forwarded" "200" "$STATUS"
assert_contains "Upstream responded" '"path"' "$BODY"
echo ""

# ---- Summary ----
echo "========================================="
TOTAL=$((PASS + FAIL))
echo " Results: $PASS/$TOTAL passed"
echo "========================================="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
echo "All tests passed!"
