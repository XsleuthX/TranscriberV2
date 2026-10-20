# Transcriber v2.38 - Transcript sync and broader UK spelling

This build adds functional multi-source timeline playback and signed-in Iconik
asset import to the supplied v2.25 React app. It retains the prior import, Story, model, hosting, cancellation and text-editing fixes. This release also fixes Story-card text deletion crashes and keeps AI reviews running past invalid flags or malformed response batches.

## Subtitle Vet in v2.34

Open Transcript or Subtitle and click **Vet**. Use inline Apply/Dismiss, Previous/Next issue, or the optional Issues only view with the player. UK spelling and configurable Chinese punctuation checks run locally without an API key; punctuation removal is off by default. Decimals, URLs, email addresses, common honorifics, contractions and formatting tags are protected. Context-dependent spellings require individual review.

**Vet settings → Team rules** parses explicit correction comments, retains ambiguous notes for manual review, supports literal replacement/deletion and case/whole-word options, and reports remaining matches. Rules import/export as JSON. **Apply shown…** previews the selected category before a bulk transaction. Stale/overlapping/unsafe shared-word edits are skipped. Undo restores text and review decisions. **History** downloads a review report.

Reviews follow the active source and A/B track; Dual Sub has an explicit Vet track selector. Applying Sub A corrections updates Transcript prose and preserves cue IDs/times, Sub B text, source clip references and Story linkage. Changed word timing is marked estimated. Rules, decisions, notes and history are included in autosave and project JSON. UTF-8 and BOM-tagged UTF-16 subtitle imports are supported. Team rules belong to the local project; they are not a shared cloud review service.

## Transcription changes retained from v2.33

- Hosted recognition uses approximately 75–90 second chunks near quiet points with overlapping context. This makes more API requests than the old ten-minute plan.
- Chinese lexical units, honorific names and dictionary terms are kept together. Short adjacent segments split inside a word/name or before closing punctuation are regrouped. Transcript and Subtitle text both follow decoded segments; words only supply timing after punctuation/case-tolerant reconciliation. Mismatched Transcript word timing is marked as estimated.
- Matched cues use actual word starts/ends. A reading-speed guess no longer cuts off a spoken caption. Estimated split timing and readability/recognition issues have specific review badges. Overlap repair never silently drops text.
- Audio activity screens possible missing speech. Quiet uncovered pauses are skipped; up to 12 candidate regions get bounded retries (one or two hosted requests each). Poor-confidence, boilerplate, out-of-range or conflicting candidates are rejected. Browser-local recognition uses the same candidate and acceptance gates. Energy detection is a heuristic, not speech VAD; review every recovered cue.
- Genuine repeats and possible boilerplate are retained with flags. A transcription result cannot overwrite subtitle/transcript edits made while its request was running.
- Raw segment text/metrics, model/languages, retry candidates and unresolved regions are retained with the media in project backups. Missing confidence metrics remain unknown.
- Dictionary defaults are empty: ordinary words are no longer silently replaced by demo brand names. Dictionary entries and priming preferences now survive reload and JSON export/import. Prompts retain spellings and the newest context within a conservative byte budget; Latin replacements respect word boundaries and literal replacement text.

Existing SRT imports keep their original text and timestamps. This update does not turn imported SRT timings into acoustic word timestamps. Re-transcribe with the media to use the new pipeline, and preview flagged results before export. Development validation used offline audio activity/timing analysis and mocked provider responses; live recognition accuracy still requires verification.

## Start on Windows

Install Node.js 22+, then use the commands below to clone and start the app.

**Before upgrading:** export your existing project as a backup. Projects are
stored per browser and URL/port. To keep the existing project, start this build
on the same port you used previously (set `$env:PORT='5173'`, for example, before
`npm start`). Stop the old app server first. Otherwise import your backup at
the new address. The default below opens a separate browser workspace on port 3000.

```powershell
git clone https://github.com/XsleuthX/TranscriberV2.git
cd TranscriberV2
npm ci
npm run build
npm start
```

