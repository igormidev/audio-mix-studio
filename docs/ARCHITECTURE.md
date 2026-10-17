# Architecture

Audio Mix Studio is an Electron app with a sandboxed React renderer. There is no local HTTP service or hosted application backend.

```
React UI → typed context bridge → validated Electron IPC
                                     ├─ MediaStore → FFmpeg / FFprobe
                                     ├─ WhisperX worker → local Python + models
                                     └─ Codex CLI → structured transcript grouping
```

## Boundaries

- `src/shared/types.ts`: the host contract and serializable project types.
- `src/domain/project.ts`: immutable edit operations, master order, AI alignment adoption, and saved-project validation. No host dependencies.
- `src/ui/App.tsx` and `workspaceState.ts`: project-tab shell, independent editor histories, active/closed tabs, and global appearance.
- `src/ui/Workspace.tsx`: a mounted editor per tab, with sentence/manual views and operation state; hidden tabs stop playback and never intercept active-tab shortcuts.
- `src/ui/`: bounded playback scheduling, memoized waveform paths, settings, and shared dependency discovery.
- `electron/workspace.ts`: validated workspace persistence, recovery backups, and serialized project-scoped media tasks.
- `electron/main.ts`: native dialogs, trusted sender checks, operation ownership, portable project persistence, autosave, and opaque media URLs.
- `electron/media.ts`: immutable import copies, normalization, waveform peaks, byte-range serving, audio slices, and sample-accurate master rendering.
- `electron/integrations/`: binary discovery, bounded subprocesses, checksummed downloads, runtime locking, transcription, and constrained Codex output validation.
- `resources/transcription/`: the pinned WhisperX worker, Python dependency lock, model manifest, bootstrap manifest, and original MIT attribution.

## Edit model

A project has source tracks, ordered sentence groups, and source-referenced segments. Segments carry absolute source start/end seconds and an enabled flag. Sentence groups carry a validated 0.5–2.5 playback speed in quarter steps; per-joint settings use the ordered pair of neighboring audible group IDs. Defaults and per-field overrides are distinct. The master concatenates enabled segments in group order, then import order, then source time within a take. Sentence choices enable all pieces of the selected take in that group; manual editing can enable pieces from multiple takes. Both modes edit the same data.

AI receives full transcripts and returns groups of source-word or ASR-segment index ranges. The adapter maps indices to verified timestamps, rejects omissions/duplicates/unknown sources, and requests one correction for invalid output. A successful result becomes the domain alignment contract. The domain partitions each source from 0 to its complete duration, placing each boundary at the sample-rounded midpoint between adjacent speech ranges. Leading, internal, and trailing silence stay in the source partition. An `audioSchema: 2` marker identifies this timing model. Migration only expands legacy tracks whose unsplit segments, transcript ranges, and old 60 ms boundaries can be verified exactly; manual or ambiguous boundaries remain untouched. Source media and full transcripts remain available.

A source with optional `sentenceGroupId` is a sentence-only alternative. `appendSentenceAlternatives` attaches the complete source range to that existing group with disabled segments; other selections and group settings remain unchanged. Its label uses the actual imported transcript when present, otherwise the filename. These sources bypass transcription and Codex alignment. Saved-project validation requires their owner group and rejects segments outside it. Regrouping retains scoped source edits and selections only when its original target is identified safely; missing or ambiguous targets reject the new alignment before adoption. Portable import remaps source IDs while retaining group ownership.

Codex cannot assess acoustic delivery from transcript text. It proposes logical sentence boundaries and semantic matches; the user chooses the better sounding take.

## Audio

Imports are copied into a private cache and normalized to stereo 48 kHz PCM WAV. Originals are never edited. Waveforms are measured from the audio. Waveform bars are memoized SVG paths, and offscreen sentence rows defer layout. Playback requests bounded PCM slices and schedules Web Audio sources with sample-accurate gain ramps; export performs sample-index FFmpeg trimming, pitch-preserving `atempo`, optional independent edge fades, requested joint silence, and concatenation into a WAV or MP3. Preview decoding applies the same time-stretch pipeline and exact output frame count. Edge fades do not overlap clips or alter duration; pauses add output frames. All three joint defaults are zero. Master offsets include pauses, source ranges stay absolute, and output duration accounts for speed. Playback seeks into silence and schedules it exactly once between audible groups. Chunk gain ramps sample the continuous clip envelope, so long decodes do not restart fades. Complete unedited one-take assemblies at 1x with zero joints export sample-for-sample identically to the normalized source. The first decoded section starts without waiting for the next; scheduled source nodes and gain ramps control actual timing. The master cursor updates at 30 Hz and captures the exact audio clock when pausing; standalone previews need no animation loop.

