# Transcriber v2.34 — Subtitle Vet

Subtitle Vet is integrated into Transcript and Subtitle modes, using the existing player, editing canvas, review hints, project backup and Undo.

## Use it

1. Open Transcript or Subtitle and click **Vet**. Local UK spelling checks run on Sub A in Transcript, or the selected track in Subtitle. No AI/transcription request is made.
2. Use **Previous issue / Next issue** to seek the player and inspect a highlighted suggestion. Apply, dismiss, or open the cue in the editor. **Issues only** temporarily replaces the editing canvas with pending suggestions while keeping the player visible.
3. **Vet settings → Checks** controls spelling and Chinese punctuation. Punctuation removal is off by default. Decimals, URLs, email addresses, common honorifics, contractions, hyphenated English terms and subtitle formatting are protected. Context-dependent spellings are optional and require individual review.
4. **Team rules** accepts explicit `old → new` or `Replace "old" with "new"` comments. Ambiguous notes remain visible for manual review. Rules support literal deletion, case sensitivity, whole words and case preservation. Coverage reports remaining matches across the selected media/track. Rules can be imported/exported as JSON.
5. **Apply shown…** previews the current category's non-contextual suggestions. Accepted changes form one Undo action. Overlapping, stale, shared-word-range or invalid empty-cue changes are left for review.
6. **History** records applied changes and dismissals, can restore dismissed suggestions, and downloads a JSON report. Rules, notes, decisions and history are included in autosave and project JSON; older project files remain compatible.

Applied Sub A text updates the Transcript word stream, with changed word timing marked estimated; cue identities and cue in/out times stay pinned. Sub B is independent. Source-linked Story text follows corrected cues; manually authored card text remains authored. Source clip and Multi-Timeline references are retained. UTF-8 and BOM-tagged UTF-16 subtitle imports are supported.

The original Subtitle Vet dashboard, duplicate file handling and separate session management were not added. Reviews use the existing Transcriber interface. Team rules are saved in the local project; this is not live collaboration between reviewers.

## Verification

Production build and 51 focused unit tests passed, including six new tests for encoding, protected punctuation, exact rule parsing, stale/conflicting changes, A/B isolation, Transcript synchronisation, references, project JSON and Undo/Redo. The new production-frontend browser suite covers inline preview, bulk preview/Undo, Dual Sub, word updates, punctuation protection, rule coverage/manual notes, dismissal persistence, report download, media isolation, and absence of AI/transcription network requests. Existing browser suites cover transcription, repair, AI review, Story deletion/review and project/assembly workflows.

Provider responses are mocked in local browser regressions. Local tests use route fixtures for the production frontend because loopback traffic is restricted in this Windows sandbox. Live signed-in Render validation and CI execution are reported separately; no paid AI operations are needed for local vetting.

The hosting authentication test now creates its own static HTML fixture, so `npm test` works in a fresh checkout before a frontend build. This fixes the previous GitHub CI failure without changing production authentication.
