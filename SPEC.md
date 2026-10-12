# Transcriber — Production Rebuild Specification

**Version:** 1.0 draft
**Status:** for review
**Supersedes:** `Transcriber_CoWork2_Collab` (vanilla JS build)

---

## 1. Product summary

A collaborative web application for turning video and audio into corrected transcripts,
broadcast-quality subtitles, and edited video assemblies.

Five workspaces over one shared document:

| Workspace | Owns | Primary user activity |
|---|---|---|
| **Transcript** | word stream, speakers | reading, correcting, aligning |
| **Subtitle** | cues (segmentation) | timing, line-breaking, translating |
| **Timeline** | clips on one asset | selecting segments from a single source |
| **Story** | rows, cards | assembling a script from transcript + clips |
| **Multi-Timeline** | multi-track EDL | editing the assembly across many sources |

### 1.1 Design principles

1. **One source of truth.** Words are canonical. Cues, clips and cards reference words;
   they never own copies of them.
2. **Derived is re-derivable.** Any generated artefact (segmentation, an assembly) can be
   regenerated without destroying manual work.
3. **References have defined failure modes.** Every cross-mode reference declares what
   happens when its target moves or disappears. This is enforced in one shared integrity
   layer, not per-feature repair code.
4. **Progressive disclosure.** New users land in Transcript. Other workspaces are entered
   deliberately, not toggled into.
5. **Text is the subject.** Reading contrast, measure and line-height take priority over
   chrome aesthetics.

---

## 2. Architecture

### 2.1 Stack

**Frontend** — TypeScript, React, Vite.
Four layers, strictly ordered, no upward imports:

```
domain/     framework-free, fully tested: timecode, SRT/VTT, cue ops,
            segmentation rules, EDL model, integrity rules
state/      Yjs documents (collaborative) + Zustand (local UI state)
components/ presentational, virtualized lists, canvas timelines
app/        routing, workspace shells, providers
```

**Backend** — Python, FastAPI.
Postgres (relational state), Redis + Arq (job queue), S3/R2 (media, renders, exports).
CPU worker pool for ffmpeg. Optional GPU worker for local WhisperX.

**Auth** — managed provider (Clerk or Supabase Auth). Not hand-rolled.

**Collaboration** — Yjs CRDT. Replaces the full-state broadcast entirely.

### 2.2 Access tiers

| Tier | Capability |
|---|---|
| Anonymous (URL) | browse, one trial project, no persistence beyond the browser session |
| Account | save, share, collaborate, store encrypted provider credentials |

Anonymous work is promotable: signing up migrates the trial project into the account.

### 2.3 Deployment

- API: stateless containers behind a load balancer. No in-process job state.
- Workers: separate pool, horizontally scalable, jobs durable in Redis.
- Media: never served from local disk. Signed URLs only, short TTL.
- Local WhisperX worker: optional, self-hosted, registered as a provider (§4.3).

---

## 3. Data model

### 3.1 Core entities

```
Organization  id, name, plan
User          id, org_id, email, display_name, color
Project       id, org_id, name, created_by, created_at
Asset         id, project_id, source_type, source_ref, duration,
              fps, storage_key, proxy_url, proxy_expires_at
```

`source_type` ∈ `local | youtube | drive | iconik`.
`source_ref` holds the provider-native identifier (Iconik asset id, Drive file id, …).

### 3.2 The word stream

The spine of the entire application.

```
Word          id, asset_id, index, start, end, text,
              speaker_id, confidence, edited, is_non_speech
Speaker       id, asset_id, label, display_name, color
```

- `index` is dense and stable; it is the anchor everything else references.
- `edited` marks user correction, protecting the word from re-transcription overwrite.
- `speaker_id` is nullable. **A project with no diarization is a valid project.**

### 3.3 References into the stream

```
Cue           id, asset_id, track, word_start, word_end,
              text_override, line_breaks, detached
Clip          id, project_id, asset_id, source_in, source_out,
              cue_start_id, cue_end_id
StoryCard     id, row_id, kind, title, body, label,
              cue_refs[], alt_cue_refs{A,B}, clip_id,
              source_in, source_out
StoryRow      id, project_id, index, notes, status,
              is_section, section_label
```

Cue timing is **derived** from `word_start`/`word_end` unless `detached` is set.

### 3.4 Multi-Timeline EDL

Retained close to the existing schema, which is sound:

```
Timeline      id, project_id, fps, duration, marks_in, marks_out
Track         id, timeline_id, kind, name, index, gain, muted,
              solo, locked, burn, language, ducking
TimelineClip  id, timeline_id, track_id, kind, asset_id,
              source_in, source_out, project_in, project_out,
              subtitle_text, overlay_text, overlay_style, label, color
```

