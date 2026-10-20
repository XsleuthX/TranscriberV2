# Transcriber v2.38

Transcript paragraph edits now update saved Sub A cue text as well as the word stream. Indexed and pinned/imported cues retain their identities, original time ranges and references; Sub B translations are preserved regardless of selected track. Insertions/deletions are distributed by source ownership. Existing line breaks/markup and unrelated cue-only wording are retained where mappings are safe, with a review notice for conflicts. Emptying a paragraph retains empty cues for review. Unchanged tokens keep timing; inserted/replaced words carry estimated timing. Undo/Redo covers both representations. Transcript editing uses an isolated contentEditable node.

UK spelling covers 1161 exact mappings including inflections from 165 allowed −ise verb families, plus −yse and other common spelling variants. This includes weaponize/weaponizes/weaponized/weaponizing/weaponization, with case preservation and the existing protected spans/context-sensitive review. Arbitrary suffix changes are excluded. The complete generated mapping list and shared AI checklist stay in sync. This remains a bounded house-style check; names and uncertain/context-dependent words require review.

Team Rules settings now explains literal replacements versus contextual AI guidelines and provides pasteable examples. Existing matching defaults are retained.

Verification includes paragraph-to-cue sync, source identity/timing/B preservation, insertion/deletion/CJK, markup/manual divergence, false-positive spelling guards, Team Rules parsing, browser commit/Undo/Redo while Sub B is selected, and existing regressions.
