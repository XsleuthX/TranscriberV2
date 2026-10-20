# Transcriber v2.40 — stable timecode editing and exact Story cuts

Timecode editing opens on a completed click. Outside dismissal uses a fresh pointer press, so the opening release and cue-panel drags cannot immediately close it. Escape/Cancel still dismiss; switching cards reinitialises the fields. Panels account for UI zoom, and opening a card's range activates its own media.

Saving writes explicit sin/sout and rangeMode=manual. The shared Story range resolver gives these values priority over cue-derived bounds in the document, preview, exports, picker and Multi-Timeline. Text-only changes retain manual ranges. Cue deletion keeps explicit outer boundaries; splitting partitions internal ranges. Unpinned legacy cards continue following cues. Use cue timing returns to that behavior.

Updating linked cue text is separate from exact timing. Authored manual/VO copy is retained unless the editor explicitly chooses relinking. Speech-gap ranges preserve existing text and remembered refs. Input validates 25fps frame fields; frame nudges retain source timecode offset. Exact cuts are not stretched to the former half-second minimum. Subtitle overlays are clamped to the Story cut; explicit audio-card ranges are respected.

Unit/browser coverage includes event sequencing, dismissal/drag, exact In/Out, invalid frames/nudging, source preview, text edits/reload/Undo/reset, project serialization, speech-gap copy, authored audio, Multi-Timeline and subtitle trimming at different UI zooms. Full CI checks the production build and container startup.
