# React template upload: local review

Implementation branch: `feat/react-template-upload`, based on `bc99a57`.
Earlier styling-preset work remains untouched in the sibling worktree.

## Behavior

- The original `src/pdf/ResumeDocument.tsx` is unchanged and remains the immutable
  built-in renderer. No CV data migration rewrites content or revisions.
- New immutable React PDF TSX packages live in owner-scoped SQLite/PostgreSQL
  template storage. Upload/delete replace the proposed styling-preset editor.
- CVs snapshot source and fonts. Applying requires the current CV revision;
  deletion of library entries cannot break saved snapshots.
- MCP exposes list/get/upload/delete plus `get_template_guide` and resource
  `cv-builder://templates/guide`. The guide includes the complete data contract,
  starter, font packaging/reuse, supported React PDF subset and parsing checks.
- The local bearer/browser operator shares one library; OAuth uses the validated
  subject. Existing deployment-wide CV access is unchanged. A template snapshot
  inherits its CV's access, including its source/fonts.
- Custom web previews and exports render on the server; uploaded code never runs
  in the browser. Original default rendering stays on its existing paths.

## Isolation

The parent launches a bounded child with a scrubbed environment. esbuild only
resolves virtual React/PDF imports. QuickJS evaluates template JS with CPU/heap/
stack limits and no host callbacks or filesystem/network APIs. The resulting JSON
is checked against component/prop/style/font allowlists before React PDF sees it.
Font assets are base64 TTF/OTF, not arbitrary URLs; agents can obtain licensed CDN
fonts and bundle them. `copyFontsFrom` supports owner-scoped reuse without returning
large font blobs through MCP. Source/font bytes never execute in Node's JS realm.
The worker has an output limit, deadline, V8 heap limit and per-process concurrency
cap. This is not an OS container or a formal security audit of parser dependencies.

## Verification

- `npm test`: 40 tests passed (8 files), including authenticated MCP lifecycle,
  owner boundaries, immutable default copy with real bundled fonts, compact/long
  validation, deletion with surviving CV snapshots, revision conflicts, draft
  preview without persistence, legacy SQLite migration, missing-text rejection,
  disallowed imports/URLs/styles and guest CPU/heap limits.
- `npm run build`: TypeScript, Vite and both server/worker bundles passed.
- `node --import tsx scripts/smoke-template-build.ts`: built production server +
  built worker uploaded a template with bundled-font reuse, applied it and exported
  PDF using a temporary local SQLite DB and isolated process environment.
- `git diff --check` and `graphify update .` completed.

## Limits and outstanding verification

- React support is synchronous pure components/JSX, helper functions and standard
  data calculations. Hooks/context, arbitrary npm imports, remote resources,
  images, async components and render callbacks are not exposed. This is a
  documented React PDF subset, not unrestricted application code.
- Upload renders two fixtures; each custom preview/export checks normalized
  extractable field text and page bounds. These checks cannot certify any ATS or
  prove reading order, repeated-field completeness, contrast or absence of overlap.
- PostgreSQL implementation is type/build checked but not runtime verified: no
  local PostgreSQL binary and Docker daemon unavailable. Live hosted ChatGPT and
  Hermes, native browser visual QA and container/clean-host execution remain
  unverified. The production-mode smoke used installed local dependencies.
- Existing npm audit reports 19 dependency advisories; no broad dependency upgrade
  was included. Existing Vite large-chunk warning remains.
- No push, deployment, production configuration change or production data access.
