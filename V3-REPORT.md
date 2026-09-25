# V3 implementation report

Telegram Chat Analyzer — multimodal analysis, AI routing, sensitive media,
cost control and UX. Built incrementally on V2; nothing was rewritten from
scratch.

Verified at the end of the work: **514 unit tests**, **20/20 end-to-end**
(desktop + mobile), clean typecheck, clean lint, clean production build.

---

## 1. What the audit found before any change

| Area | State found | Action |
|---|---|---|
| Model configuration | Already central, but **one** model for every call | Replaced with three tiers + a routing table |
| `NormalizedMessage` | Close to the spec's `ConversationEvent` | Extended, not rewritten |
| `MediaAttachment.analysis` | A slot the parser set to `null` and nothing ever filled | Removed (dead) |
| `src/lib/media/types.ts` | A processor interface with no implementation | Removed (dead) |
| `selectMedia`, `relevanceScore` | Superseded mid-V3 by the planner and the new scorer | Removed (dead, and a live hazard — two relevance scorers) |
| Flat `costMicros` | Priced a Haiku call at Opus rates | Removed in favour of per-tier pricing |
| Media ingestion | **Absent** — only `result.json` was ever read | Built |
| Statistics | Already fully deterministic | Unchanged (already Tier 0) |
| Internal message IDs in UI/PDF | Already stripped in earlier V3 work | Kept, with tests |
| Dynamics page | Already deleted | — |
| PDF export | Already restored | Extended with a media section |
| Size tiers | 30k / 60k / 120k | Changed to 60k / 150k / 300k |

---

## 2. Architecture

### Model routing (§3, §13–18)

`src/lib/ai/routing.ts` maps every AI task to one of three tiers. Tier 0 is
represented by *absence*: a task code can do has no entry, which is why the
statistics engine appears nowhere in the table.

```
cheap     image moderation and description, screenshot/meme detection,
          relevance filtering, language detection, per-chunk extraction
standard  communication, interaction, topics, emotional language, conflict,
          timeline, profiles, synthesis   ← the default for real analysis
deep      advice, and escalation when a standard result came back
          low-confidence, self-contradictory or thin
```

No model id exists outside `config.ts`, and a test greps the source tree to
keep it that way. Tiers map to models through
`ANTHROPIC_MODEL_CHEAP/_STANDARD/_DEEP`, with per-task overrides in
`ANTHROPIC_TASK_MODELS`.

**Escalation is gated on entitlement**, not on how interesting the
conversation looks — a thin result stays thin rather than quietly spending a
deep-tier call nobody bought.

V2's `ANTHROPIC_MODEL` is still honoured, but **only as the standard tier**.
Treating it as all three would have put image classification back on Opus,
which is the cost problem the tiering exists to fix.

### Unified event model (§9)

`src/lib/model/event.ts`. The parser keeps describing only what the export
said; everything learned afterwards — classification, description, extracted
text, transcript, why something was not read — lives on `ConversationEvent`.
A parsed conversation can be re-analysed under different rules without being
re-parsed.

There is **no `VIDEO` event type**. Video messages become `OTHER_MEDIA`: they
are counted, shown and surrounded by their own text, with nowhere to be
analysed.

`renderEventContent` / `renderMediaParts` is the single place media becomes
words. A transcript reads as speech; a description is labelled as a
description so the model does not quote it back as something a participant
wrote.

### The sensitive media gateway (§5, §7, §8)

`src/lib/media/gateway.ts`. One function, and every image goes through it:

```
validate → consent → moderate → cleared? → relevant? → afford? → describe
```

Each step can only reduce what happens next. There is no branch that
re-admits content an earlier step withheld.

- **Fails closed by default.** With an empty environment there is no
  moderation provider, so no image is described, so no image bytes leave the
  machine. An unreadable verdict, a provider error, a timeout and a verdict
  below the confidence threshold all land where an explicit image lands:
  metadata only. "Probably fine" is not fine.