## Persistence

The complete workspace is automatically saved in Application Support as `workspace-session.json`: open project snapshots, active project ID, last 20 closed snapshots, and appearance. The previous `last-session.json` is migrated without being deleted. Invalid existing workspaces receive an exclusive byte-for-byte recovery copy before a replacement can be written. Aggregate size is validated identically on save and restore. Edits are sent immediately and atomic writes are serialized. Theme changes use the latest owned snapshot. Each tab owns a separate undo/redo history in memory; closed-tab history remains available until restart. Explicit Save writes a portable `.mixstudio` JSON manifest plus a sibling `.assets` folder of source WAVs. Keep both together. Source track IDs are remapped on open into newly authorized cache entries. Paths, timestamps, sizes, reference integrity, and source durations are revalidated. Restore independently checks each tab’s imported-cache files: missing/unreadable media silently removes only that tab. Unsupported workspace versions reset quietly and unsupported individual project/audio versions omit only those tabs, preserving exact recovery bytes first. Original-download deletion cannot invalidate a good cached copy. A separate atomic `preferences.json` records the first successful master export and survives incompatible-workspace resets; only completed exports set it. Quick guide uses this durable preference for sidebar visibility and remains in Settings. Writes use temporary files and atomic rename; persistence runs serially.

The master timeline owns cursor-anchored gesture zoom and horizontal panning independently of project edits. Native ⌘+/−/0 commands zoom the timeline, not the web page. Waveforms have no horizontal clip padding; portal tooltips expose full sentences even for narrow clips. Sentence cards use a full-card selection hit target and an independent preview button. File-drop routing is recomputed from the actual event destination: an empty mix accepts files throughout the workspace; populated mixes accept full takes only in the sidebar, master, or Manual edit waveform regions. Sentence rows route files to their own stable group ID and show a local highlight. Other Sentence choices regions reject file drops without navigating. The sentence picker and drops use the same validated import bridge and tab-owned busy/cancellation lifecycle.

## Privacy and security

The renderer has context isolation, OS sandboxing, no Node integration, a restrictive content policy, denied permission requests, and no general shell/filesystem bridge. Media URLs resolve only opaque imported IDs and implement real byte ranges. Native links are allowlisted.

WhisperX and word alignment run locally. Runtime/model setup uses pinned checksums. A verified Vandashi runtime/model can be reused read-only; missing files go to this app's own cache. Codex runs an ephemeral read-only job without user/project configuration or shell/web tools. It receives explicitly indexed transcript content and opaque source IDs, not audio or source paths. Model options mirror Vandashi’s paginated app-server `model/list`; supported reasoning and priority/Fast capabilities are derived from that catalog. Per-project choices are validated and re-resolved before launching CLI model, reasoning-effort, and priority-tier flags, with the source-verified Vandashi background default of GPT-6-Luna/Medium/Fast off. Unsupported stored selections fall back to the live account default. Authentication and provider communication use the user's installed Codex CLI.

## Verification

Focused domain tests cover editing, ordering, alignment, and untrusted project validation. Real FFmpeg tests check clip order through frequency measurements, output duration, formats, cancellation, range handling, and portable assets. The native smoke script launches production Electron with OS sandboxing enabled and exercises production IPC and media playback; the media harness stubs native dialog answers only. Separate tab tests hold controlled background/setup responses to test ownership, and editing/recovery scripts exercise real media, speed/joints, gesture zoom, guide lifecycle, and per-tab missing-cache handling using isolated profiles and generated speech.

## Tabs and operation ownership

Editor actions target a stable project ID. Background analysis adopts into that editor without activating it; stale results cannot resurrect a closed tab. Busy tabs cannot close. A different project can be edited or exported while AI is running. AI/model setup retain one heavy-operation lease; media/file tasks run in a separate serialized queue. Progress and cancellation carry the originating project ID. Imports, native pickers, portable writes, and exports retain queue ownership through completion. Operation results never write a single project over the workspace snapshot.

Portable opens use canonical file identity: an already open file focuses its existing editor, while another file/copy gets a separate workspace ID and Save destination. This prevents copies sharing an embedded project ID from redirecting each other’s Save. Native menu events are handled only by the active editor. The 48 px draggable tab bar reserves native traffic-light space; both native and renderer appearance follow Light/Dark/System.
