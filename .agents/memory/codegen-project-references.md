---
name: Codegen → declaration rebuild
description: Why frontend typecheck shows stale generated API types after running orval codegen, and how to fix it.
---

After changing `lib/api-spec/openapi.yaml` and running
`pnpm --filter @workspace/api-spec run codegen`, the regenerated `.ts`
sources in `lib/api-client-react/src/generated` and `lib/api-zod` update,
but consumer artifacts (e.g. `artifacts/mirtilo-app`) can still typecheck
against the OLD types.

**Why:** consumers reference `@workspace/api-client-react` through a TypeScript
**project reference** (`references` in `tsconfig.json`). Project references
resolve types from the referenced package's emitted declaration output
(`lib/api-client-react/dist/*.d.ts`, `emitDeclarationOnly`), NOT from its
`src`. orval regenerates `src` only, leaving `dist/*.d.ts` stale, so the
consumer sees the old shape (symptom: "Property X does not exist on type ...").

**How to apply:** after any codegen that changes the API client types, rebuild
the declaration output before typechecking consumers:
`pnpm exec tsc --build lib/api-client-react/tsconfig.json --force`.
There is no `build` npm script on that package — use `tsc --build` directly.