`kind` ∈ `video | audio | subtitle | overlay`.

### 3.5 Jobs and usage

```
Job           id, project_id, type, status, progress, phase,
              payload, result, error, created_at, finished_at
UsageEvent    id, org_id, kind, quantity, provider, occurred_at
```

`Job` is a database row, not a process dict. Survives restart and is queryable.
`UsageEvent` exists even under BYOK — for user-facing reporting, not billing.

### 3.6 Credentials

```
Credential    id, user_id, provider, ciphertext, key_version,
              last_validated_at, scope
```

Envelope-encrypted, per-user data key. Never returned to the client in any form.
`provider` ∈ `openai | groq | deepseek | iconik | google`.

---

## 4. Provider layer

### 4.1 Transcription

One interface, several implementations:

```
transcribe(audio, language, opts) -> { words[], segments[], language }
```

| Provider | Word timestamps | Diarization | File cap | Notes |
|---|---|---|---|---|
| `groq/whisper-large-v3` | yes | no | 25 MB | default; ~9x cheaper |
| `openai/whisper-1` | yes | no | 25 MB | fallback |
| `openai/gpt-transcribe` | **no** | no | 25 MB | unusable — no word timing |
| `local/whisperx` | yes | **yes** | none | self-hosted, needs GPU |

`whisper-1` is mandatory over the newer OpenAI models: they do not return
`verbose_json` or word-level timestamps, which the entire app depends on.

### 4.2 The chunking pipeline

Mandatory, not an optimization. The 25 MB ceiling is file size, not duration.

```
1. extract   ffmpeg -> mono, 16 kHz, compressed
2. measure   if under cap -> single request
3. split     silence-aware boundaries, ~600 s target, 2 s overlap
4. dispatch  parallel, bounded by provider rate limit
5. stitch    offset timestamps, dedupe overlap by word match
6. persist   write Word rows, index densely
```

Progress is reported per chunk. Partial failure retries that chunk only.

### 4.3 Speakers

Diarization is **optional metadata**, produced by a pluggable speaker provider.

- `local/whisperx` — WhisperX + pyannote, one pass, words and speakers together.
  Self-hosted; realistically GPU-bound. This is the tuning and beta pathway.
- `none` — the public BYOK default. All words share one unlabelled speaker.
  Transcript Mode renders as continuous prose with no speaker rail.
- Future: a diarization-capable provider under the user's own key.

The UI must never assume a speaker roster exists.

### 4.4 Translation and language AI

Not Whisper. Whisper's translation endpoint targets English only.

| Task | Provider |
|---|---|
| ZH ↔ EN translation | OpenAI chat |
| other language pairs | DeepSeek |
| AI Check (semantic, anchor drift) | OpenAI chat |
| dictionary-guided translation | either, dictionary injected as context |

Key-entry UI must state plainly that one OpenAI key serves transcription,
translation and checking — three endpoints, three prices.

### 4.5 Iconik

Audio-only extraction from preview proxies. Never caches full video for transcription.

```
ffmpeg -i <signed_proxy_url> -vn -ac 1 -ar 16000 -c:a libopus -b:a 16k out.opus
```

- Signed URLs expire: refresh on expiry for both extraction and playback.
- Per-user Iconik credentials, encrypted (§3.6).
- **Exemption:** Multi-Timeline render needs real video bytes. Iconik sources are
  transcribable without caching but not renderable without it.

---

## 5. API surface

Replaces ~50 ad-hoc endpoints with a resource-shaped API.

```
POST   /projects                             create
GET    /projects/:id                          read
POST   /projects/:id/assets                   attach source (any type)
GET    /assets/:id/media-url                  signed, short TTL

POST   /assets/:id/transcribe                 -> job
POST   /assets/:id/align                      -> job   (text -> word stream)
POST   /assets/:id/diarize                    -> job   (optional)

GET    /jobs/:id                              status, progress, phase
POST   /jobs/:id/cancel

GET    /assets/:id/words                      paginated
PATCH  /assets/:id/words                      corrections
GET    /assets/:id/speakers
PATCH  /assets/:id/speakers                   rename, merge, reassign

POST   /assets/:id/cues/segment               (re)segment from rules
GET    /assets/:id/cues
PATCH  /cues/:id
POST   /assets/:id/cues/translate             -> job

GET    /projects/:id/timeline
PATCH  /projects/:id/timeline
POST   /projects/:id/timeline/render          -> job
POST   /projects/:id/story/export-to-timeline

GET    /projects/:id/export/:format           srt | vtt | fcpxml | otio | docx
POST   /projects/:id/publish/youtube          -> job

POST   /credentials                           store, encrypted
POST   /credentials/:provider/validate
DELETE /credentials/:provider

WS     /projects/:id/collab                   Yjs sync + awareness
```

