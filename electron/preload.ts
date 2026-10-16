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
  audioSlice: (trackId: string, start: number, end: number) =>
    ipcRenderer.invoke("studio:audioSlice", trackId, start, end),
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
  openExternal: (target: "codex" | "ffmpeg" | "whisperx") =>
    ipcRenderer.invoke("studio:external", target),
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
    ].includes(command)
  )
    window.dispatchEvent(
      new CustomEvent("studio-shortcut", { detail: command }),
    );
});
