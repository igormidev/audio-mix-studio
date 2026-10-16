# Audio Mix Studio

Read README.md and docs/ARCHITECTURE.md before structural changes. Update them when the architecture or delivered behavior changes.

- Keep the app local, macOS-first, with readable light and dark themes, and focused on comparing narration takes. Do not add a chat UI.
- Each project tab owns its edits and undo history. Persist all open/closed tabs and theme together; background work must update only its origin tab.
- Domain rules live in src/domain. React never imports Electron, Node, or filesystem modules. The typed preload is the only host bridge; validate every IPC request and restrict media access to app-imported assets.
- Preserve originals, saved projects, unrelated settings, and other apps' model caches. Vandashi is a reference, never a dependency or a writable workspace.
- Use the same WhisperX engine and pinned models as the documented integration. Never replace a failed real analysis with invented text or timestamps. Codex output must pass semantic-range and source-timing validation before adoption.
- Make asynchronous operations visibly busy and cancellable. Do not invent progress percentages. Serialize persistence, preserve the last good project, and guard stale playback and AI callbacks.
- Run npm run check and relevant focused tests before committing. Keep tests meaningful: audio order and timestamps, file recovery, invalid JSON, cancellation, and edit history matter more than component snapshots.
- Exercise real audio import/playback/export and the production media protocol after host changes. Builds alone do not prove delivery.
- Documentation and screenshots must reflect actual app behavior. Never commit audio fixtures, personal transcriptions, caches, credentials, installers, or machine-specific paths. Use generated demonstration speech for screenshots.
