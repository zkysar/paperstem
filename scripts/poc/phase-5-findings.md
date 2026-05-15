# Phase 5 findings — web client integration

## What got built

Auto-classification is now wired into the draft-mode flow exactly as Flow A→C
in `scripts/poc/ui-mockup.html` describes:

- `src/client/hooks/useAutoClassify.ts` — orchestrator hook. Watches for
  `draftFiles.length > 0 && activeProjectId === null` with all stems
  decoded, mixes the loaded `AudioBuffer`s through `OfflineAudioContext` to
  produce a mono 16-bit WAV `Blob`, feeds it through the existing
  `runStage1` (Phase 2), and exposes `{ phase, progress, previewSections,
  stage1, errorMessage }`. Phases: `idle | running | ready | failed |
  cancelled`. The `cancelled` phase is sticky so the effect doesn't
  immediately re-run another Stage 1 pass after the user clicks Save.
- `src/client/data/classify-repo.ts` — fetch wrappers for `POST
  /api/projects/:id/classify` and `POST
  /api/projects/:id/sections/:sectionId/fingerprint`. The fingerprint
  endpoint returns a discriminated result so the App can swallow 404s
  silently (Phase 4 may not be live in every dev DB).
- `src/client/components/DetectionBanner.tsx` — the thin progress strip
  that sits between draft-banner and the player while Stage 1 runs.
- `src/client/components/AutoClassifyToast.tsx` — first-time toast (Flow
  D), persisted via `paperstem.hints.auto-classify.seen`.
- `src/client/components/SectionLane.tsx` — extended to render auto
  sections with the Variant 2 "fresh" treatment: dashed slate border, faint
  slate tint, slate dot, optional confidence chip (e.g. `92%` or `low`).
  Tentative matches swap the slate border for warm yellow per
  `--auto-warn`.
- `src/client/components/SectionPopover.tsx` — title gets a small slate
  dot prefix on auto sections. All existing actions (Rename, Move, Delete)
  work unchanged; the server flips `source` to `manual` on any edit.
- `src/client/styles/app.css` — new tokens (`--auto-color`, `--auto-tint`,
  `--auto-tint-2`, `--auto-warn`, `--auto-warn-tint`) plus the new
  detection-banner, toast, and `.section-pill.fresh` styles.
- `src/client/App.tsx` — top-level wiring. Save-during-detection cancels
  the run; Save-after-detection commits the segments to `/classify` after
  the project is persisted and merges the response's auto fields
  (confidence/segment_type/tentative) into the local section state. The
  popover rename path, when an auto section gains a song, POSTs the cached
  chroma blob to the fingerprint endpoint (silent 404 fallback).

Test counts: **42 new tests added** (909 → **933 total**, all green).
`npx tsc --noEmit` is clean.

## Decisions and deviations

- **`Section` type extended with optional auto fields**
  (`confidence`, `segment_type`, `tentative`, `run_id`). The GET
  `/api/projects/:id/sections` route from the server doesn't yet return
  these fields — Phase 3's response shape does, so they're hydrated
  client-side after the classify POST. Once Phase 4's `sections` route
  starts returning the auto fields, this hydration becomes a server-driven
  refetch and the fields stop being optional.
- **Full-mix derivation goes through `OfflineAudioContext`** mixing every
  decoded `AudioBuffer` into a single mono channel rather than picking the
  first stem as a proxy. The render takes a few hundred ms for a typical
  4-minute practice and yields a more representative input for YAMNet
  (drums alone would mis-classify a music segment as silence; vocals alone
  would mis-classify drums-only intros). Output is encoded to a 16-bit PCM
  WAV blob in-line — keeps the existing `runStage1` decode path untouched.
- **`'cancelled'` phase is sticky.** First draft used `'idle'` post-cancel,
  but the effect's idle→running guard re-fired immediately because
  `enabled && allDecoded` was still true. Sticking on `'cancelled'` until
  the user leaves draft mode is the smallest reliable fix.
- **Toast localStorage key** is `paperstem.hints.auto-classify.seen` —
  matches the existing `paperstem.hints.zoom.seen` convention.

## Rough edges

- **No manual web smoke test was performed** in this session. The launcher
  requires `GMAIL_USER`/`GMAIL_APP_PASSWORD` to start, and YAMNet's
  `.tflite` model has to be fetched from the Paperstem origin —
  surfacing in a `npm run dev` smoke takes a clean environment. The Phase
  2 unit tests cover `runStage1` end-to-end against the same code path,
  and Phase 5's React tests cover the hook + components in isolation, but
  a browser-validated smoke is still desirable before flagging the feature
  on.
- **Auto sections from a server reload won't have `confidence` /
  `segment_type` / `tentative`** until the server's `GET /sections`
  endpoint returns those fields. Currently a freshly-loaded project
  re-renders auto sections as `source='auto'` (the slate dashed border
  still shows) but without the confidence chip — Phase 4 closes the gap.
- **The detection banner sits between the draft banner and the player.**
  The mockup placed it inside the DAW frame; keeping it as a sibling of
  the draft banner was cheaper and keeps both banners visible together.
  If we ever want them grouped, lift them into a single shell component.
- **Cancel doesn't abort the underlying YAMNet inference** — the
  in-flight `classify(audioData)` runs to completion in the worker;
  cancel just discards the result. For practical session lengths this is
  invisible (Stage 1 completes in seconds), but a 60-minute practice on a
  slow Chromebook would hold CPU briefly after Save.
