#!/bin/bash
set -e
export SKIP_INNER_RECURSION=true
export SUPABASE_URL=$VITE_SUPABASE_URL
export SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

echo "--- Phase 4A ---"
npx tsx tests/phase4a-live-validation.ts || true
echo "--- Phase 4B ---"
npx tsx tests/phase4b-live-validation.ts || true
echo "--- Phase 5A ---"
npx tsx tests/phase5a-transcript-ingestion.ts || true
echo "--- Phase 5B ---"
npx tsx tests/phase5b-gemini-extraction.ts || true
echo "--- Phase 5C ---"
npx tsx tests/phase5c-buyer-qualification.ts || true
echo "--- Phase 5D ---"
npx tsx tests/phase5d-buyer-scoring.ts || true
echo "--- Phase 5E ---"
npx tsx tests/phase5e-project-matching.ts || true
echo "--- Phase 5F ---"
npx tsx tests/phase5f-broker-handoff.ts || true
echo "--- Phase 6B ---"
npx tsx tests/phase6b-live-scout-verification.ts || true
echo "--- Phase 7 ---"
npx tsx tests/scout-runtime-verification.ts || true

echo "--- Webhook Tests ---"
npx tsx tests/security-webhook-signature.ts
npx tsx tests/security-webhook-correlation.ts
npx tsx tests/security-webhook-idempotency.ts
npx tsx tests/security-webhook-rls-db.ts

echo "--- Phase 8A Security Suites ---"
npx tsx tests/security-auth-foundation.ts
npx tsx tests/security-tenant-model.ts
npx tsx tests/security-repository-tenant-scoping.ts

echo "All tests completed."
