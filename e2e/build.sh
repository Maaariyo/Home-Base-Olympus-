#!/bin/sh
# Builds the site twice for the browser tests: demo mode, and Supabase mode pointed at a fake host
# that the tests answer themselves. Run from the repository root.
set -e
npm run build
rm -rf e2e/.out-demo && mv out e2e/.out-demo
NEXT_PUBLIC_SUPABASE_URL=http://supabase.test NEXT_PUBLIC_SUPABASE_ANON_KEY=test-key npm run build
rm -rf e2e/.out-supabase && mv out e2e/.out-supabase
