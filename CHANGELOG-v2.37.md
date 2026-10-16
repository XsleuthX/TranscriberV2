# Transcriber v2.37 — Audit checklist and batch workflows

## Subtitle vetting

Vet settings now lists the exact scope of local and AI review, including all 153 US → UK dictionary mappings, −ise house style, capitalisation, protected content and the eight context-sensitive terms. Unicode word boundaries prevent replacements inside accented words, identifiers and alphanumeric tokens. This is a bounded dictionary, not a full English spellchecker.

The optional format audit offers individual checks for valid/short/long durations, nested overlaps, characters per line, lines per cue, reading speed, whitespace and empty cues. Current Cue rules supply length/duration/speed limits; minimum duration and line count are configurable. Findings are advisory and do not automatically change timecodes or layout. Settings persist in project JSON, with old projects remaining compatible. See [the complete audit checklist](AUDIT-CHECKLIST.md) for defaults, exclusions and examples.

AI Subtitle Check receives the checklist, enabled rules, nearby/paired text and natural-language editor instructions. Its prompt explicitly asks for cue-linked proposed edits with explanations and complete replacement text. It respects disabled checks unless the editor explicitly requests a linguistic override. Apply/Dismiss, word-spine synchronisation, stale protection and Undo remain available; freeform chat stays separate.

## Batch media and transcription

Multi-file import registers every asset immediately with unique IDs. Audio preparation is serialized, avoiding simultaneous upload-owner-cookie initialization, the server's 12-job ceiling and unbounded parallel decoders. The Media Pool shows queued/preparing/ready/failed status per source. The decoded cache evicts recoverable old audio above a 512 MiB budget while protecting active work; evicted sources may be prepared again when needed. Single-source size, codec, audio-track and storage limits still apply.

Transcribe → Batch transcribe media offers source checkboxes and a sequential queue. New imports are selected automatically. Existing transcripts require an explicit replacement option; unavailable sources require relinking. The queue captures its engine/model/language/dictionary settings, reports each result, continues after a failure, and can cancel current/pending work without erasing completed results. Pending sources changed by the user are skipped safely. Keep the tab open: queues are not resumed automatically after reload, while completed transcripts retain normal autosave/project export behavior. API requests use the configured provider and incur its normal charges.

Cloud transcription no longer references an undefined `mins` value after saving a successful result. Background results remain attached to their own source and do not force a different source's subtitle-track view.

## Story Suggestion

Source-linked sample cards remain normal editable Story cards. Overlapping quote ranges are deduplicated, and the final plan cannot repeat source cue content through different candidate IDs. Shortlist reduction has explicit round/progress limits. Cancellation, invalid JSON retry and stale source checks are covered. If the user edits the Story while AI is running, the proposal is not appended over those edits. Generated cards retain the brief/provider/model for reference. Existing Story work is preserved and additions remain one Undo action.

## Verification

Automated coverage includes 14 file-picker imports through mocked server extraction, serialized preparation, batch success/failure/cancellation and overwrite opt-in; dictionary boundaries and all format checks; natural-language policy delivery and cue-linked Apply/Undo; editable multi-source Story cards, concurrent Story edits, cancellation, malformed JSON retry, source linkage and project round trips. Providers are mocked. Full server/browser tests and production-container startup verification run in GitHub CI; model editorial quality and live Render sessions require separate real-world review.
