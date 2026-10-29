import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  shell,
  nativeTheme,
  safeStorage,
} from "electron";
import {
  readFile,
  mkdir,
  lstat,
  stat,
  rename,
  rm,
  realpath,
  open as openFile,
} from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  MixProject,
  OperationProgress,
  TranscriptionModel,
  AudioTrack,
  AnalysisGroup,
  StudioTheme,
} from "../src/shared/types";
import { transcriptionModels } from "../src/shared/types";
import {
  newProject,
  appendTracks,
  masterClips,
  applyAlignment,
  parseProject,
} from "../src/domain/project";
import { mixRenderClips } from "../src/domain/soundMix";
import { epidemicCatalog } from "../src/shared/epidemicCatalog";
import { EpidemicService } from "./epidemic";
import {
  checkDependencies,
  setupTranscription,
  transcribe,
  alignTranscripts,
  discoverCodexModels,
} from "./integrations/index";
import {
  MediaStore,
  AUDIO_EXTENSIONS,
  atomicJSON,
  byteRange,
  createReadStream,
  renderMix,
  decodeMixSlice,
  validatePlaybackSpeed,
  runProcess,
  findBinary,
  decodeAudioSlice,
} from "./media";
import {
  checkedTheme,
  PreferencesStore,
  ProjectTaskQueue,
  UnavailableProjectMediaError,
  WorkspaceStore,
} from "./workspace";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "mixmedia",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);
app.setName("Audio Mix Studio");
nativeTheme.themeSource = "light";
// Honor Chromium's standard profile switch, useful for separate local workspaces.
const requestedProfile = app.commandLine.getSwitchValue("user-data-dir");
if (requestedProfile) {
  const profile = path.resolve(requestedProfile);
  mkdirSync(profile, { recursive: true });
  app.setPath("userData", profile);
}
let window: BrowserWindow | null = null;
let media: MediaStore;
let cacheDirectory: string;
let autosaveFile: string;
let workspace: WorkspaceStore;
let preferences: PreferencesStore;
let epidemic: EpidemicService;
let workspaceMode = false;
let currentProject: MixProject | null = null;
let persistenceQueue: Promise<void> = Promise.resolve();
const fileOperations = new ProjectTaskQueue();
let quitting = false;
let readyToQuit = false;
let closing = false;
let operation: AbortController | null = null;
let operationProjectId: string | undefined;
let operationCompletion: Promise<unknown> | null = null;
const projectPaths = new Map<string, string>();
const canonicalProjectPaths = new Map<string, string>();
const previewControllers = new Set<AbortController>();
const mixPreviewControllers = new Map<AbortController, string>();
const mixPreviewEpochs = new Map<string, number>();
const previewTasks = new Set<Promise<ArrayBuffer>>();
const previewQueue: (() => void)[] = [];
let activePreviews = 0;
const devURL = process.env.VITE_DEV_SERVER_URL;
const indexFile = path.resolve(__dirname, "../dist/index.html");

