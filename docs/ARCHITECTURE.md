# Architecture

Audio Mix Studio is an Electron app with a sandboxed React renderer. There is no local HTTP service or hosted application backend.

```
React UI → typed context bridge → validated Electron IPC
                                     ├─ MediaStore → FFmpeg / FFprobe
                                     ├─ WhisperX worker → local Python + models
                                     ├─ Codex CLI → structured transcript grouping
                                     └─ Epidemic Sound MCP → catalog and selected media
```

## Boundaries

- `src/shared/types.ts`: the host contract and serializable project types.
- `src/domain/project.ts`: immutable edit operations, master order, AI alignment adoption, and saved-project validation. No host dependencies.
- `src/ui/App.tsx` and `workspaceState.ts`: project-tab shell, independent editor histories, active/closed tabs, and global appearance.
- `src/ui/Workspace.tsx`: a mounted editor per tab, with sentence-choice/music views and operation state; hidden tabs stop playback and never intercept active-tab shortcuts.
- `src/domain/soundMix.ts`: typed source roles, lane/placement/keyframe validation, source/output time mapping, and the combined render plan.
- `src/ui/MusicWorkspace.tsx`: synchronized multitrack timeline, staging arranger, and section inspector.
- `src/ui/ImportKindDialog.tsx`: source audition and role selection before adoption.
- `src/ui/`: bounded playback scheduling, memoized waveform paths, settings, and shared dependency discovery.
- `electron/workspace.ts`: validated workspace persistence, recovery backups, and serialized project-scoped media tasks.
- `electron/main.ts`: native dialogs, trusted sender checks, operation ownership, portable project persistence, autosave, and opaque media URLs.
- `electron/media.ts`: immutable import copies, normalization, waveform peaks, byte-range serving, audio slices, and sample-accurate master rendering.
- `electron/epidemic.ts`: authenticated catalog operations, encrypted account credential storage, request cancellation, validated provider results, and bounded media downloads.
- `src/ui/EpidemicBrowser.tsx` and `EpidemicKeyDialog.tsx`: discovery, inline audition, verified key setup, and the shared settings connection form.
- `src/shared/epidemicCatalog.ts`: dated official public catalog options; the MCP server provides filters but no taxonomy-list tool.
- `electron/integrations/`: binary discovery, bounded subprocesses, checksummed downloads, runtime locking, transcription, and constrained Codex output validation.
- `resources/transcription/`: the pinned WhisperX worker, Python dependency lock, model manifest, bootstrap manifest, and original MIT attribution.

## Edit model

A project has source tracks, ordered sentence groups, and source-referenced segments. Segments carry absolute source start/end seconds and an enabled flag. Sentence groups carry a validated playback speed in 1% steps (new controls use 0.5–2x; legacy rates up to 2.5x remain readable); per-joint settings use the ordered pair of neighboring audible group IDs. Defaults and per-field overrides are distinct. The master concatenates enabled segments in group order, then import order, then source time within a take. Sentence choices enable all pieces of the selected take in that group; legacy explicit manual edits remain readable, while new narration edits use Sentence choices and the master range-cut tool.

Explicit master range cuts split selected source segments at sample-rounded positions and mark them with optional validated `excluded: true`, independently of their take-selection `enabled` flag. `masterClips` omits excluded ranges and compresses the playback/export clock; `masterTimelineClips` retains them as gray ranges with separate visual offsets and playback offsets. Domain time mappings seek through cuts and jump the visual cursor at compressed-clock boundaries. Cuts add no silence or edge fades. Restoring clears an exclusion, and choosing another variation preserves each take's exclusions. Full-take regrouping with exclusions rejects adoption rather than dropping explicit edits; scoped alternatives retain their existing pieces.

AI receives full transcripts and returns groups of source-word or ASR-segment index ranges. The adapter maps indices to verified timestamps, rejects omissions/duplicates/unknown sources, and requests one correction for invalid output. A successful result becomes the domain alignment contract. The domain partitions each source from 0 to its complete duration, placing each boundary at the sample-rounded midpoint between adjacent speech ranges. Leading, internal, and trailing silence stay in the source partition. An `audioSchema: 2` marker identifies this timing model. Migration only expands legacy tracks whose unsplit segments, transcript ranges, and old 60 ms boundaries can be verified exactly; manual or ambiguous boundaries remain untouched. Source media and full transcripts remain available.

A source with optional `sentenceGroupId` is a sentence-only alternative. `appendSentenceAlternatives` attaches the complete source range to that existing group with disabled segments; other selections and group settings remain unchanged. Its label uses the actual imported transcript when present, otherwise the filename. These sources bypass transcription and Codex alignment. Saved-project validation requires their owner group and rejects segments outside it. Regrouping retains scoped source edits and selections only when its original target is identified safely; missing or ambiguous targets reject the new alignment before adoption. Portable import remaps source IDs while retaining group ownership.