- **A hard stop is final.** Suspected illegal content ignores the confidence
  threshold, is never re-classified through another model as a workaround
  (§7 names that specifically), and halts the owner's remaining media.
- **Consent is checked before the file is read**, ahead of relevance and
  budget, so no path can reach a provider by first deciding an image was
  cheap enough.
- **§8 is structural.** "look what I bought" plus an explicit photograph
  reaches the analysis as those words plus the bare fact that an image was
  attached. There is a test for that exact case.

Classifications never surface. `publicMediaLabel` is what a reader sees, and
a test walks every classification asserting none of their names can appear
in a label, the rendered section, or the PDF.

### Media ingestion (§2 gap, §34)

Server-authoritative in both directions:

1. The client indexes the picked export folder and **declares what exists** —
   metadata only, no bytes.
2. The server plans from that declaration and answers with the references it
   wants.
3. The client uploads **exactly those**.

The filter doing most of the work is the **read window**: an attachment on a
message outside the budgeted subset cannot influence the result, so asking
for it would mean opening someone's photograph to look at it in a context
nothing reads.

Each planned row is written *before* any bytes exist, and the row **is** the
permission to upload that file. An upload naming a reference with no row is
refused.

- Storage keys are **derived, never supplied**: job id + reference, hashed.
  A client cannot name the file it writes, so `../` in an export is just
  characters that change a hash.
- Owner- and job-scoped paths, outside `public/`, **no route serves them**.
- Uploads are **sniffed, not trusted** — the case being defended is an mp4
  renamed so it would reach a vision provider as an image.
- Bytes are **deleted when the stage finishes**, in a `finally` block so an
  abort does not leave them behind.

---

## 3. Providers

| Purpose | Implementation | Configuration | Default |
|---|---|---|---|
| Transcription | AssemblyAI | `ASSEMBLYAI_API_KEY` | **off** |
| Moderation | dedicated HTTP service, or Claude | `MODERATION_PROVIDER=http\|claude` | **off** |
| Vision | Claude, cheap tier | `IMAGE_ANALYSIS_PROVIDER=claude` | **off** |

**AssemblyAI** is the only manual setup the spec asked for. Every failure
mode in §4 is an *outcome* rather than an exception — unsupported container,
empty file, too short, too long, upload failure, job error, poll timeout,
rate limit with exponential backoff. `transcribe` never throws, so no caller
can forget that a failed transcription must leave the analysis running.

**Moderation is deliberately not defaulted to Claude.** Something must look
at an image to know it is explicit, but §6 asks for moderation to be a
separate inexpensive service — so `http` points at a dedicated endpoint with
a documented request/response contract and keeps the safety decision away
from the analysis provider. `claude` exists for operators who would rather
not run one, and `.env.example` states plainly what choosing it means.
Either way, **only an `ORDINARY` verdict reaches the description step**.

---

## 4. Files

**New (24)**

```
src/lib/ai/routing.ts                     tier table, escalation, per-tier cost
src/lib/ai/media-context.ts               folds media findings into excerpts
src/lib/model/event.ts                    ConversationEvent, transcript, EventMedia
src/lib/media/classification.ts           internal labels + public labels
src/lib/media/gateway.ts                  the decision flow
src/lib/media/providers/types.ts          provider contracts
src/lib/media/providers/claude.ts         moderation + vision + document read
src/lib/media/providers/http-moderation.ts vendor-neutral moderation adapter
src/lib/media/providers/assemblyai.ts     transcription
src/lib/media/providers/registry.ts       configuration → providers
src/lib/bench/scenarios.ts                12 invented evaluation scenarios
src/lib/bench/strategies.ts               4 routing strategies + cost model
src/lib/client/export-files.ts            folder indexing, declaration
src/server/media/plan.ts                  what to ask for
src/server/media/process.ts               the media stage
src/server/media/relevance.ts             text-based relevance scoring
src/server/media/storage.ts               private, derived-key storage
src/server/media/sniff.ts                 magic-number type check
src/server/repositories/media.ts          the media plan + findings
src/server/analysis/cache.ts              reusable results
src/server/analysis/process-media-summary.ts  findings → report section
src/app/api/media/upload/route.ts         the upload gate
src/components/v2/result/MediaFindings.tsx attachments in the timeline
scripts/benchmark.ts                      the comparison
```