Open http://localhost:3000. Keep the terminal running. The app server handles Iconik, audio preparation, and transcription/AI requests. `npm run preview` remains available on port 4173.
Do not open `dist/index.html` directly or deploy `dist` alone: those API routes
need the app server. For development, use `npm run dev` (port 5173).

`npm ci` downloads FFmpeg for your operating system. No separate FFmpeg setup
is needed; `FFMPEG_PATH` can override the executable if required.

Projects autosave in this browser's IndexedDB. Keep the same browser and port
to reopen an existing project. Changing browser or port uses separate storage;
the old project's data remains at its original origin. Local files need relinking after reload; transcripts and edits
persist. Iconik asset/proxy IDs persist and can be reconnected.

## New in v2.33

Timeline Get Clips reads timed Sub A cues from the active source in bounded
batches and adds punchy source-linked ranges to that source's Timeline clip list.
Story Suggestion reads Sub A separately for every available source, shortlists
quotes, then arranges them in new AI suggestion sections in Story. Enter an
editorial brief in Instructions before Run. Text and timing always come from
actual source cues; the model supplies selections, section order and labels.
Existing work stays intact, and each addition is one Undo action. A source edit
while the request is running rejects the stale result. Switching footage cannot
redirect clips to a different source. Multi-Timeline Review has been removed.
AI analysis uses transcript text, not audiovisual analysis. Review every cut.

File → Export Project JSON saves source metadata, words, both subtitle tracks,
source clips, Story cards and references, Multi-Timeline tracks/clips/markers,
subtitle rules, AI flags, project display settings and persisted PCM audio.
File → Import Project JSON validates the version and document before replacing
the browser's saved project and reopening it. Invalid files leave that project
intact. Export the open project first if you want to retain a separate backup;
import replaces it and starts a new Undo history. JSON can be moved to another
browser or address. Original video files are not embedded: relink them through
Media Pool; reconnect Iconik using its saved asset identity. Cached audio remains
usable for transcription. Expiring playback/session URLs and API credentials
are not included. Audio makes project JSON larger; this is a project backup,
not a video export. Missing-source placeholders retain their original links.

Multi-Timeline adds comfortable/compact track heights, accessible named
mute/solo/visibility/lock controls, sticky ruler and track headers, source-range
clip tooltips, selection timecodes, audio waveforms from persisted PCM, an empty
sequence guide, a collapsible Add media panel, viewport-aware Fit and optional
playhead following. F fits, S toggles snapping, B splits at playhead; linked
trim/move and lock protection remain in place. The source selector follows an
active-media change and falls back to an unlocked destination track.