type ProgressReporter = (value: OperationProgress) => void;
function progress(value: OperationProgress | null, projectId?: string) {
  if (window && !window.isDestroyed())
    window.webContents.send(
      "studio:progress",
      value ? { ...value, projectId: value.projectId || projectId } : null,
    );
}
async function withOperation<T>(
  action: (signal: AbortSignal, report: ProgressReporter) => Promise<T>,
  projectId?: string,
) {
  if (closing) throw new Error("The studio is closing.");
  if (operation)
    throw new Error(
      "An operation is already running. Wait for it to finish or cancel it first.",
    );
  const controller = new AbortController();
  operation = controller;
  operationProjectId = projectId;
  const task = (async () => {
    try {
      return await action(controller.signal, (value) =>
        progress(value, projectId),
      );
    } finally {
      if (operation === controller) {
        operation = null;
        operationProjectId = undefined;
      }
      progress(null);
    }
  })();
  operationCompletion = task;
  try {
    return await task;
  } finally {
    if (operationCompletion === task) operationCompletion = null;
  }
}
function withFileOperation<T>(
  action: (signal: AbortSignal, report: ProgressReporter) => Promise<T>,
  projectId?: string,
) {
  if (closing) return Promise.reject(new Error("The studio is closing."));
  return fileOperations.run(
    (signal) =>
      action(signal, (value) => {
        if (!signal.aborted) progress(value, projectId);
      }),
    projectId,
  );
}
function trustedSender(event: Electron.IpcMainInvokeEvent) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  )
    throw new Error("Blocked untrusted application request.");
  const url = event.senderFrame?.url || "";
  if (
    devURL
      ? new URL(url).origin !== new URL(devURL).origin
      : url !== pathToFileURL(indexFile).href
  )
    throw new Error("Blocked request outside the application.");
}
function handle(channel: string, listener: (...args: never[]) => unknown) {
  ipcMain.handle(channel, async (event, ...args) => {
    trustedSender(event);
    if (closing) throw new Error("The studio is closing.");
    return listener(...(args as never[]));
  });
}
function checkedProject(value: unknown): MixProject {
  const project = parseProject(value);
  if (project.tracks.length > 50 || project.segments.length > 20000)
    throw new Error(
      "This project is too large. Use up to 50 sources and 20,000 segments.",
    );
  project.tracks = project.tracks.map((track) => ({
    ...track,
    ...media.track(track.id),
    transcript: track.transcript,
  }));
  return parseProject(project);
}
async function restorableProject(value: unknown): Promise<MixProject> {
  // A malformed project remains an error. Only unavailable app-owned audio
  // qualifies for quietly dropping an individual tab during restoration.
  const project = parseProject(value);
  for (const track of project.tracks) {
    if (!media.has(track.id)) throw new UnavailableProjectMediaError();
    try {
      const filename = media.filename(track.id);
      const status = await lstat(filename);
      if (!status.isFile() || status.isSymbolicLink() || status.size < 44)
        throw new UnavailableProjectMediaError();
      const file = await openFile(filename, "r");
      try {
        const header = Buffer.alloc(12);
        const { bytesRead } = await file.read(header, 0, header.length, 0);
        if (
          bytesRead !== 12 ||
          !["RIFF", "RF64"].includes(header.toString("ascii", 0, 4)) ||
          header.toString("ascii", 8, 12) !== "WAVE"
        )
          throw new UnavailableProjectMediaError();
      } finally {
        await file.close();
      }
    } catch {
      throw new UnavailableProjectMediaError();
    }
  }
  return checkedProject(project);
}
function checkedModel(model: unknown): TranscriptionModel {
  if (!transcriptionModels.includes(model as TranscriptionModel))
    throw new Error("Select a supported transcription model.");
  return model as TranscriptionModel;
}
function remember(project: MixProject): Promise<void> {
  // New renderer sessions own complete tab snapshots. A completed operation
  // may concern a background tab, and must never replace that newer snapshot.
  if (workspaceMode) return Promise.resolve();
  currentProject = project;
  persistenceQueue = persistenceQueue
    .catch(() => undefined)
    .then(() => atomicJSON(autosaveFile, project));
  return persistenceQueue;
}
function checkedProjectId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.length || value.length > 200)
    throw new Error("Invalid mix tab identifier.");
  return value;
}
function checkedImportPaths(paths: unknown): string[] {
  if (
    !Array.isArray(paths) ||
    !paths.length ||
    paths.length > 50 ||
    paths.some((file) => typeof file !== "string")
  )
    throw new Error("Choose between 1 and 50 audio files.");
  return paths;
}
async function importFileBatch(
  paths: string[],
  signal: AbortSignal,
  report: ProgressReporter,
  projectId?: string,
): Promise<AudioTrack[]> {
  const tracks: AudioTrack[] = [];
  const source = projectId ? workspace.project(projectId) : currentProject;
  for (const [index, file] of paths.entries()) {
    tracks.push(
      await media.importAudio(file, {
        signal,
        colorIndex: (source?.tracks.length || 0) + index,
        onProgress: (value) =>
          report({ ...value, fraction: index / paths.length }),
      }),
    );
  }
  return tracks;
}
async function importFiles(
  paths: unknown,
  origin?: unknown,
): Promise<AudioTrack[]> {
  const checked = checkedImportPaths(paths);
  const projectId = checkedProjectId(origin);
  return withFileOperation(
    (signal, report) => importFileBatch(checked, signal, report, projectId),
    projectId,
  );
}
const safeName = (name: string) =>
  name
    .replace(/[/:\0]/g, "-")
    .replaceAll("\\", "-")
    .trim()
    .slice(0, 100) || "Untitled mix";