Codex cannot assess acoustic delivery from transcript text. It proposes logical sentence boundaries and semantic matches; the user chooses the better sounding take.

## Audio

Imports are copied into a private cache and normalized to stereo 48 kHz PCM WAV. Originals are never edited. Waveforms are measured from the audio. Waveform bars are memoized SVG paths, and offscreen sentence rows defer layout. Playback requests bounded PCM slices and schedules Web Audio sources with sample-accurate gain ramps; export performs sample-index FFmpeg trimming, pitch-preserving external SoundTouch processing, optional independent edge fades, requested joint silence, and concatenation into a WAV or MP3. Preview decoding applies the same time-stretch pipeline and exact output frame count. SoundTouch is discovered as `soundstretch`, reported in settings, and invoked as a bounded cancellable process. Its tempo control retains pitch, following Audacity’s Change Tempo integration. See TEMPO.md for inspected upstream pointers. Edge fades do not overlap clips or alter duration; pauses add output frames. All three joint defaults are zero. Master offsets include pauses, source ranges stay absolute, and output duration accounts for speed. Playback seeks into silence and schedules it exactly once between audible groups. Chunk gain ramps sample the continuous clip envelope, so long decodes do not restart fades. Complete unedited one-take assemblies at 1x with zero joints export sample-for-sample identically to the normalized source. The first decoded section starts without waiting for the next; scheduled source nodes and gain ramps control actual timing. The master cursor updates at 30 Hz and captures the exact audio clock when pausing; standalone previews need no animation loop.

## Music and sound effects

Sources carry an optional role (`voiceover`, `music`, `soundtrack`); missing roles mean narration. Music/effect sources never enter transcript grouping or sentence order. The first source is analyzed before project adoption; later files are auditioned and classified individually. Cancelling classification stops the remaining batch without adopting the pending file. Each operation and dialog remains bound to its origin project tab.

The optional `soundMix` contains ordered lanes and source-referenced placements. Exactly one lane is the protected voiceover reference; it renders the current narration assembly. Initial projects display Music 1 and Soundtrack 1 as well. Placements have absolute output offsets, sample-rounded source trims, and settings. Internal source-relative keyframes divide a placement into sections, each with its own constant pitch-preserving speed, gain, and fades. Updating speed changes all downstream section offsets in that placement. Voiceover speed updates its sentence group and recomputes the concatenated narration, preserving explicit joint pauses without creating new gaps. Music/effect offsets remain absolute.

Fades include duration, delay from the beginning/end of the section, a curve preset, and a custom exponent. The shared render plan combines narration with overlapping music/effect sections. Preview and export use the same gain/timing rules. The master overview includes music/effect bands and extends to the longest audible placement. The arranger dialog stages edits in a local draft; Save creates one undoable edit and Cancel discards it. Lane deletion removes only its placements after confirmation, retaining imported source assets.

## Epidemic Sound

The optional integration uses the documented personal MCP Server API key, not a Developer Portal API key. Only Electron communicates with the fixed authenticated MCP endpoint. The official TypeScript MCP client negotiates Streamable HTTP and handles JSON/SSE responses. Each request has a validated cancellation ID and a bounded lifetime; closing a browser or superseding a search invalidates late callbacks.

Key setup verifies actual service access before confirming a connection or replacing the previous working key. The credential is kept separately from workspace/project data, encrypted through Electron safeStorage on macOS and written atomically with restrictive permissions. Without encrypted storage, a connection is session-only. Read APIs expose connection state and verification time, never the saved key. Removing a connection cancels its outstanding operations. No credential is read automatically from Codex configuration by the application.

Search exposes the actual music and effect filters, sort orders, cursor pagination, similar-audio tools, and external-reference discovery. Canonical genre/mood/category choices come from a dated official public-catalog snapshot; themes become descriptive topic searches. Genre/decade/region choices share the MCP taxonomy match operator, with an explicit control rather than silently combining unrelated dimensions. Request validation rejects unsupported options and invalid ranges. Signed media URLs remain transient, are restricted to official hosts, and are fetched without the MCP Authorization header. HQ downloads enter the existing immutable normalization/import pipeline and carry validated catalog provenance. The transient preview cache is separate from project assets and bounded; auditions do not permanently add full-song WAVs to the project media cache.

Music/effect source buttons open a provider/local source chooser with an existing-library shortcut. The Epidemic source is always selectable: it opens direct key entry when disconnected and the catalog when connected. Setup, browsing, and preview work before narration; only catalog Add/import stays disabled until the first verified voiceover, with the host and project-adoption guards enforcing the same rule. Both local and catalog imports feed the same type/audition dialog, then an undoable draft arranger. Cancelling the arranger retains the imported source in the library but does not adopt its draft placements. Active-tab changes stop audition playback; async operations retain their origin project.