**Deleted (3)**: `src/lib/media/types.ts`, `MediaAnalysis`/`analysis` slot,
`selectMedia`+`relevanceScore`.

**New test files (9)**: `routing`, `events`, `gateway`, `transcription`,
`ingestion`, `media-pipeline`, `media-report`, `media-e2e`, `cache`,
`subset`, `bench`.

---

## 5. Database

Migration `0003_media_and_observability`:

- `media_assets` — the plan and what became of it. Unique on
  `(job_id, reference)`, so planning is idempotent.
- `analysis_cache` — reusable results, owner-scoped.
- `usage_records` gains `task`, `tier`, `provider`, `cached_input_tokens`,
  `latency_ms`, `retries`, `cached`, `escalated`, `ok`, `media_kind`.

---

## 6. Cost control

**Analysis cache.** The key hashes everything that would change the answer:
conversation digest, product, module set, language, media findings, size
tier, all three tier models, and a prompt version. Miss one out and the
cache serves a stale result with no way to notice, so it is built explicitly
and a test enumerates each input. Module order does not count.

The prompt version is a **manual number, not a hash of the prompt text** —
hashing would invalidate every cached analysis on a typo fix in a comment.

The lookup happens **after** media, because a transcript changes what the
model reads. A hit hands the credit back. `?regenerate=1` skips it.

**Observability.** Every call records tier, provider, tokens, cache reads,
latency, retries, escalation and success, priced at the tier that ran.
`spendByTier` rolls it up — cost concentrated in the standard tier for work
the cheap tier could have done shows up there. Latency is a median so one
slow call does not make its tier look slow.

**Benchmark** (`npm run bench`). Four strategies over twelve invented
scenarios. Deterministic, spends nothing, priced from this deployment's own
rates. Running it surfaced something worth knowing:

```
sonnet-only                       40.0%
cheap-then-sonnet                 39.5%
cheap-sonnet-selective-opus       54.1%   ← what V3 ships
opus-heavy                       100.0%
```

At these conversation sizes **the cheap tier saves very little** — eight
media calls beside ninety-six module calls. The saving is almost entirely
Sonnet-over-Opus; the cheap tier earns its keep on media-heavy conversations
specifically. There is a test for that so the claim stays true or fails
loudly.

Quality is **not scored**, on purpose. A benchmark printing a quality number
derived from token counts would be inventing its most important column. Each
scenario carries written expectations to grade real output against.

---

## 7. Consent

The V2 architecture is preserved. Three changes:

**Consent is now per content type, intersected across participants.** If one
person's consent covers text and images and another's covers text alone,
only text is analysed. Agreeing to have words read is not agreeing to have
photographs opened, and nobody can agree on another's behalf. No grants at
all means nothing is consented, not everything.

**The document stopped promising something untrue.** Version 1.0 said
"photos, voice messages and videos are counted but never opened or sent".
Section 5 is now written per data type: with images in scope it describes
the safety check, the relevance gate and the fact that sensitive images are
not sent; with audio in scope it says voice messages are transcribed and may
be quoted. When a type is out of scope, the original promise stands
unchanged. Video keeps it unconditionally.

**An older consent cannot authorise media it was never told about.** The
document is 1.1, and a consent recorded under an earlier version is filtered
down to text regardless of its stored data types.

---

## 8. Security

- API keys stay server-side; nothing is prefixed `NEXT_PUBLIC_`. No provider
  error text or key reaches a user, a prompt, or a stored field.
- Uploaded media is never publicly reachable: no route, outside `public/`,
  deleted after use.