async function saveProject(
  value: unknown,
  saveAs: boolean,
  signal: AbortSignal,
) {
  const project = checkedProject(value);
  let filename = !saveAs && projectPaths.get(project.id);
  if (!filename) {
    const choice = await dialog.showSaveDialog(window!, {
      title: "Save portable mix project",
      defaultPath: `${safeName(project.name)}.mixstudio`,
      filters: [
        { name: "Audio Mix Studio project", extensions: ["mixstudio"] },
      ],
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });
    if (choice.canceled || !choice.filePath) return null;
    filename = choice.filePath.endsWith(".mixstudio")
      ? choice.filePath
      : `${choice.filePath}.mixstudio`;
  }
  const directory = `${path.basename(filename, ".mixstudio")}.assets`;
  if (signal.aborted) throw new Error("Operation cancelled.");
  const assetDirectory = path.join(path.dirname(filename), directory);
  await mkdir(assetDirectory, { recursive: true });
  if (
    !(await lstat(assetDirectory)).isDirectory() ||
    (await lstat(assetDirectory)).isSymbolicLink()
  )
    throw new Error("The project asset folder must be a regular directory.");
  const assets: Record<string, string> = {};
  for (const track of project.tracks) {
    if (signal.aborted) throw new Error("Operation cancelled.");
    const target = path.join(assetDirectory, `${track.id}.wav`);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await media.copyAsset(track.id, temporary);
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
    assets[track.id] = `${directory}/${track.id}.wav`;
  }
  if (signal.aborted) throw new Error("Operation cancelled.");
  await atomicJSON(filename, {
    format: "audio-mix-studio",
    version: 1,
    project,
    assets,
  });
  projectPaths.set(project.id, filename);
  canonicalProjectPaths.set(project.id, await realpath(filename));
  await remember(project);
  return filename;
}
async function openProject(origin?: unknown) {
  const projectId = checkedProjectId(origin);
  return withFileOperation(async (signal, report) => {
    const choice = await dialog.showOpenDialog(window!, {
      title: "Open a mix project",
      properties: ["openFile"],
      filters: [
        { name: "Audio Mix Studio project", extensions: ["mixstudio"] },
      ],
    });
    if (choice.canceled || !choice.filePaths[0]) return null;
    if (signal.aborted) throw new Error("Operation cancelled.");
    const filename = choice.filePaths[0];
    const canonical = await realpath(filename);
    for (const [id, existingPath] of canonicalProjectPaths) {
      if (existingPath !== canonical) continue;
      const existing = workspace.project(id);
      if (existing) return checkedProject(existing);
    }
    if ((await stat(filename)).size > 50 * 1024 * 1024)
      throw new Error("The project file is too large.");
    const raw = JSON.parse(await readFile(filename, "utf8"));
    if (
      raw.format !== "audio-mix-studio" ||
      raw.version !== 1 ||
      !raw.assets ||
      typeof raw.assets !== "object"
    )
      throw new Error("This is not an Audio Mix Studio portable project.");
    const project = parseProject(raw.project);
    if (project.tracks.length > 50)
      throw new Error("This project has more than 50 sources.");
    const idMap = new Map<string, string>();
    const imported: AudioTrack[] = [];
    for (const track of project.tracks) {
      const relative = raw.assets[track.id];
      const parts = typeof relative === "string" ? relative.split("/") : [];
      if (
        parts.length !== 2 ||
        !parts[0].endsWith(".assets") ||
        parts[0].includes("\\") ||
        parts[0] === "." ||
        parts[0] === ".." ||
        parts[1] !== `${track.id}.wav` ||
        !/^[a-f0-9-]{36}$/.test(track.id)
      )
        throw new Error(
          "The project contains an unsafe or missing audio asset path.",
        );
      const asset = path.resolve(path.dirname(filename), relative);
      const parent = await lstat(path.dirname(asset));
      const file = await lstat(asset);
      if (
        parent.isSymbolicLink() ||
        !parent.isDirectory() ||
        file.isSymbolicLink() ||
        !file.isFile()
      )
        throw new Error("Project assets must be regular local audio files.");
      const cached = await media.importAudio(asset, {
        signal,
        name: track.name,
        colorIndex: imported.length,
        onProgress: report,
      });
      idMap.set(track.id, cached.id);
      imported.push({
        ...cached,
        transcript: track.transcript,
        role: track.role,
        origin: track.origin,
        ...(track.sentenceGroupId
          ? { sentenceGroupId: track.sentenceGroupId }
          : {}),
      });
    }
    project.tracks = imported;
    project.segments = project.segments.map((segment) => ({
      ...segment,
      trackId: idMap.get(segment.trackId)!,
    }));
    if (project.soundMix)
      project.soundMix.placements = project.soundMix.placements.map(
        (placement) => ({
          ...placement,
          trackId: idMap.get(placement.trackId)!,
        }),
      );
    const checked = checkedProject(project);
    if (signal.aborted) throw new Error("Operation cancelled.");
    // The same saved document (or a copied manifest) may be opened twice.
    // Each editor owns its own identity and Save destination; never redirect
    // an existing tab's path mapping merely by opening a copy.
    checked.id = randomUUID();
    projectPaths.set(checked.id, filename);
    canonicalProjectPaths.set(checked.id, canonical);
    await remember(checked);
    return checked;
  }, projectId);
}

