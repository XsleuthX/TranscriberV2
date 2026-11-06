# Shared projects

Open the app, then choose **Share project → Create shared project**. This creates
a shared copy and preserves your browser's local project. The header shows live
sync status separately from the browser's own autosave status.

1. Set your display name in the collaboration panel.
2. Send the **Editor link** to teammates who should make changes.
3. Choose **Create / replace viewer link** for read-only access, then copy that
   link. Replacing it revokes the previous viewer link.
4. Teammates open the link at the same hosted address and enter the existing
   workspace password. The project invitation survives sign-in.
5. Optionally upload footage under **Shared media**, or use **Share linked file**
   for a file already imported in this tab. Uploading is explicit; creating a
   shared project does not upload your footage or cached audio automatically.

Editor links allow editing and sharing. Anyone with a link also needs the
workspace password on a protected deployment. Display names identify browser
sessions, not verified accounts. There is no separate owner or user directory.
Keep editor links private. Access keys live in the invitation fragment and
authenticated requests; stored projects contain only key hashes. Media playback
uses a project-scoped, same-origin URL containing that participant's access key.
Exported project JSON omits playback URLs and keys.

## Working together

### Live selections and carets in v2.42

The collaboration strip stays visible above all five workspaces. Each participant
gets a project colour, retained when their name changes. Their chip shows their
active workspace; click it to locate them. **Live selections** hides/shows remote
indicators on this device. Source playback, navigation and zoom remain independent.

| Workspace | Visible activity |
| --- | --- |
| Transcript | Paragraph/word selections, native text selections and edit carets |
| Subtitle | Cue selection, row ranges and text carets, scoped to the source and A/B track |
| Timeline | Selected source clips, checkbox selections, selected time ranges and playheads |
| Story | Selected cards, body/title/notes carets and source-linked cue edits |
| Multi-Timeline | Selected clips/groups, sequence ranges and playheads across tracks |

Presence refreshes roughly every 600 ms, with selection changes prompting a
faster update. It runs separately from project saves, even while an editor has
focus or a document conflict is being reviewed. Inactive locations expire;
hidden tabs clear their active selection. Returning to the app refreshes presence
and comments immediately. Offscreen or unmounted rows have no floating caret
until they are visible again; locating a participant scrolls their target into view.

Text ranges use source/track/entity identities and UTF-16 character offsets,
measured against the local rendered text. Indicators account for zoom and scroll.
When someone is typing an uncommitted draft that differs from your text, the
surface shows their coloured **editing draft** badge. Click it for a live text
preview and caret rather than an incorrectly positioned caret in the shared text.
Previews are limited to 2,000 characters; a caret beyond that preview is labelled.

### Comments, mentions and actions

Select text, a caption, a card, a clip or a time range, then choose **Add comment**,
the floating **Comment** button, or **Ctrl/⌘+Alt+M**. Comments open as a floating
panel; pins mark visible content with open threads. Click a pin to open its thread,
or click a thread's location to return to the original source/workspace.

- Type `@` and choose a project participant to mention them. Participants become
  available for mentions after opening the updated shared project.
- Choose an **Action owner** to assign follow-up work. **For me** shows open
  mentions and assigned actions. These are in-app notifications; no email is sent.
- Reply in a thread, change its action owner, or **Resolve** it. **Resolved**
  retains the conversation and allows **Reopen**.
- Use **This view** to filter by workspace, or **All** to inspect the full project.
- Changed/removed targets retain their original quotation and an explicit warning.
  Comments are not silently attached to a different caption, source or Story card.

Editors can comment, reply, assign and resolve. Viewers can read threads. Local
projects also support comments; those remain on that device until sharing or
exporting. Comments, replies, assignments and participant identities are included
in Project JSON and browser autosave. Server-backed comment operations append
independently of document revisions and do not change the text editor's Undo stack.
An unsent comment draft stays on this device, including mention/action selections.
Posting requires a connection; a failed request leaves the draft available to retry.