All job-producing endpoints return a `Job` row. No endpoint blocks on ffmpeg or a
transcription provider.

---

## 6. Workspace specifications

### 6.1 Transcript Mode

**Owns:** word stream, speaker roster.
**Reads as:** a document. Paragraphs grouped by speaker turn, not by cue.

Layout: wide centre column at 60–75 character measure, high contrast, generous
line-height. Speaker rail on the left when a roster exists; absent otherwise.
Docked player, small, top-right or bottom. No timecode pills in the text flow.

Operations:
- correct a word — text changes, timing survives, `edited` set
- rename / merge speakers, reassign a turn
- mark non-speech regions
- full-text search and replace
- **Align-To-Audio**: paste existing text, DP edit-distance align against the word
  stream, write corrected words. No forced-alignment model, no GPU.

Playback highlights the active word. Click any word to seek.

**Virtualization is mandatory.** A 90-minute asset is tens of thousands of words.

### 6.2 Subtitle Mode

**Owns:** cues — segmentation over the words.

Auto-segmentation rules:

```
max_chars_per_line, max_lines_per_cue,
min_duration, max_duration,
target_cps (reading speed),
prefer_breaks_at: punctuation > silence > clause,
never_split: mid-word
```

Re-segmentation is **non-destructive**: overrides are preserved where the underlying
word range is unchanged, and the user is warned where it is not.

Manual editing — carried over from the current build, which is good:
frame-stepping arrows, draggable timecode pills, split, merge, ripple shift,
drag-to-reorder.

Live validation: CPS warnings, overlap detection, minimum-gap enforcement.

Dual A/B: B is the translation. Timing follows A by default, detachable.

Export: SRT, VTT.

**Open decision — text divergence.** Proposal: a cue edited directly keeps a
`text_override` while remaining word-anchored for *timing*, and is visibly marked
detached. Alternative: force all text edits back into Transcript Mode — cleaner, more
annoying. Not yet settled.

### 6.3 Timeline Mode

**Owns:** clips on a **single** asset.

The differentiator: selections snap to **cue and word boundaries**. Dragging across
three cues in the transcript produces in/out points landing exactly on speech
boundaries. No general-purpose NLE offers this.

Operations: mark in/out, drag from transcript selection, nudge by frame, snap toggle,
preview, export selection.

Render: existing ffmpeg path, hosted properly — durable queue, CPU worker pool,
output to object storage, hash-keyed cache retained.

### 6.4 Story Mode

**Owns:** rows and cards.

A card references a cue range and optionally a clip, and carries its own body text,
label, and source attribution. The existing `cue_refs` / `alt_cue_refs` schema is
correct and is retained.

Operations: drag cards between rows, section headers, per-row notes and status,
card labels (shot type, caption type), Google Docs export.

**Push to Multi-Timeline**: bulk-builds timeline clips from the assembly, stamping
full source identity, routing caption cards to overlay and subtitle tracks.

The reconciler survives but shrinks substantially. With words as the spine, most cue
edits no longer orphan anything. It handles only genuine structural cases: a card's
range split across non-adjacent runs, or referenced words deleted outright.

### 6.5 Multi-Timeline Mode

**Owns:** the multi-track EDL. **Multi-source by design** — this is where Story blocks
from many assets are assembled.

Entered primarily by pushing from Story Mode, not built from scratch.

Retained from the current build: V1/V2 video, A1–A4 audio, subtitle and overlay
tracks; razor, trim, slip, slide, ripple delete; marquee selection; snapping;
in/out marks; undo stack.

Render: multi-source V1, subtitle burn-in, drawtext overlays, audio mixing with
per-track gain and ducking, hash-keyed cache. Server-side, queued, resumable.

**Clip blocks render to canvas, not DOM.**

**Iconik constraint:** multi-source render requires cached video bytes for every
contributing asset (§4.5). The UI must state this honestly before a render is queued
rather than failing mid-job.

---

## 7. UI shell

One persistent shell; weight distribution shifts per workspace.

```
┌──────────────────────────────────────────────────────────┐
│ project · workspace switcher · [tools] · avatars · export│
├────────┬────────────────────────────────────┬────────────┤
│ media  │                                    │ inspector  │
│ pool   │          work surface              │ / AI panel │
│ rail   │                                    │            │
├────────┴────────────────────────────────────┴────────────┤
│ timeline strip (Timeline / Multi-Timeline only)          │
└──────────────────────────────────────────────────────────┘
```

Per-workspace emphasis:

| Workspace | Work surface | Player |
|---|---|---|
| Transcript | text, dominant | docked small |
| Subtitle | cue list, dominant | docked medium, captions overlaid |
| Timeline | player, dominant | primary |
| Story | card grid | docked small |
| Multi-Timeline | player + tracks | primary |