async function demoProject(origin?: unknown): Promise<MixProject> {
  const projectId = checkedProjectId(origin);
  return withFileOperation(async (signal, report) => {
    const phrases = [
      [
        "Every great story starts with a single idea.",
        "Listen closely. The smallest details can change everything.",
        "Choose the voice that brings your story to life.",
      ],
      [
        "Every great story begins with one idea.",
        "Listen closely. The smallest details can change everything.",
        "Choose the voice that brings your story to life.",
      ],
      [
        "Every great story starts with a single idea.",
        "A little curiosity goes a long way.",
        "Choose the voice that brings your story to life.",
      ],
    ];
    const demoDirectory = path.join(media.root, `demo-${randomUUID()}`);
    await mkdir(demoDirectory, { recursive: true });
    const ffmpeg = await findBinary("ffmpeg");
    const ffprobe = await findBinary("ffprobe");
    const tracks: AudioTrack[] = [];
    const timings: { start: number; end: number; text: string }[][] = [];
    try {
      for (const [take, lines] of phrases.entries()) {
        const pieces: string[] = [];
        let cursor = 0;
        const segments: { start: number; end: number; text: string }[] = [];
        for (const [n, text] of lines.entries()) {
          report({
            phase: "importing",
            message: `Creating demo voice ${take + 1} of 3…`,
            fraction: (take + n / lines.length) / 3,
          });
          const aiff = path.join(demoDirectory, `${take}-${n}.aiff`);
          const wave = path.join(demoDirectory, `${take}-${n}.wav`);
          await runProcess(
            "/usr/bin/say",
            ["-r", String([162, 178, 150][take]), "-o", aiff, text],
            { signal },
          );
          await runProcess(
            ffmpeg,
            ["-v", "error", "-y", "-i", aiff, "-ar", "48000", "-ac", "2", wave],
            { signal },
          );
          const probe = await runProcess(
            ffprobe,
            [
              "-v",
              "error",
              "-show_entries",
              "format=duration",
              "-of",
              "default=nw=1:nk=1",
              wave,
            ],
            { signal },
          );
          const duration = Number(probe.stdout.toString().trim());
          segments.push({ start: cursor, end: cursor + duration, text });
          cursor += duration;
          pieces.push(wave);
        }
        const combined = path.join(demoDirectory, `take-${take}.wav`);
        await runProcess(
          ffmpeg,
          [
            "-v",
            "error",
            "-y",
            ...pieces.flatMap((p) => ["-i", p]),
            "-filter_complex",
            "[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]",
            "-map",
            "[out]",
            combined,
          ],
          { signal },
        );
        const track = await media.importAudio(combined, {
          signal,
          name: [
            "Take 01 · Warm narration",
            "Take 02 · Brighter delivery",
            "Take 03 · Alternate script",
          ][take],
          colorIndex: take,
        });
        segments[segments.length - 1].end = Math.min(
          segments[segments.length - 1].end,
          track.duration,
        );
        track.transcript = {
          model: "Demo · prepared speech",
          language: "en",
          segments,
          words: [],
        };
        tracks.push(track);
        timings.push(segments);
      }
      const groups: AnalysisGroup[] = [
        {
          text: phrases[0][0],
          note: "The same opening idea, with a small wording variation.",
          variations: tracks.map((t, i) => ({
            trackId: t.id,
            ...timings[i][0],
          })),
        },
        {
          text: phrases[0][1],
          note: "Two takes of the same sentence.",
          variations: tracks
            .slice(0, 2)
            .map((t, i) => ({ trackId: t.id, ...timings[i][1] })),
        },
        {
          text: phrases[2][1],
          note: "An extra sentence found only in the alternate script.",
          variations: [{ trackId: tracks[2].id, ...timings[2][1] }],
        },
        {
          text: phrases[0][2],
          note: "Three delivery choices for the closing sentence.",
          variations: tracks.map((t, i) => ({
            trackId: t.id,
            ...timings[i][2],
          })),
        },
      ];
      const project = applyAlignment(
        appendTracks(newProject("Demo · Find your favorite voice"), tracks),
        { groups },
      );
      await remember(project);
      return project;
    } finally {
      await rm(demoDirectory, { recursive: true, force: true });
    }
  }, projectId);
}

