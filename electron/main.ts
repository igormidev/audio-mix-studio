import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  shell,
  nativeTheme,
} from "electron";
import { readFile, mkdir, lstat, stat, rename, rm } from "node:fs/promises";
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
} from "../src/shared/types";
import { transcriptionModels } from "../src/shared/types";
import {
  newProject,
  appendTracks,
  masterClips,
  applyAlignment,
  parseProject,
} from "../src/domain/project";
import {
  checkDependencies,
  setupTranscription,
  transcribe,
  alignTranscripts,
} from "./integrations/index";
import {
  MediaStore,
  AUDIO_EXTENSIONS,
  atomicJSON,
  byteRange,
  createReadStream,
  renderMaster,
  runProcess,
  findBinary,
  decodeAudioSlice,
} from "./media";

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
let currentProject: MixProject | null = null;
let persistenceQueue: Promise<void> = Promise.resolve();
let quitting = false;
let readyToQuit = false;
let closing = false;
let operation: AbortController | null = null;
let operationCompletion: Promise<unknown> | null = null;
const projectPaths = new Map<string, string>();
const previewControllers = new Set<AbortController>();
const previewTasks = new Set<Promise<ArrayBuffer>>();
const previewQueue: (() => void)[] = [];
let activePreviews = 0;
const devURL = process.env.VITE_DEV_SERVER_URL;
const indexFile = path.resolve(__dirname, "../dist/index.html");

