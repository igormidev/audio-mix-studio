import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  StudioAPI,
  OperationProgress,
  MixProject,
  TranscriptionModel,
} from "../src/shared/types";

const api: StudioAPI = {
  dependencies: () => ipcRenderer.invoke("studio:dependencies"),
  importAudio: () => ipcRenderer.invoke("studio:import"),
  importPaths: (paths: string[]) =>
    ipcRenderer.invoke("studio:importPaths", paths),
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  audioSlice: (trackId: string, start: number, end: number) =>
    ipcRenderer.invoke("studio:audioSlice", trackId, start, end),
  analyze: (project: MixProject) =>
    ipcRenderer.invoke("studio:analyze", project),
  setupTranscription: (model: TranscriptionModel) =>
    ipcRenderer.invoke("studio:setup", model),
  cancel: () => ipcRenderer.invoke("studio:cancel"),
  saveProject: (project: MixProject, saveAs?: boolean) =>
    ipcRenderer.invoke("studio:save", project, !!saveAs),
  openProject: () => ipcRenderer.invoke("studio:open"),
  restoreProject: () => ipcRenderer.invoke("studio:restore"),
  autosave: (project: MixProject) =>
    ipcRenderer.invoke("studio:autosave", project),
  exportAudio: (project: MixProject, format: "wav" | "mp3") =>
    ipcRenderer.invoke("studio:export", project, format),
  exportAlignment: (project: MixProject) =>
    ipcRenderer.invoke("studio:alignment", project),
  demoProject: () => ipcRenderer.invoke("studio:demo"),
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
    ].includes(command)
  )
    window.dispatchEvent(
      new CustomEvent("studio-shortcut", { detail: command }),
    );
});