Taken from the reference mock: shell grammar, persistent rails, avatar cluster,
AI assistant as a **docked panel** rather than a modal.

Rejected from the mock: viewer-dominant proportions in text workspaces, saturated
gradient behind reading surfaces, low-contrast body text.

### 7.1 Design system

Built before any workspace migration.

- CSS from zero. Nothing ported. (Current: 1,080 `!important` in 7,951 lines.)
- Tailwind or CSS Modules; tokens for colour, spacing, type scale, radius, elevation.
- **One documented z-index scale**, values under 100. (Current maximum: 2147483000.)
- Two contrast contexts: *chrome* (dark, low contrast permitted) and
  *document* (near-print contrast, mandatory in Transcript and Subtitle).
- Dark and light themes from day one.
- All feedback through inline UI. Zero `alert()` / `confirm()`. (Current: 161.)

---

## 8. Collaboration

Yjs, one document per project. Shared types:

```
Y.Array   words (per asset), cues, story rows, timeline clips
Y.Map     speakers, tracks, project settings
Awareness playhead, caret, selection, active workspace, follow target
```

This deletes, wholesale: `buildShareSessionState`, `hashSessionState`, the revision
counter, the 2-second polling fallback, the deferred-remote-state buffer, and the
suppress-broadcast-while-focused workaround. The caret-collapse bug is structurally
impossible under a CRDT.

Persistence: Yjs updates appended server-side, snapshotted to Postgres periodically.
Version history from snapshots — not 40 full-document JSON copies per session.

Presence, comments and per-cue locks rebuild on Awareness. Locks become advisory
(showing intent) rather than load-bearing for correctness.

---

## 9. Security

Mandatory before any public account exists:

1. **Rotate everything** currently in the repo — Google OAuth client secret, the
   YouTube access and refresh tokens, any Groq key. Purge from git history.
2. **Tenancy on every route.** Authorization checked against `org_id`, not resource id
   possession. Session ids are not credentials.
3. **BYOK handling.** Two modes: session-only (memory, never persisted) and saved
   (envelope-encrypted, per-user key). Never localStorage. Never returned to client.
   Redacted from logs and error payloads. Validated on entry.
4. **No `innerHTML` with interpolated data.** (Current: 197 sites.)
5. **Signed, short-TTL media URLs.** No `FileResponse` from local disk.
6. **Per-user OAuth** for YouTube and Drive. Note: `youtube.upload` is a sensitive
   scope requiring Google app verification — start that process early, it has a
   calendar cost.
7. **Rate limiting** on job-producing endpoints even under BYOK, to protect worker
   capacity.

---

## 10. Build order

| Phase | Deliverable | Gate |
|---|---|---|
| **P0** | Secrets rotated, env config, history purged | no live credentials anywhere |
| **P1** | `domain/` extracted and tested: timecode, SRT/VTT, cue ops, segmentation, EDL, integrity rules | test coverage on all cue and timecode maths |
| **P2** | Backend: Postgres, auth, tenancy, Arq queue, object storage, provider layer, chunking pipeline | a transcription job survives an API restart |
| **P3** | Design system + app shell + workspace switcher | tokens documented, z-index scale under 100 |
| **P4** | Transcript Mode (incl. Align-To-Audio) | virtualized, 90-min asset scrolls at 60fps |
| **P5** | Subtitle Mode (incl. Dual A/B, translation, export) | re-segmentation preserves overrides |
| **P6** | Timeline Mode | cue-boundary snapping works |
| **P7** | Story Mode + push-to-Multi-Timeline | reconciler cases covered by tests |
| **P8** | Multi-Timeline + multi-source render | canvas clips, queued render, resumable |
| **P9** | Yjs collaboration across all workspaces | two-editor concurrent edit loses nothing |
| **P10** | Iconik integration | proxy audio extraction, credential encryption |

P1 is the phase most often skipped and most regretted. Extracting and testing the
domain first means the React build assembles proven parts instead of rediscovering
why splitting a cue adjusts the following cue's start by exactly one frame.

Old build stays running behind a feature flag through P4–P8.

---

## 11. Open items

1. **Cue text divergence** (§6.2) — `text_override` with a detached marker, or force
   text edits upstream into Transcript Mode?
2. **Anonymous trial scope** — one project, but with what limits on asset duration and
   job count, given anonymous users have no BYOK key of their own?
3. **Diarization for public users** — ship without speakers indefinitely, run a hosted
   WhisperX worker, or add a paid provider under the user's key?
4. **Local Whisper exposure** — dev/tuning pathway only, or a self-host option offered
   to users who run their own instance?
5. **FCPXML / OTIO export** — listed as pending in the old build's patch notes.
   In v1 or deferred?
