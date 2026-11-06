# v2.42 — Visible collaboration, comments and actions

All five workspaces now have visible collaboration controls:

- A persistent participant strip with saved project colours, current workspace
  labels, locate-participant navigation and a Live selections toggle.
- Source/track-scoped Transcript and Subtitle text selections/carets, selected
  caption rows and words, Story cards/body/title/notes/linked-cue activity,
  source Timeline clip/range/playhead indicators and Multi-Timeline selections.
- Portal overlays measured against the local rendered surface, accounting for
  zoom, scrolling, wrapping and virtualized rows. Carets are suppressed when the
  remote text differs; the coloured draft badge opens a live draft/caret preview.
- Presence refreshes separately from document synchronization, so focused text
  editors and conflict review do not block awareness. Hidden selections clear,
  and returning to the app refreshes presence and comments immediately.
- Floating anchored comment threads with quoted text, pins, replies, @mentions,
  action owners, a For me inbox, Open/Resolved/This view/All filters and
  Resolve/Reopen. Changed/removed targets retain comments with a warning.
- Comments use independent append operations rather than document replacement.
  Concurrent replies survive, retries are idempotent, and comments do not enter
  the document Undo history. Viewer comment writes are rejected server-side.
- Comment drafts retain text/mentions/assignments locally. Project JSON and
  autosave retain threads and participant identities. Existing v2.41 projects
  open without migration. Older clients retain basic presence compatibility.
- Invitation hash changes reload the appropriate project/cache, and comment UI
  keyboard interactions cannot accidentally trigger timeline editing shortcuts.
- Record reads share the atomic writer queue; transient Windows file locks use
  bounded rename retries. A regression test retains 70 concurrent comments while
  servicing 270 presence reads without partial or dropped saves.

Document editing still commits on blur with revision checks and conflict review.
This release adds live awareness; it does not introduce character-level CRDT
merging. Mentions use persistent browser identities and are delivered in-app.
Shared workspace display names are not verified accounts. The production-rebuild
architecture in SPEC.md remains a separate draft roadmap.

See [COLLABORATION.md](COLLABORATION.md) for workflow and hosting details. The free
Render test deployment still needs a persistent disk before relying on durable
shared project/comment/media storage.
