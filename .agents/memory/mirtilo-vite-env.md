---
name: Mirtilo Vite env quirk
description: Why artifacts/mirtilo-app/vite.config.ts defines VITE_SUPABASE_* from SUPABASE_*.
---

`artifacts/mirtilo-app/src/lib/supabase.ts` reads `import.meta.env.VITE_SUPABASE_URL!` and `VITE_SUPABASE_ANON_KEY!`. The Replit secrets manager in this project stores them **unprefixed** (`SUPABASE_URL`, `SUPABASE_ANON_KEY`), so Vite does not expose them to the client and `createClient(undefined, undefined)` throws at module load — blanking the whole app at the LoginPage import.

**Why:** Don't strip the `define {}` block from `vite.config.ts`. It maps `SUPABASE_*` → `VITE_SUPABASE_*` at build time so the existing source code works without renaming secrets.

**How to apply:** If `LoginPage` / supabase blows up silently and the page is blank with no console errors, check that the vite `define` fallback is still present and that at least one of `VITE_SUPABASE_URL` or `SUPABASE_URL` is set in the environment.