## Persistence

The complete workspace is automatically saved in Application Support as `workspace-session.json`: open project snapshots, active project ID, last 20 closed snapshots, and appearance. The previous `last-session.json` is migrated without being deleted. Invalid existing workspaces receive an exclusive byte-for-byte recovery copy before a replacement can be written. Aggregate size is validated identically on save and restore. Edits are sent immediately and atomic writes are serialized. Theme changes use the latest owned snapshot. Each tab owns a separate undo/redo history in memory; closed-tab history remains available until restart. Explicit Save writes a portable `.mixstudio` JSON manifest plus a sibling `.assets` folder of source WAVs. Keep both together. Source track IDs are remapped on open into newly authorized cache entries. Paths, timestamps, sizes, reference integrity, and source durations are revalidated. Restore independently checks each tab’s imported-cache files: missing/unreadable media silently removes only that tab. Unsupported workspace versions reset quietly and unsupported individual project/audio versions omit only those tabs, preserving exact recovery bytes first. Original-download deletion cannot invalidate a good cached copy. A separate atomic `preferences.json` records the first successful master export and survives incompatible-workspace resets; only completed exports set it. Quick guide uses this durable preference for sidebar visibility and remains in Settings. Writes use temporary files and atomic rename; persistence runs serially.

The master heading selects seek or range-cut mode. Pointer capture supports forward/reverse and cross-clip drags; Escape, pointer cancellation, tab changes, and busy state cancel a pending selection. A gray-range context menu restores one excluded piece. During master playback only, the currently audible sentence receives a subtle marker and its scroll container follows group changes; previews, filtered lists, dialogs, and the music workspace do not trigger sentence following.

The master timeline owns cursor-anchored gesture zoom and horizontal panning independently of project edits. Native ⌘+/−/0 commands zoom the timeline, not the web page. Waveforms have no horizontal clip padding; portal tooltips expose full sentences even for narrow clips. Sentence cards use a full-card selection hit target and an independent preview button. File-drop routing is recomputed from the actual event destination: an empty mix accepts files throughout the workspace; populated mixes accept full takes only in the sidebar, master, or music workspace regions. Sentence rows route files to their own stable group ID and show a local highlight. Other Sentence choices regions reject file drops without navigating. The sentence picker and drops use the same validated import bridge and tab-owned busy/cancellation lifecycle.

## Privacy and security

The renderer has context isolation, OS sandboxing, no Node integration, a restrictive content policy, denied permission requests, and no general shell/filesystem bridge. Media URLs resolve only opaque imported IDs and implement real byte ranges. Native links are allowlisted.

WhisperX and word alignment run locally. Runtime/model setup uses pinned checksums. A verified Vandashi runtime/model can be reused read-only; missing files go to this app's own cache. Codex runs an ephemeral read-only job without user/project configuration or shell/web tools. It receives explicitly indexed transcript content and opaque source IDs, not audio or source paths. Model options mirror Vandashi’s paginated app-server `model/list`; supported reasoning and priority/Fast capabilities are derived from that catalog. Per-project choices are validated and re-resolved before launching CLI model, reasoning-effort, and priority-tier flags, with the source-verified Vandashi background default of GPT-6-Luna/Medium/Fast off. Unsupported stored selections fall back to the live account default. Authentication and provider communication use the user's installed Codex CLI.

## Verification

Focused domain tests cover editing, ordering, alignment, and untrusted project validation. Real FFmpeg tests check clip order through frequency measurements, output duration, formats, cancellation, range handling, and portable assets. The native smoke script launches production Electron with OS sandboxing enabled and exercises production IPC and media playback; the media harness stubs native dialog answers only. Separate tab tests hold controlled background/setup responses to test ownership, and editing/recovery scripts exercise real media, speed/joints, gesture zoom, guide lifecycle, and per-tab missing-cache handling using isolated profiles and generated speech.

## Tabs and operation ownership

Editor actions target a stable project ID. Background analysis adopts into that editor without activating it; stale results cannot resurrect a closed tab. Busy tabs cannot close. A different project can be edited or exported while AI is running. AI/model setup retain one heavy-operation lease; media/file tasks run in a separate serialized queue. Progress and cancellation carry the originating project ID. Imports, native pickers, portable writes, and exports retain queue ownership through completion. Operation results never write a single project over the workspace snapshot.

Portable opens use canonical file identity: an already open file focuses its existing editor, while another file/copy gets a separate workspace ID and Save destination. This prevents copies sharing an embedded project ID from redirecting each other’s Save. Native menu events are handled only by the active editor. The 48 px draggable tab bar reserves native traffic-light space; both native and renderer appearance follow Light/Dark/System.