- Upload authorisation is the media plan, and the plan is owner-scoped.
  Another owner's job id is a 404.
- **Prompt injection through media** is now tested. A transcript and a
  screenshot's extracted text each carrying a fence-closing tag come out
  neutralised — both land in the excerpt's text field, which
  `sanitiseForPrompt` cleans and `fenceContent` wraps. The vision and
  document prompts say text inside a file is content and never a command;
  the moderation prompt says not to describe what it refuses.
- Rate limiting covers the upload route.
- No internal identifier, classification, provider name or debug field
  appears in the UI or the PDF.

---

## 9. Environment variables added

```
ANTHROPIC_MODEL_CHEAP / _STANDARD / _DEEP     tier → model
ANTHROPIC_TASK_MODELS                          per-task override
ANTHROPIC_EFFORT_CHEAP                         cheap-tier effort
ANTHROPIC_PRICE_CHEAP_* / _STANDARD_*          per-tier accounting
ASSEMBLYAI_API_KEY                             transcription (the only required setup)
TRANSCRIPTION_*                                polling, retries, duration bounds
MODERATION_PROVIDER / _BASE_URL / _API_KEY     image safety
IMAGE_ANALYSIS_PROVIDER / _MODEL / _API_KEY    vision
MEDIA_STORAGE_DIR                              private media location
NEXT_PUBLIC_MEDIA_ENABLED                      offer the Multimodal product
NEXT_PUBLIC_SIZE_*_CHARS                       60k / 150k / 300k
```

---

## 10. Commands

```
npm run dev                  development
npm run verify               typecheck + lint + test + build
npm run test                 514 unit tests
npm run bench                routing cost comparison (spends nothing)
npm run fixture              regenerate the synthetic export

PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e
```

The Playwright override is needed where the image's bundled browsers are
older than the installed Playwright: it asks for a `chrome-headless-shell`
build that is not present, while the full Chromium beside it works.

---

## 11. Limitations, stated plainly

1. **No moderation provider is configured by default, so no image is
   described out of the box.** This is the intended behaviour, not a gap: the
   alternative default is sending private photographs somewhere. An operator
   turns it on knowingly. Until they do, a multimodal analysis is a text
   analysis plus a list of attachments it did not open — which is why
   `NEXT_PUBLIC_MEDIA_ENABLED` gates the product being sold at all.

2. **The moderation/description tension is real and unresolved by
   architecture alone.** Something must look at an image to classify it. The
   `http` provider keeps that away from the analysis provider; the `claude`
   provider does not, and says so. There is no third option that classifies
   an image without looking at it.

3. **Quality is not measured.** The benchmark compares cost, deterministically.
   Whether cheap-then-Sonnet actually matches Sonnet-only on sarcasm or
   multilingual conversations needs a graded run against the written
   expectations — real money, and a judgement call the scenarios set up but do
   not make.

4. **The escalation rate in the benchmark (15%) is an assumption**, not a
   measurement. It is a parameter precisely so it can be replaced with the
   figure `usage_records` now collects in production.

5. **No live provider test.** The media end-to-end test fakes AssemblyAI and
   the moderation/vision providers. The HTTP contract for `http` moderation is
   tested at the mapping layer only — the first real deployment against a
   vendor shim may need adjustment.

6. **Folder upload is picker-only.** Dragging a folder onto the dropzone still
   reads `result.json` alone; directory drag-and-drop uses a different
   browser API that is not wired up.

7. **Relevance is heuristic.** Phrase lists in three languages plus
   structural signals. A conversation that refers to images in a way none of
   the phrases catch will under-read its screenshots. The failure mode is
   cheapness, not wrongness.

8. **No video analysis**, by instruction. Video messages are parsed, counted
   and displayed; they validate as unsupported before any limit is consulted.

9. **The `mediaUsage` estimate is recorded, not shown.** Job creation returns
   it and logs it; no screen displays it yet.
