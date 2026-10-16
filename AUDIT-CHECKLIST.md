# What Subtitle Vet checks

Open **Vet → Vet settings → Checks** for the live checklist and complete spelling dictionary. Scope is the active media and selected subtitle track. Transcript mode reads Sub A. Local checks run without AI; no changes happen until Apply. Format issues are advisory, with Open in editor and Dismiss.

| Check | Parameters and coverage | Default |
|---|---|---|
| US → UK spelling | 153 exact dictionary mappings. Includes common −our, −re, −ise/−yse, doubled-l and vocabulary variants. Full Latin words with Unicode-aware boundaries; original capitalisation retained. Uses a −ise house style; −ize can also be valid UK usage. This is not a complete English spellchecker and does not convert UK → US. | On |
| Context-sensitive spellings | meter/meters, program/programs, license/licenses, check/checks. Correct form depends on meaning or grammar. Always reviewed individually, excluded from bulk Apply. | Off |
| Chinese punctuation | Off, listed Chinese punctuation only, or Unicode punctuation on lines containing Han text. Removal is proposed, never automatic. | Off |
| Exact team rules | Enabled literal replacements, including optional case sensitivity, whole words and case preservation. Blank replacement deletes text. Ambiguous comments remain advisory notes. | Enabled rules |
| Format audit | Enable once, then choose each check below. Reads current Cue rules for thresholds. Flags only; no automatic re-timing or re-segmentation. | Off |
| Timing | Nonnegative finite start/end, positive duration; minimum duration 0.6s (configurable) and maximum from Cue rules (initially 5.5s). | On within format audit |
| Overlaps | Flags cues starting before an earlier cue has ended, including nested overlaps. | On within format audit |
| Characters per line | Counts Unicode code points, excluding subtitle markup. Limit from Cue rules (initially 42). | On within format audit |
| Lines per cue | Maximum 2, configurable. | On within format audit |
| Reading speed | Visible non-space Unicode characters divided by duration. Limit from Cue rules (initially 17/s; language profiles can change this). | On within format audit |
| Whitespace | Leading/trailing spaces, repeated spaces and empty lines. | On within format audit |
| Empty text | No visible text after removing markup. | On within format audit |

Local spelling/punctuation checks protect URLs, email addresses, numeric expressions, common honorifics, contractions, hyphenated words and subtitle markup. Explicit team rules may intentionally replace protected content; markup itself remains protected. The spelling list cannot reliably recognise every proper noun or specialist term.

This is a project-cue audit. It does not certify raw SRT numbering/encoding, accessibility requirements, speaker identification, acoustic accuracy, missing speech, lip sync or frame-accurate alignment. Text-only AI cannot establish what was actually said in the audio.

## Natural-language AI Subtitle Check

Choose **AI Assistant → Subtitle Check**, select your provider/model and scope, and write ordinary instructions, for example:

> Use UK spelling and shorter sentences. Keep Dr. Lotus and product names unchanged. Flag mistranslations in Sub B against Sub A. Suggest each change on its cue and explain why.

The request includes the current Vet checklist, enabled team rules, contextual guidelines, advisory notes, cue thresholds, nearby text and overlapping text from the other subtitle track. Explicit instructions may override a linguistic preference; they cannot override source ownership or invent cue IDs/timecodes. The AI returns flags tied to issued cue IDs, with a full proposed replacement when appropriate. Results appear in editor hints and the Vet/AI panels, not only in a chat output box. Apply/Dismiss is individual; Undo restores an accepted change. Stale source/context/policy suggestions are blocked. Timing/layout issues that need structural edits should be flagged without inventing text fixes.

Freeform chat remains separate for ordinary text output. AI reviews require your configured provider key and can use multiple billed API requests. Review model suggestions against the footage and team requirements.