function progress(value: OperationProgress | null) {
  if (window && !window.isDestroyed())
    window.webContents.send("studio:progress", value);
}
async function withOperation<T>(action: (signal: AbortSignal) => Promise<T>) {
  if (operation)
    throw new Error(
      "An operation is already running. Wait for it to finish or cancel it first.",
    );
  const controller = new AbortController();
  operation = controller;
  const task = (async () => {
    try {
      return await action(controller.signal);
    } finally {
      if (operation === controller) operation = null;
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
function checkedModel(model: unknown): TranscriptionModel {
  if (!transcriptionModels.includes(model as TranscriptionModel))
    throw new Error("Select a supported transcription model.");
  return model as TranscriptionModel;
}
function remember(project: MixProject): Promise<void> {
  currentProject = project;
  persistenceQueue = persistenceQueue
    .catch(() => undefined)
    .then(() => atomicJSON(autosaveFile, project));
  return persistenceQueue;
}
async function importFiles(paths: unknown): Promise<AudioTrack[]> {
  if (
    !Array.isArray(paths) ||
    !paths.length ||
    paths.length > 50 ||
    paths.some((p) => typeof p !== "string")
  )
    throw new Error("Choose between 1 and 50 audio files.");
  return withOperation(async (signal) => {
    const tracks: AudioTrack[] = [];
    for (const [index, file] of paths.entries()) {
      tracks.push(
        await media.importAudio(file, {
          signal,
          colorIndex: (currentProject?.tracks.length || 0) + index,
          onProgress: (p) => progress({ ...p, fraction: index / paths.length }),
        }),
      );
    }
    return tracks;
  });
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
  await atomicJSON(filename, {
    format: "audio-mix-studio",
    version: 1,
    project,
    assets,
  });
  projectPaths.set(project.id, filename);
  await remember(project);
  return filename;
}
async function openProject() {
  if (operation)
    throw new Error(
      "Wait for the current operation to finish or cancel it first.",
    );
  const choice = await dialog.showOpenDialog(window!, {
    title: "Open a mix project",
    properties: ["openFile"],
    filters: [{ name: "Audio Mix Studio project", extensions: ["mixstudio"] }],
  });
  if (choice.canceled || !choice.filePaths[0]) return null;
  const filename = choice.filePaths[0];
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
  return withOperation(async (signal) => {
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
        onProgress: progress,
      });
      idMap.set(track.id, cached.id);
      imported.push({ ...cached, transcript: track.transcript });
    }
    project.tracks = imported;
    project.segments = project.segments.map((segment) => ({
      ...segment,
      trackId: idMap.get(segment.trackId)!,
    }));
    const checked = checkedProject(project);
    projectPaths.set(checked.id, filename);
    await remember(checked);
    return checked;
  });
}

async function demoProject(): Promise<MixProject> {
  return withOperation(async (signal) => {
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
          progress({
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
  });
}

function registerIPC() {
  handle("studio:dependencies", () => checkDependencies(cacheDirectory));
  handle("studio:import", async () => {
    if (operation)
      throw new Error(
        "Wait for the current operation to finish or cancel it first.",
      );
    const result = await dialog.showOpenDialog(window!, {
      title: "Add voice takes",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Audio files", extensions: AUDIO_EXTENSIONS }],
    });
    return result.canceled ? [] : importFiles(result.filePaths);
  });
  handle("studio:importPaths", importFiles);
  handle(
    "studio:audioSlice",
    async (id: unknown, start: unknown, end: unknown) => {
      if (closing) throw new Error("The studio is closing.");
      if (
        typeof id !== "string" ||
        typeof start !== "number" ||
        typeof end !== "number"
      )
        throw new Error("Invalid preview request.");
      if (previewQueue.length >= 12)
        throw new Error("Preview is busy. Try again in a moment.");
      if (activePreviews >= 2)
        await new Promise<void>((resolve) => previewQueue.push(resolve));
      if (closing) throw new Error("The studio is closing.");
      activePreviews++;
      const controller = new AbortController();
      previewControllers.add(controller);
      const task = decodeAudioSlice(media, id, start, end, controller.signal);
      previewTasks.add(task);
      try {
        return await task;
      } finally {
        previewTasks.delete(task);
        previewControllers.delete(controller);
        activePreviews--;
        previewQueue.shift()?.();
      }
    },
  );
  handle("studio:cancel", () => {
    operation?.abort();
  });
  handle("studio:setup", (value: unknown) =>
    withOperation(async (signal) => {
      await setupTranscription(
        cacheDirectory,
        checkedModel(value),
        progress,
        signal,
      );
      return checkDependencies(cacheDirectory);
    }),
  );
  handle("studio:analyze", (value: unknown) =>
    withOperation(async (signal) => {
      const project = checkedProject(value);
      if (!project.tracks.length)
        throw new Error("Add audio before analyzing.");
      const dependencies = await checkDependencies(cacheDirectory);
      if (!dependencies.codex.available)
        throw new Error(
          "Codex is required to organize sentences. Install Codex, sign in, and try again.",
        );
      for (const [index, track] of project.tracks.entries()) {
        if (!track.transcript || track.transcript.model !== project.model) {
          progress({
            phase: "transcribing",
            message: `Transcribing take ${index + 1} of ${project.tracks.length}…`,
            trackId: track.id,
            fraction: index / project.tracks.length,
          });
          track.transcript = await transcribe(
            track,
            media.filename(track.id),
            cacheDirectory,
            project.model,
            (p: OperationProgress) => progress({ ...p, trackId: track.id }),
            signal,
          );
        }
      }
      const alignment = await alignTranscripts(
        project.tracks,
        cacheDirectory,
        progress,
        signal,
      );
      const result = applyAlignment(project, alignment);
      await remember(result);
      return result;
    }),
  );
  handle("studio:save", (value: unknown, saveAs: unknown) => {
    if (typeof saveAs !== "boolean") throw new Error("Invalid save option.");
    return withOperation((signal) => saveProject(value, saveAs, signal));
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
  handle("studio:export", (value: unknown, format: unknown) => {
    const project = checkedProject(value);
    if (format !== "wav" && format !== "mp3")
      throw new Error("Choose WAV or MP3 export.");
    if (!masterClips(project).length)
      throw new Error("Choose at least one sentence to export.");
    return withOperation(async (signal) => {
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
      progress({
        phase: "exporting",
        message: "Rendering your master…",
        fraction: 0,
      });
      await renderMaster(
        media,
        masterClips(project),
        filename,
        format,
        project.joinFadeMs,
        {
          signal,
          onProgress: (fraction) =>
            progress({
              phase: "exporting",
              message: "Rendering your master…",
              fraction,
            }),
        },
      );
      return filename;
    });
  });
  handle("studio:alignment", async (value: unknown) => {
    const project = checkedProject(value);
    const result = await dialog.showSaveDialog(window!, {
      title: "Export sentence alignment",
      defaultPath: `${safeName(project.name)}-alignment.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return null;
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
  });
  handle("studio:demo", demoProject);
  handle("studio:external", async (target: unknown) => {
    const links = {
      codex: "https://developers.openai.com/codex/cli/",
      ffmpeg: "https://ffmpeg.org/download.html",
      whisperx: "https://github.com/m-bain/whisperX",
    };
    if (typeof target !== "string" || !Object.hasOwn(links, target))
      throw new Error("Unknown dependency.");
    await shell.openExternal(links[target as keyof typeof links]);
  });
}

async function createWindow() {
  window = new BrowserWindow({
    title: "Audio Mix Studio",
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: "#f7f6f2",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 19, y: 19 },
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
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      {
        label: "Window",
        submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "front" }],
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
    protocol.handle("mixmedia", async (request) => {
      try {
        const url = new URL(request.url);
        const id = url.pathname.slice(1);
        if (
          url.host !== "audio" ||
          url.search ||
          url.hash ||
          !media.has(id) ||
          !["GET", "HEAD"].includes(request.method)
        )
          return new Response("Not found", { status: 404 });
        const filename = media.filename(id);
        const size = (await stat(filename)).size;
        const range = byteRange(request.headers.get("range"), size);
        if (!range)
          return new Response(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${size}` },
          });
        const headers = {
          "Content-Type": "audio/wav",
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
  previewControllers.forEach((controller) => controller.abort());
  // Give cancelled child processes time to exit, then flush the latest edit before quitting.
  const processes = Promise.allSettled([operationCompletion, ...previewTasks]);
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5000));
  const cleanup = Promise.all([
    Promise.race([processes, timeout]),
    persistenceQueue.catch(() => undefined),
  ]);
  void cleanup
    .then(() =>
      currentProject && autosaveFile
        ? atomicJSON(autosaveFile, currentProject)
        : undefined,
    )
    .catch(() => undefined)
    .finally(() => {
      readyToQuit = true;
      app.quit();
    });
});
