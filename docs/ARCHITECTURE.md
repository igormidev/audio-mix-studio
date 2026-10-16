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

A project has source tracks, ordered sentence groups, and source-referenced segments. Segments carry absolute start/end seconds and an enabled flag. The master concatenates enabled segments in group order, then import order, then source time within a take. Sentence choices enable all pieces of the selected take in that group; manual editing can enable pieces from multiple takes. Both modes edit the same data.

AI receives full transcripts and returns groups of source-word or ASR-segment index ranges. The adapter maps indices to verified timestamps, rejects omissions/duplicates/unknown sources, and requests one correction for invalid output. A successful result becomes the domain alignment contract. The domain adds up to 60 ms of breath room around speech, bounded by adjacent midpoints. Long silence is omitted. Source media and full transcripts remain available.

Codex cannot assess acoustic delivery from transcript text. It proposes logical sentence boundaries and semantic matches; the user chooses the better sounding take.

## Audio

Imports are copied into a private cache and normalized to stereo 48 kHz PCM WAV. Originals are never edited. Waveforms are measured from the audio. Waveform bars are memoized SVG paths, and offscreen sentence rows defer layout. Playback requests bounded PCM slices and schedules Web Audio sources with sample-accurate gain ramps; export performs actual FFmpeg trimming, optional edge fades, and concatenation into a WAV or MP3. Edge fades do not overlap clips or alter duration. The first decoded section starts without waiting for the next; scheduled source nodes and gain ramps control actual timing. The master cursor updates at 30 Hz and captures the exact audio clock when pausing; standalone previews need no animation loop.

## Persistence

The complete workspace is automatically saved in Application Support as `workspace-session.json`: open project snapshots, active project ID, last 20 closed snapshots, and appearance. The previous `last-session.json` is migrated without being deleted. Invalid existing workspaces receive an exclusive byte-for-byte recovery copy before a replacement can be written. Aggregate size is validated identically on save and restore. Edits are sent immediately and atomic writes are serialized. Theme changes use the latest owned snapshot. Each tab owns a separate undo/redo history in memory; closed-tab history remains available until restart. Explicit Save writes a portable `.mixstudio` JSON manifest plus a sibling `.assets` folder of source WAVs. Keep both together. Source track IDs are remapped on open into newly authorized cache entries. Paths, timestamps, sizes, reference integrity, and source durations are revalidated. Writes use temporary files and atomic rename; persistence runs serially.

## Privacy and security

The renderer has context isolation, OS sandboxing, no Node integration, a restrictive content policy, denied permission requests, and no general shell/filesystem bridge. Media URLs resolve only opaque imported IDs and implement real byte ranges. Native links are allowlisted.

WhisperX and word alignment run locally. Runtime/model setup uses pinned checksums. A verified Vandashi runtime/model can be reused read-only; missing files go to this app's own cache. Codex runs an ephemeral read-only job without user/project configuration or shell/web tools. It receives transcript content and opaque source IDs, not audio or source paths. Authentication and provider communication use the user's installed Codex CLI.

## Verification

Focused domain tests cover editing, ordering, alignment, and untrusted project validation. Real FFmpeg tests check clip order through frequency measurements, output duration, formats, cancellation, range handling, and portable assets. The native smoke script launches production Electron with OS sandboxing enabled and exercises production IPC and media playback; it stubs native dialog answers only inside the test harness.

## Tabs and operation ownership

Editor actions target a stable project ID. Background analysis adopts into that editor without activating it; stale results cannot resurrect a closed tab. Busy tabs cannot close. A different project can be edited or exported while AI is running. AI/model setup retain one heavy-operation lease; media/file tasks run in a separate serialized queue. Progress and cancellation carry the originating project ID. Imports, native pickers, portable writes, and exports retain queue ownership through completion. Operation results never write a single project over the workspace snapshot.

Portable opens use canonical file identity: an already open file focuses its existing editor, while another file/copy gets a separate workspace ID and Save destination. This prevents copies sharing an embedded project ID from redirecting each other’s Save. Native menu events are handled only by the active editor. The 48 px draggable tab bar reserves native traffic-light space; both native and renderer appearance follow Light/Dark/System.
