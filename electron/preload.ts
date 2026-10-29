import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  StudioAPI,
  OperationProgress,
  MixProject,
  TranscriptionModel,
  WorkspaceSession,
  StudioTheme,
} from "../src/shared/types";

const api: StudioAPI = {
  epidemicStatus: () => ipcRenderer.invoke("studio:epidemicStatus"),
  epidemicConnect: (key, requestId) =>
    ipcRenderer.invoke("studio:epidemicConnect", key, requestId),
  epidemicDisconnect: () => ipcRenderer.invoke("studio:epidemicDisconnect"),
  epidemicCatalog: () => ipcRenderer.invoke("studio:epidemicCatalog"),
  epidemicSearch: (request, requestId) =>
    ipcRenderer.invoke("studio:epidemicSearch", request, requestId),
  epidemicPreview: (request, requestId) =>
    ipcRenderer.invoke("studio:epidemicPreview", request, requestId),
  epidemicImport: (request, projectId, requestId) =>
    ipcRenderer.invoke("studio:epidemicImport", request, projectId, requestId),
  epidemicCancel: (requestId) =>
    ipcRenderer.invoke("studio:epidemicCancel", requestId),
  preferences: () => ipcRenderer.invoke("studio:preferences"),
  codexModels: () => ipcRenderer.invoke("studio:codexModels"),
  restoreWorkspace: () => ipcRenderer.invoke("studio:restoreWorkspace"),
  autosaveWorkspace: (session: WorkspaceSession) =>
    ipcRenderer.invoke("studio:autosaveWorkspace", session),
  setTheme: (theme: StudioTheme) =>
    ipcRenderer.invoke("studio:setTheme", theme),
  dependencies: () => ipcRenderer.invoke("studio:dependencies"),
  importAudio: (projectId?: string) =>
    ipcRenderer.invoke("studio:import", projectId),
  importPaths: (paths: string[], projectId?: string) =>
    ipcRenderer.invoke("studio:importPaths", paths, projectId),
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  audioSlice: (
    trackId: string,
    start: number,
    end: number,
    speed?: number,
    logicalSource?: { start: number; end: number },
    projectId?: string,
  ) =>
    ipcRenderer.invoke(
      "studio:audioSlice",
      trackId,
      start,
      end,
      speed,
      logicalSource,
      projectId,
    ),
  mixSlice: (project, start, end) =>
    ipcRenderer.invoke("studio:mixSlice", project, start, end),
  cancelPlayback: (projectId) =>
    ipcRenderer.invoke("studio:cancelPlayback", projectId),
  analyze: (project: MixProject) =>
    ipcRenderer.invoke("studio:analyze", project),
  setupTranscription: (model: TranscriptionModel, projectId?: string) =>
    ipcRenderer.invoke("studio:setup", model, projectId),
  cancel: (projectId?: string) =>
    ipcRenderer.invoke("studio:cancel", projectId),
  saveProject: (project: MixProject, saveAs?: boolean) =>
    ipcRenderer.invoke("studio:save", project, !!saveAs),
  openProject: (projectId?: string) =>
    ipcRenderer.invoke("studio:open", projectId),
  restoreProject: () => ipcRenderer.invoke("studio:restore"),
  autosave: (project: MixProject) =>
    ipcRenderer.invoke("studio:autosave", project),
  exportAudio: (project: MixProject, format: "wav" | "mp3") =>
    ipcRenderer.invoke("studio:export", project, format),
  exportAlignment: (project: MixProject) =>
    ipcRenderer.invoke("studio:alignment", project),
  demoProject: (projectId?: string) =>
    ipcRenderer.invoke("studio:demo", projectId),
  openExternal: (
    target:
      | "codex"
      | "ffmpeg"
      | "whisperx"
      | "soundtouch"
      | "epidemic-key"
      | "epidemic-docs",
  ) => ipcRenderer.invoke("studio:external", target),
  onProgress(listener: (progress: OperationProgress | null) => void) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: OperationProgress | null,
    ) => listener(progress);
    ipcRenderer.on("studio:progress", handler);
    return () => {
      ipcRenderer.removeListener("studio:progress", handler);
    };
  },
};
contextBridge.exposeInMainWorld("studio", api);
ipcRenderer.on("studio:shortcut", (_event, command: string) => {
  if (
    [
      "new",
      "import",
      "open",
      "save",
      "saveAs",
      "export",
      "undo",
      "redo",
      "close-tab",
      "reopen-tab",
      "next-tab",
      "previous-tab",
      "timeline-zoom-reset",
      "timeline-zoom-in",
      "timeline-zoom-out",
    ].includes(command)
  )
    window.dispatchEvent(
      new CustomEvent("studio-shortcut", { detail: command }),
    );
});