Still planned: video thumbnail strips, dragging media directly onto tracks,
transitions, keyframe animation and final rendered-video export. See CapCut's
[desktop editing guide](https://www.capcut.com/resource/how-to-use-capcut-on-pc)
for the transition/keyframe workflow used as a comparison, and its
[desktop export guide](https://www.capcut.com/resource/capcut-desktop-download).

## Fixes in v2.31

Story cue bodies now manage their editable descendants independently of React.
Native text deletion no longer crashes when the browser removes or merges cue
spans. Surviving cue references determine the card's stored and displayed in/out
times. Removing a middle cue splits the card into contiguous runs; removing all
cue text removes the card. Undo restores the original cues and bounds. Deletion
changes Story ranges without deleting the source subtitles. Source switching,
Sub B and repeated cue text retain their own source references.

AI review requests now use short batch-scoped target IDs. Valid flags survive
invalid neighboring entries, and review continues to subsequent batches. Minor
ID formatting and explanation field variations are normalized only against
issued targets. Unknown targets, missing explanations and invalid suggestions
are skipped and counted in the status. A malformed JSON/schema response gets
one format retry; a still-invalid batch is reported and skipped while later
batches continue. Existing flags for unreviewed targets remain intact.

## Undo and cue splitting

Undo/Redo now follows project editing actions across all five workspaces. Separate
clicks stay separate even when performed rapidly; synchronous changes and pointer
drags are one action. Background audio caching, dimensions and player metadata do
not create history steps. A new edit immediately clears Redo. Undo also refreshes
the visible caption text and restores both halves of a split in one step.
History is session-local (up to 60 actions); reopening starts a new history.
While typing in a text field, Ctrl/Cmd-Z uses that field's native editing history;
the toolbar Undo commits the field, then reverses its project edit.

Enter and the Split toolbar use one text-preserving routine for Sub A, Sub B and
both Dual columns. Enter uses the caret in that specific editor. Toolbar Split
uses its caret if present, otherwise a text midpoint. A split needs text on both
sides and at least two frames. The original left cue ID stays linked; Story refs
expand to include the right cue. Subtitles in the other column are not rewritten.

## Integrated AI presets

Open AI Assistant, choose a provider/model and preset, then Run:

| Preset | Scope and result |
| --- | --- |
| Freeform chat | Prompt and editable output box for questions or other text requests. |
| Subtitle Check | Active media, selected A/B/both context; cue explanations and text suggestions. |
| Subtitle Polish | Active media, selected tracks; proposed cue text improvements. |
| Transcript Check | Active media; suspect words and timestamp-preserving corrections. |
| Timeline Get Clips | Active media Sub A; automatically creates source-linked Timeline clips. |
| Story Suggestion | All media Sub A; automatically adds a sample Story in new sections. |

Check/Polish flags appear as yellow AI buttons on relevant transcript lines
and subtitle rows. Hover/focus/click opens a
floating explanation. Show flag/Open in editor navigates to the source item and
time. Apply suggestion changes a cue or timed word; Dismiss flag removes a flag.
Both actions support Undo. Text suggestions preserve timecodes. Transcript word
corrections retain explicitly edited subtitle overrides; subtitle proposals edit
the selected cue's text. Assembly presets create clips/cards directly, as described above.

Reviews persist with the browser project and remain linked when switching media.
Suggestions are disabled if their target changed since review. Removed items are
marked stale. Unknown target IDs and incomplete JSON cannot edit the project.
Reviews use bounded batches and split truncated batches into smaller requests,
which may incur additional API charges. Valid completed batches remain available
if a later batch fails. Very long item text is reviewed as an excerpt.

These reviews analyze the provided text/timing/project structure; they do not
listen to audio. Preview uncertain wording against the recording. Provider/model
response quality still requires human review. Freeform text output is kept when
running integrated presets and reappears on returning to Freeform chat.

## Find and replace

The top toolbar in Transcript and Subtitle modes includes Find text, Replace
with, Match case, Previous/Next match, Replace and Replace all. Searches are
literal, including punctuation. A blank replacement deletes the matched text.
The scope is the active media: Transcript edits its timed word stream and Sub A;
Subtitle edits only the selected A/B track. Dual Sub has a search-track selector.
Matches can be previewed in the player. Cue IDs, timecodes, translated text and
Story links are retained. Undo/Redo supports the replacements.

## Story cue previews and media dimensions

Click any linked cue line in a Story card, including its Edit cues view, to
select that card's media and seek to that cue's start. Playback pauses for the
preview; press Play to hear it. Source changes wait for media metadata before
applying the seek. Editing and cue links remain independent of the active media.

The source player uses the media's actual aspect ratio, within the available
space. Portrait, square, 4:3 and wide footage show the full frame. Audio uses an
audio element and icon with the same transport. Browser codec support still
applies; dimension fitting does not transcode unsupported video codecs.

## Line-by-line Align-To-Audio

Paste pure text, one nonblank line per subtitle. Whisper word timestamps are
matched in sequence to consistently tokenized Latin/CJK text. Each line becomes
one cue with its original text, punctuation and spacing intact. Alignment uses
Whisper-1 timing even if another OpenAI speech model is selected. Long recordings
use shorter timestamp requests. Source switching cannot redirect the result.
Existing Sub B translations retain their text and timing.

Unmatched words and overlapping provider timestamps require estimated timing;
the relevant cues show an estimated timing badge. Completely unrelated scripts
fail without replacing subtitles. Review estimates against the recording.

## DeepSeek assistant output

The model picker uses the current API IDs **deepseek-flash** (V4.1 Flash) and **deepseek-v4-pro**. Thinking is a separate Off / Low / High / Maximum control; Off is the default for responsive editing. **Refresh DeepSeek models** queries the authenticated official /models endpoint using your existing API key. Old Chat/Reasoner IDs remain backend compatibility aliases, but are removed from the dropdown. Keys never appear in the returned model list.

DeepSeek replies stream through the server with waiting, thinking and generating status. Keepalives keep the browser/server connection active; each request has a 180-second total server deadline and a 200-second browser deadline. Cancel AI stops an in-flight assistant request. Provider authentication, balance, capacity, empty-answer, interrupted-stream and timeout errors are visible. Reasoning content is never used as answer text or applied edits.

Reviews, Story/Timeline assembly, clip finding and translation explicitly request JSON objects with their own schemas. Translation and clip-finding accept legacy array replies for compatibility, but validate cue IDs/ranges. Incomplete JSON is not applied. JSON mode is not forced on freeform chat. Structured review/assembly tasks split oversized batches themselves; they do not incur a second hidden provider-layer truncation retry. Freeform non-thinking replies can retry truncation once with a doubled budget (an additional billed request), retain partial text and offer Continue output. App budgets are 8K or 16K tokens initially, capped at 32K, deliberately below the provider maximum to bound edit latency and cost.

Official references checked 2026-10-15: [models](https://api-docs.deepseek.com/api/list-models/), [thinking](https://api-docs.deepseek.com/guides/thinking_mode/), [JSON output](https://api-docs.deepseek.com/guides/json_mode/), and [chat completion/finish reasons](https://api-docs.deepseek.com/api/create-chat-completion/).

## Transcription progress and cancellation

Import automatically prepares audio, but does not start transcription. The
Transcribe progress bar appears only after you press Transcribe. Preparation
and operation status remain visible even with help text hidden. The status names
the recording being transcribed, including when you select a different source.

Cancel stops pending transcription requests or the local worker and prevents
late results from changing subtitles. Shared import preparation may continue.
Repeated clicks cannot launch overlapping jobs; alignment and transcription
cannot run over each other. Import completion cannot clear an active job.
Provider/worker failures release progress so you can retry.

## Local media preparation

Small media is read in bounded slices with alternate-reader fallback and retries,
then decoded in the browser. Large media (over 64 MB) and unsupported browser
audio use FFmpeg on the app server. Import and Transcribe share one preparation
job; decoded audio is cached so later transcription does not re-read the original.
On a hosted app, this fallback uploads the selected media to that app server.
Temporary files are removed after audio is delivered, and idle jobs expire.
Permanent OS read failures still require reselecting/relinking the file; the error
no longer assumes the file is missing or in a cloud folder.

## OpenAI model choices

Transcribe includes Whisper-1, GPT-Transcribe, GPT-4o Transcribe, and GPT-4o mini
Transcribe. Whisper-1 supplies native word timestamps. The GPT speech options
make an additional billed Whisper request per chunk to align their transcript
text to acoustic timing. Changed/unmatched words have estimated timing; review
captions before export. That timing status is saved with the asset.

Translation/AI include GPT-6.1 Sol, GPT-6 Luna, GPT-6 Astra, GPT-4.1/mini, GPT-4o/mini,
and existing legacy text choices. GPT-6 models use the Responses API. They process
the transcript for translation/editing/story work; they do not accept video/audio
for speech transcription. Your API project permissions and billing determine access.

Official references: [file transcription](https://developers.openai.com/api/docs/guides/speech-to-text)
and [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol).

## Story assembly stability

Cards resolve and update cues through their own asset, including mini cue edits,
relinking, and titles created when a card splits. Merely focusing/blurring a card
or switching active media does not mutate it. Cue IDs reused by other files no
longer share usage badges. Rewriting a whole card retains its links; explicitly
clearing/removing its last cue remains a deletion. Story rows and timeline clips
continue to persist across media switching and project reload.

## Connect Iconik

1. Open **Media Pool → Iconik**.
2. Paste a signed-in asset URL, such as
   `https://app.iconik.io/asset/ASSET-UUID/`.
3. Enter an Iconik API token. Include the Application ID for legacy
   App-ID/Auth-Token authentication, or leave it blank for a bearer token.
4. Choose **Import / reconnect asset**. Close the pool to preview the footage.
   Audio extraction runs in the background.

The token must have read access to the asset and its proxies. An Iconik browser
login alone does not grant access to this app. Your administrator can supply a
read-only integration credential. Alternatively, copy `.env.example` to `.env`
and configure `ICONIK_AUTH_TOKEN` and optionally `ICONIK_APP_ID` there. Restart
the server after changing `.env`. Credentials entered in the form stay in server
memory for up to 12 hours and are not saved with the project. Reconnect after a
server restart or credential expiry.

The app chooses a completed video proxy, preferring a smaller MP4/WebM, with
audio-only proxies as a fallback. Playback streams through a same-origin route
with byte-range support; it does not wait for full audio extraction. Expired
storage URLs are refreshed and retried. Extraction downloads the proxy to a
temporary file, uses FFmpeg to create 16 kHz mono samples, then removes temporary
files. It does not alter or upload anything to Iconik.

After extraction, use **Transcribe**, **Subtitle**, **Translate**, **Find clips**,
and **Story** with the imported asset as you would with a local file. Local
Whisper needs model downloads but no transcription API key; hosted engines
need their own provider keys. Story generation still uses the app's existing
transcript and AI workflows.

Supported: signed-in asset links and UUIDs with completed MP4, WebM, M4A, MP3 or
WAV proxies. Browser codec support still applies to video preview. Public shares,
password shares, collections, HLS-only streams, DRM, live broadcasts, and OAuth
sign-in are not implemented. This is on-demand playback of stored footage.
Extraction currently limits a proxy to 4 GB and decoded audio to 1 GB; it needs
temporary disk space. For large masters, generate a smaller proxy in Iconik.

## Multi-Timeline

Open **F5**. Select a pool source and an unlocked destination track. Enter source
In/Out in seconds, position the playhead, and choose **Add at playhead**.

- Video insertion creates linked video and audio clips. The subtitles option
  copies intersecting Sub A cues onto a subtitle track. Occupied audio/subtitle
  tracks get a separate track when necessary. You can also add video/audio tracks.
- Upper video tracks cover lower ones. Select clips to change opacity, scale,
  position, or audio volume in the inspector. Use its clip selector to inspect
  the audio member of a linked group.
- Drag clips horizontally or between tracks of the same type. Shift-click adds
  to the selection; marquee selection uses both time and track boundaries.
- Drag edges to trim. Source In/Out follow the trim and stop at source limits.
  Linked subtitles are cropped; moves retain their offsets.
- Tracks support video/subtitle visibility, audio mute/solo, and locks. All
  active audio clips mix independently; video layers themselves are muted.
- **B** cuts selected groups at the playhead (all unlocked clips if none are
  selected). **Delete** removes selection; **Shift+Delete** closes empty sequence
  intervals without shifting through surviving or locked material.
- **Ctrl+Z / Ctrl+Shift+Z** undo/redo. Snap uses clip edges, markers and playhead.
  Same-track collisions reject a move; choose another track or an empty span.
- The program monitor shows project-time subtitles and overlays, source-correct
  footage at each cut, and black gaps. Playback pauses while sources buffer and
  reports missing media. **Space** toggles playback.
- Story → **Push to Multi-Timeline** rebuilds the sequence from cards and is now
  undoable. Existing v2.25 story-linked clips resolve their media from the cards.

This covers basic assembly, layering, trimming and preview. It does not provide
Premiere parity: no transition/effect library, keyframe animation, professional
audio meters/mixer, nested sequences, multicam, variable-speed edits, final video
rendering, or NLE interchange export. The old nonfunctional Render button was
removed. Timeline timecodes and snap increments remain fixed at 25 fps.

## Verify

```powershell
npm test
npm run build
npm run preview
# In another terminal:
npm run test:browser
npm run test:hosting-browser
npm run test:transcription-browser
npm run test:editing-browser
npm run test:review-browser
npm run test:story-review-browser
npm run test:assembly-browser
```

The browser suite defaults to installed Microsoft Edge. Set `BROWSER_CHANNEL`
to another installed Playwright channel and `APP_URL` to a different local URL
if needed. Tests use a fresh browser profile, generated footage and mocked Iconik
responses, never your saved project or credentials.

For v2.33, 33 focused unit tests and three production-frontend browser suites
passed: assembly/project interchange, edit/review regressions, and Story deletion/
review batching. Browser provider responses are mocked; no paid AI or live
Iconik account calls were made. The broader backend integration tests could not
run in this Windows sandbox because localhost connections were denied. The
production build used a temporary ordinary-realpath resolver workaround for a
sandbox-only native path lookup restriction; neither workaround nor fixtures
are included in the release. CI runs the complete suite on the production server.

## Hosting

See [DEPLOYMENT.md](DEPLOYMENT.md) for GitHub setup and hosting instructions.
The included production server and Dockerfile serve the complete app at one
address with a workspace password. GitHub Pages alone cannot run media/API
routes. Keep Vite development/preview servers local. Projects remain browser-local.

The archive excludes credentials, node_modules, and test media.

API references: https://app.iconik.io/docs/authentication.html and
https://app.iconik.io/docs/apidocs.html?url=/docs/files/spec/ .
# Editing tools in v2.35

Transcript and Subtitle modes have compact **Find** and **Vet** toolbar buttons. Find (Ctrl/Cmd+F) expands a search strip; **Replace…** reveals replacement controls. Vet opens the right panel for local suggestions and team rules. **Vet settings → Team rules** also saves contextual AI guidelines. **Configure AI vet…** uses the existing DeepSeek, OpenAI or Claude settings; review and approve suggestions individually. AI reviews include nearby and paired subtitle context, support cancellation, and reject stale suggestions after text or policy changes. Freeform AI chat remains available.

**Copy transcript** copies the complete active transcript from project data, including offscreen paragraphs. Ctrl/Cmd+A then Ctrl/Cmd+C does the same when outside text editors. There is no application character cap. **Download transcript TXT** saves the complete text when clipboard access is unavailable. Native selection within editable fields remains unchanged.


## Audit checklist and batch workflows in v2.37

See [AUDIT-CHECKLIST.md](AUDIT-CHECKLIST.md) for all 153 spelling mappings, protected content, the optional format audit thresholds and natural-language AI Subtitle Check. All proposed edits remain reviewable.

Multi-file imports now prepare audio sequentially and show per-source status. In Transcribe, expand Batch transcribe media, select eligible sources and Start batch transcription. Existing transcripts require explicit replacement opt-in. The queue continues after per-file errors and supports cancellation; keep the tab open. API calls are billed normally.

Story Suggestion creates editable, source-linked sample cards, avoids overlapping quote repetition, bounds shortlist reduction and preserves concurrent Story edits. See [v2.37 release notes](CHANGELOG-v2.37.md).


## v2.38 editing and spelling

Transcript paragraph edits now synchronise Sub A, including imported/pinned cues, regardless of the last selected subtitle track. Changes retain source timing, cue identity, B translations and linked Story/Timeline references in one Undo action. Separately rewritten cues that cannot be mapped safely are retained with a review notice. Local spelling now covers 1161 explicit mappings from 165 allowed −ise verb families and other variants; no blanket z-to-s replacement. Vet settings includes Team Rules examples. See [audit and usage details](AUDIT-CHECKLIST.md).
