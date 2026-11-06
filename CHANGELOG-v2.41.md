# v2.41 — Shared projects

- **Share project** creates a server-backed copy, keeping the local project
  available separately. The existing workspace password protects invitations.
- Editor/viewer links, participant display names, live presence and a sync status
  replace the placeholder avatars. Viewer writes are blocked by the client and
  server. A replacement viewer link revokes its predecessor.
- Transcript, both subtitle tracks, Story, source clips, Multi-Timeline, reviews,
  vet rules, dictionary and project title synchronize between browsers.
- Revision checks and serialized atomic file transactions reject stale writes.
  Independent entity/field edits merge; competing changes pause for explicit
  conflict review and an optional local project backup.
- Native text edits commit on blur. Incoming changes wait during text editing
  and pointer gestures. Incoming revisions reset whole-document Undo history.
  Navigation, playhead, selection and view preferences stay personal.
- Explicit footage uploads provide shared, authenticated range playback. Original
  video and decoded PCM are not uploaded automatically.
- Device autosave includes the last shared baseline for offline recovery. Editor
  and viewer invitation caches are separate. Local project import/clear remain
  available after returning to the local project.
- Production Docker storage is writable by the runtime user. Hosting requires
  one app process, HTTPS and a persistent `COLLAB_DATA_DIR`. See
  [COLLABORATION.md](COLLABORATION.md) for setup, limits and usage.

Verification: production build, 97 unit/server tests, the three-session
collaboration browser test, and existing hosting, editing and Story-range browser
regressions passed locally. Test media was generated; no paid provider requests
or real external account calls were used. Deployment and Docker execution have
not been performed for this update.