Participant IDs persist in each browser profile. A display name is not a verified
account, and the same name in another browser is a different participant. Use the
same browser for assigned actions; account-based identity across devices remains
a future feature. Comment messages are limited to 4,000 characters, with an 8 MiB
project comment archive limit.

### Document synchronization

Transcript, both subtitle tracks, Story, source clips, Multi-Timeline, review
flags/decisions, vet rules, dictionary, priming preference and project title are
shared. Navigation, playhead, selected source, view mode, zoom, player controls
and decoded audio caches stay personal.

Changes sync about every 1.5 seconds. Native text editors commit on blur, so
click outside the text editor when finished. Incoming changes wait until that
editor is closed. Independent fields and identified cues/cards/clips merge;
word streams and arrays without stable IDs are treated as whole values.

When both people change the same field, or delete something the other edits,
sync pauses. **Review sync issue** shows the affected paths. Download a backup
if useful, then choose **Use shared versions** or **Use my versions** for the
conflicting values. Independent edits from both people are retained. The server
checks revision numbers on every write and rejects stale saves. Structurally
invalid combined projects are rejected without replacing the stored project.

Incoming revisions reset the local whole-document Undo history, so Undo cannot
roll back teammates' work. Undo/Redo still work between incoming revisions.
Viewers can navigate, play and export; project writes are rejected both by the
editor's history and by the server. Local media can be relinked per browser;
Iconik connections still need each browser's existing reconnect workflow.

When disconnected, edits and their last shared baseline autosave in a separate
IndexedDB slot for that shared project. Sync retries automatically, including
after a reload. Leave the tab open until **All changes shared** before closing.
The browser prompts before leaving with unshared changes. An expired workspace
session requires signing in again. **Return to my local project** reopens the
original browser project. Project JSON import and Clear saved project are
disabled while a shared project is open; return to the local project to use them.

## Hosting and storage

The code is ready to run on the existing Node server. To use it across computers,
deploy one instance at a common HTTPS address using [DEPLOYMENT.md](DEPLOYMENT.md).
A localhost invitation only opens on that same computer.

Set `COLLAB_DATA_DIR` to persistent, writable storage. Its default is
`./data/collaboration`. This directory contains atomic project JSON records and
uploaded media in project-specific subdirectories. Back it up together. The
runtime Docker image uses `/app/data/collaboration`; mount a persistent volume
at `/app/data`. A Docker example:

```powershell
docker build -t transcriber:collaboration .
docker run --rm -p 3000:3000 --env-file .env -v transcriber-data:/app/data transcriber:collaboration
```

Use the usual `NODE_ENV=production`, `APP_ORIGIN` and `APP_PASSWORD` settings.
The image's data directory is writable by its `node` user. For a bind mount,
ensure the mounted directory also permits that user to write.

Run **exactly one Node process / app replica** against the directory. File
transactions are serialized inside that process; this is not a distributed
database. Projects and uploaded media survive restarts; presence and sign-in
sessions do not. Do not use an ephemeral filesystem for real shared work.

Uploads accept MP4, WebM, MOV and supported audio MIME types. Each file is streamed
to disk, with a default 2 GiB limit (`COLLAB_MAX_MEDIA_BYTES` overrides it), and
playback supports byte ranges. Configure your reverse proxy's upload size and
timeout for your footage. Browser codec compatibility still applies. Replaced
uploads are retained on disk; project/media deletion and storage administration
are not included. Monitor disk capacity and retain independent backups.

## Verification

```powershell
npm test
npm run build
npm run test:collaboration-browser
```

The collaboration browser test starts an isolated temporary password-protected
server and three independent headless browser contexts. It verifies invitation
sign-in, live editing/presence, viewer restrictions, independent merges,
conflicts, offline reload recovery, real uploaded-video playback and preservation
of the local project. It uses generated footage and no paid provider services.

`npm run test:collaboration-visible-browser` verifies all five workspaces with
independent editor/viewer sessions, including source/track isolation, Chinese and
emoji ranges, zoom/scroll alignment, comment operations and removed targets.