function registerIPC() {
  handle("studio:epidemicStatus", () => epidemic.status());
  handle("studio:epidemicCatalog", () => epidemicCatalog());
  handle("studio:epidemicConnect", (key: unknown, requestId: unknown) =>
    epidemic.run(requestId, (signal) => epidemic.connect(key, signal)),
  );
  handle("studio:epidemicDisconnect", () => epidemic.disconnect());
  handle("studio:epidemicCancel", (requestId: unknown) =>
    epidemic.cancel(requestId),
  );
  handle("studio:epidemicSearch", (value: unknown, requestId: unknown) =>
    epidemic.run(requestId, (signal) => epidemic.search(value, signal)),
  );
  handle("studio:epidemicPreview", (value: unknown, requestId: unknown) =>
    epidemic.run(requestId, (signal) =>
      withFileOperation((queuedSignal) =>
        epidemic.preview(value, AbortSignal.any([signal, queuedSignal])),
      ),
    ),
  );
  handle(
    "studio:epidemicImport",
    (value: unknown, origin: unknown, requestId: unknown) => {
      const projectId = checkedProjectId(origin);
      if (!projectId)
        throw new Error("Choose the project receiving this audio.");
      const project = workspace.project(projectId);
      if (
        !project?.tracks.some(
          (track) => (track.role ?? "voiceover") === "voiceover",
        )
      )
        throw new Error(
          "Import and verify your first voiceover before adding Epidemic Sound music or effects.",
        );
      return epidemic.run(requestId, (signal) =>
        withFileOperation(
          (queuedSignal, report) =>
            epidemic.import(
              value,
              AbortSignal.any([signal, queuedSignal]),
              report,
            ),
          projectId,
        ),
      );
    },
  );
  handle("studio:preferences", () => preferences.get());
  handle("studio:dependencies", () => checkDependencies(cacheDirectory));
  handle("studio:codexModels", () => discoverCodexModels());
  handle("studio:import", (origin?: unknown) => {
    const projectId = checkedProjectId(origin);
    return withFileOperation(async (signal, report) => {
      const result = await dialog.showOpenDialog(window!, {
        title: "Add audio to your studio",
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Audio files", extensions: AUDIO_EXTENSIONS }],
      });
      return result.canceled
        ? []
        : importFileBatch(
            checkedImportPaths(result.filePaths),
            signal,
            report,
            projectId,
          );
    }, projectId);
  });
  handle("studio:importPaths", importFiles);
  handle(
    "studio:audioSlice",
    async (
      id: unknown,
      start: unknown,
      end: unknown,
      speed: unknown = 1,
      logicalSource?: unknown,
      origin?: unknown,
    ) => {
      if (closing) throw new Error("The studio is closing.");
      if (
        typeof id !== "string" ||
        typeof start !== "number" ||
        typeof end !== "number" ||
        typeof speed !== "number" ||
        !Number.isFinite(speed)
      )
        throw new Error("Invalid preview request.");
      validatePlaybackSpeed(speed);
      const owner = checkedProjectId(origin);
      const epoch = owner ? (mixPreviewEpochs.get(owner) ?? 0) : 0;
      let source: { start: number; end: number } | undefined;
      if (logicalSource !== undefined) {
        if (
          !logicalSource ||
          typeof logicalSource !== "object" ||
          Array.isArray(logicalSource) ||
          Object.keys(logicalSource).some(
            (key) => key !== "start" && key !== "end",
          ) ||
          typeof (logicalSource as { start?: unknown }).start !== "number" ||
          typeof (logicalSource as { end?: unknown }).end !== "number"
        )
          throw new Error("Invalid logical preview source.");
        source = logicalSource as { start: number; end: number };
      }
      if (previewQueue.length >= 12)
        throw new Error("Preview is busy. Try again in a moment.");
      if (activePreviews >= 2)
        await new Promise<void>((resolve) => previewQueue.push(resolve));
      if (closing) throw new Error("The studio is closing.");
      if (owner && epoch !== (mixPreviewEpochs.get(owner) ?? 0)) {
        previewQueue.shift()?.();
        throw new Error("Playback cancelled.");
      }
      activePreviews++;
      const controller = new AbortController();
      previewControllers.add(controller);
      if (owner) mixPreviewControllers.set(controller, owner);
      const task = decodeAudioSlice(
        media,
        id,
        start,
        end,
        controller.signal,
        speed,
        source,
      );
      previewTasks.add(task);
      try {
        return await task;
      } finally {
        previewTasks.delete(task);
        previewControllers.delete(controller);
        mixPreviewControllers.delete(controller);
        activePreviews--;
        previewQueue.shift()?.();
      }
    },
  );
  handle(
    "studio:mixSlice",
    async (value: unknown, start: unknown, end: unknown) => {
      if (closing) throw new Error("The studio is closing.");
      const project = checkedProject(value);
      if (typeof start !== "number" || typeof end !== "number")
        throw new Error("Invalid mixed preview interval.");
      const epoch = mixPreviewEpochs.get(project.id) ?? 0;
      if (previewQueue.length >= 12)
        throw new Error("Preview is busy. Try again in a moment.");
      if (activePreviews >= 2)
        await new Promise<void>((resolve) => previewQueue.push(resolve));
      if (closing) throw new Error("The studio is closing.");
      if (epoch !== (mixPreviewEpochs.get(project.id) ?? 0)) {
        previewQueue.shift()?.();
        throw new Error("Playback cancelled.");
      }
      activePreviews++;
      const controller = new AbortController();
      previewControllers.add(controller);
      mixPreviewControllers.set(controller, project.id);
      const task = decodeMixSlice(
        media,
        project,
        start,
        end,
        controller.signal,
      );
      previewTasks.add(task);
      try {
        return await task;
      } finally {
        previewTasks.delete(task);
        previewControllers.delete(controller);
        mixPreviewControllers.delete(controller);
        activePreviews--;
        previewQueue.shift()?.();
      }
    },
  );
  handle("studio:cancelPlayback", (origin: unknown) => {
    const projectId = checkedProjectId(origin);
    if (!projectId) throw new Error("Invalid playback owner.");
    mixPreviewEpochs.set(projectId, (mixPreviewEpochs.get(projectId) ?? 0) + 1);
    for (const [controller, id] of mixPreviewControllers)
      if (id === projectId) controller.abort();
  });
  handle("studio:cancel", (origin?: unknown) => {
    const projectId = checkedProjectId(origin);
    if (projectId === undefined || operationProjectId === projectId)
      operation?.abort();
    fileOperations.cancel(projectId);
  });
  handle("studio:setup", (value: unknown, origin?: unknown) => {
    const projectId = checkedProjectId(origin);
    return withOperation(async (signal, report) => {
      await setupTranscription(
        cacheDirectory,
        checkedModel(value),
        report,
        signal,
      );
      return checkDependencies(cacheDirectory);
    }, projectId);
  });
  handle("studio:analyze", (value: unknown) => {
    const project = checkedProject(value);
    return withOperation(async (signal, report) => {
      // A sentence replacement is already attached to one explicit choice.
      // Treating it as another complete script would let AI create unrelated
      // rows or consume its timing when regrouping the original full takes.
      const takes = project.tracks.filter(
        (track) =>
          !track.sentenceGroupId && (track.role ?? "voiceover") === "voiceover",
      );
      if (!takes.length)
        throw new Error("Add a complete audio take before grouping sentences.");
      const dependencies = await checkDependencies(cacheDirectory, signal);
      if (!dependencies.codex.available)
        throw new Error(
          "Codex is required to organize sentences. Install Codex, sign in, and try again.",
        );
      for (const [index, track] of takes.entries()) {
        if (!track.transcript || track.transcript.model !== project.model) {
          report({
            phase: "transcribing",
            message: `Transcribing take ${index + 1} of ${takes.length}…`,
            trackId: track.id,
            fraction: index / takes.length,
          });
          track.transcript = await transcribe(
            track,
            media.filename(track.id),
            cacheDirectory,
            project.model,
            (p: OperationProgress) => report({ ...p, trackId: track.id }),
            signal,
          );
        }
      }
      for (const track of takes) {
        if (
          !track.transcript?.segments.some((segment) =>
            /[\p{L}\p{N}]/u.test(segment.text),
          )
        )
          throw new Error(
            "No spoken dialogue was found. The first source must be a voiceover recording.",
          );
      }
      const alignment = await alignTranscripts(
        takes,
        cacheDirectory,
        report,
        signal,
        project.codex,
      );
      const result = applyAlignment(project, alignment);
      await remember(result);
      return result;
    }, project.id);
  });
  handle("studio:save", (value: unknown, saveAs: unknown) => {
    if (typeof saveAs !== "boolean") throw new Error("Invalid save option.");
    const project = checkedProject(value);
    return withFileOperation(
      (signal) => saveProject(project, saveAs, signal),
      project.id,
    );
  });
  handle("studio:open", openProject);
  handle("studio:restore", async () => {
    try {
      currentProject = checkedProject(
        JSON.parse(await readFile(autosaveFile, "utf8")),
      );
      return currentProject;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error(
        "The last session could not be restored. Open your saved .mixstudio project to recover its audio.",
      );
    }
  });
  handle("studio:autosave", async (value: unknown) =>
    remember(checkedProject(value)),
  );
  handle("studio:restoreWorkspace", async () => {
    workspaceMode = true;
    try {
      return await workspace.restore();
    } catch {
      throw new Error(
        "Your workspace could not be restored. Your saved files are unchanged; open a .mixstudio project to recover its audio.",
      );
    }
  });
  handle("studio:autosaveWorkspace", async (value: unknown) => {
    if (closing) throw new Error("The studio is closing.");
    // Validation occurs synchronously before the store adopts or queues it.
    const pending = workspace.save(value);
    workspaceMode = true;
    currentProject = workspace.activeProject();
    return pending;
  });
  handle("studio:setTheme", async (value: unknown) => {
    const theme = checkedTheme(value);
    nativeTheme.themeSource = theme;
    window?.setBackgroundColor(themeBackground(theme));
    await workspace.setTheme(theme);
  });
  handle("studio:export", (value: unknown, format: unknown) => {
    const project = checkedProject(value);
    if (format !== "wav" && format !== "mp3")
      throw new Error("Choose WAV or MP3 export.");
    if (!mixRenderClips(project).length)
      throw new Error("Choose at least one sentence to export.");
    return withFileOperation(async (signal, report) => {
      const result = await dialog.showSaveDialog(window!, {
        title: "Export master audio",
        defaultPath: `${safeName(project.name)}.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
        properties: ["createDirectory", "showOverwriteConfirmation"],
      });
      if (result.canceled || !result.filePath) return null;
      const filename = result.filePath.toLowerCase().endsWith(`.${format}`)
        ? result.filePath
        : `${result.filePath}.${format}`;
      report({
        phase: "exporting",
        message: "Rendering your master…",
        fraction: 0,
      });
      await renderMix(media, project, filename, format, {
        signal,
        onProgress: (fraction) =>
          report({
            phase: "exporting",
            message: "Rendering your master…",
            fraction,
          }),
      });
      signal.throwIfAborted();
      await preferences.recordSuccessfulExport();
      return filename;
    }, project.id);
  });
  handle("studio:alignment", async (value: unknown) => {
    const project = checkedProject(value);
    return withFileOperation(async (signal) => {
      const result = await dialog.showSaveDialog(window!, {
        title: "Export sentence alignment",
        defaultPath: `${safeName(project.name)}-alignment.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (result.canceled || !result.filePath) return null;
      if (signal.aborted) throw new Error("Operation cancelled.");
      await atomicJSON(result.filePath, {
        version: 1,
        name: project.name,
        tracks: project.tracks.map(({ id, name, duration, transcript }) => ({
          id,
          name,
          duration,
          transcript,
        })),
        groups: project.groups,
        segments: project.segments,
        master: masterClips(project),
      });
      return result.filePath;
    }, project.id);
  });
  handle("studio:demo", demoProject);
  handle("studio:external", async (target: unknown) => {
    const links = {
      codex: "https://developers.openai.com/codex/cli/",
      ffmpeg: "https://ffmpeg.org/download.html",
      whisperx: "https://github.com/m-bain/whisperX",
      soundtouch: "https://www.surina.net/soundtouch/",
      "epidemic-key": "https://www.epidemicsound.com/account/api-keys",
      "epidemic-docs": "https://developers.epidemicsound.com/docs/mcp/",
    };
    if (typeof target !== "string" || !Object.hasOwn(links, target))
      throw new Error("Unknown dependency.");
    await shell.openExternal(links[target as keyof typeof links]);
  });
}

function themeBackground(theme: StudioTheme) {
  return theme === "dark" ||
    (theme === "system" && nativeTheme.shouldUseDarkColors)
    ? "#141b18"
    : "#f7f8f6";
}

async function createWindow() {
  window = new BrowserWindow({
    title: "Audio Mix Studio",
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: themeBackground(nativeTheme.themeSource),
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 17 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  void window.webContents.setVisualZoomLevelLimits(1, 1);
  window.webContents.on("will-navigate", (event, url) => {
    if (
      devURL
        ? new URL(url).origin !== new URL(devURL).origin
        : url !== pathToFileURL(indexFile).href
    )
      event.preventDefault();
  });
  window.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  window.once("ready-to-show", () => window?.show());
  window.on("closed", () => {
    window = null;
  });
  await (devURL ? window.loadURL(devURL) : window.loadFile(indexFile));
}
function createMenu() {
  const shortcut = (command: string) => () =>
    window?.webContents.send("studio:shortcut", command);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      {
        label: "File",
        submenu: [
          {
            label: "New mix",
            accelerator: "CmdOrCtrl+N",
            click: shortcut("new"),
          },
          {
            label: "Close tab",
            accelerator: "CmdOrCtrl+W",
            click: shortcut("close-tab"),
          },
          {
            label: "Reopen closed tab",
            accelerator: "CmdOrCtrl+Shift+T",
            click: shortcut("reopen-tab"),
          },
          {
            label: "Add audio…",
            accelerator: "CmdOrCtrl+I",
            click: shortcut("import"),
          },
          {
            label: "Open project…",
            accelerator: "CmdOrCtrl+O",
            click: shortcut("open"),
          },
          {
            label: "Save project",
            accelerator: "CmdOrCtrl+S",
            click: shortcut("save"),
          },
          {
            label: "Save project as…",
            accelerator: "CmdOrCtrl+Shift+S",
            click: shortcut("saveAs"),
          },
          { type: "separator" },
          {
            label: "Export master…",
            accelerator: "CmdOrCtrl+E",
            click: shortcut("export"),
          },
        ],
      },
      {
        label: "Edit",
        submenu: [
          {
            label: "Undo",
            accelerator: "CmdOrCtrl+Z",
            click: shortcut("undo"),
          },
          {
            label: "Redo",
            accelerator: "CmdOrCtrl+Shift+Z",
            click: shortcut("redo"),
          },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "View",
        submenu: [
          {
            label: "Reset timeline zoom",
            accelerator: "CmdOrCtrl+0",
            click: shortcut("timeline-zoom-reset"),
          },
          {
            label: "Zoom in timeline",
            accelerator: "CmdOrCtrl+Plus",
            click: shortcut("timeline-zoom-in"),
          },
          {
            label: "Zoom out timeline",
            accelerator: "CmdOrCtrl+-",
            click: shortcut("timeline-zoom-out"),
          },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      {
        label: "Window",
        submenu: [
          {
            label: "Next tab",
            accelerator: "CmdOrCtrl+Shift+]",
            click: shortcut("next-tab"),
          },
          {
            label: "Previous tab",
            accelerator: "CmdOrCtrl+Shift+[",
            click: shortcut("previous-tab"),
          },
          { type: "separator" },
          { role: "minimize" },
          { role: "zoom" },
          { role: "front" },
        ],
      },
    ]),
  );
}

app
  .whenReady()
  .then(async () => {
    const root = app.getPath("userData");
    cacheDirectory = path.join(root, "transcription");
    autosaveFile = path.join(root, "last-session.json");
    await mkdir(cacheDirectory, { recursive: true });
    media = new MediaStore(root);
    await media.initialize();
    preferences = new PreferencesStore(root);
    epidemic = new EpidemicService(root, media, {
      available: () => safeStorage.isEncryptionAvailable(),
      encrypt: (value) => safeStorage.encryptString(value),
      decrypt: (value) => safeStorage.decryptString(value),
    });
    await epidemic.initialize();
    workspace = new WorkspaceStore(
      root,
      checkedProject,
      atomicJSON,
      undefined,
      restorableProject,
    );
    try {
      const remembered = await workspace.restore();
      if (remembered) {
        nativeTheme.themeSource = remembered.theme;
        currentProject =
          remembered.projects.find(
            (project) => project.id === remembered.activeProjectId,
          ) || null;
      }
    } catch {
      // The renderer offers recovery without preventing the app from opening.
    }
    nativeTheme.on("updated", () => {
      window?.setBackgroundColor(themeBackground(nativeTheme.themeSource));
    });
    protocol.handle("mixmedia", async (request) => {
      try {
        const url = new URL(request.url);
        const id = url.pathname.slice(1);
        if (
          url.host !== "audio" ||
          url.search ||
          url.hash ||
          (!media.has(id) && !epidemic.previewFile(id)) ||
          !["GET", "HEAD"].includes(request.method)
        )
          return new Response("Not found", { status: 404 });
        const filename = media.has(id)
          ? media.filename(id)
          : epidemic.previewFile(id)!;
        const size = (await stat(filename)).size;
        const range = byteRange(request.headers.get("range"), size);
        if (!range)
          return new Response(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${size}` },
          });
        const headers = {
          "Content-Type": media.has(id) ? "audio/wav" : "audio/mpeg",
          "Accept-Ranges": "bytes",
          "Content-Length": String(range.end - range.start + 1),
          "Cache-Control": "private, max-age=31536000, immutable",
          ...(range.partial
            ? { "Content-Range": `bytes ${range.start}-${range.end}/${size}` }
            : {}),
        };
        return new Response(
          request.method === "HEAD"
            ? null
            : (Readable.toWeb(
                createReadStream(filename, {
                  start: range.start,
                  end: range.end,
                }),
              ) as ReadableStream),
          { status: range.partial ? 206 : 200, headers },
        );
      } catch {
        return new Response("Not found", { status: 404 });
      }
    });
    registerIPC();
    createMenu();
    await createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  })
  .catch((error) => {
    dialog.showErrorBox("Could not start Audio Mix Studio", error.message);
    app.quit();
  });
app.on("window-all-closed", () => {
  operation?.abort();
  fileOperations.cancel();
  app.quit();
});
app.on("before-quit", (event) => {
  if (readyToQuit) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  closing = true;
  previewQueue.splice(0).forEach((resolve) => resolve());
  operation?.abort();
  fileOperations.cancel();
  previewControllers.forEach((controller) => controller.abort());
  epidemic?.shutdown();
  // Give cancelled child processes time to exit, then flush the latest edit before quitting.
  const processes = Promise.allSettled([
    operationCompletion,
    fileOperations.flush(),
    ...previewTasks,
  ]);
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5000));
  const cleanup = Promise.all([
    Promise.race([processes, timeout]),
    persistenceQueue.catch(() => undefined),
    workspace?.flush().catch(() => undefined),
    preferences?.flush().catch(() => undefined),
    epidemic?.flush().catch(() => undefined),
  ]);
  void cleanup
    .catch(() => undefined)
    .finally(() => {
      readyToQuit = true;
      app.quit();
    });
});
