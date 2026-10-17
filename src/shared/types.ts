export const transcriptionModels = [
  "tiny",
  "base",
  "small",
  "medium",
  "large-v3",
  "large-v3-turbo",
] as const;
export type TranscriptionModel = (typeof transcriptionModels)[number];
export interface TimedText {
  start: number;
  end: number;
  text: string;
}
export interface Transcript {
  model: string;
  language: string | null;
  segments: TimedText[];
  words: TimedText[];
}
export interface AudioTrack {
  id: string;
  name: string;
  duration: number;
  color: string;
  peaks: number[];
  mediaUrl: string;
  transcript?: Transcript;
}
export interface AudioSegment {
  id: string;
  trackId: string;
  groupId: string;
  start: number;
  end: number;
  text: string;
  enabled: boolean;
}
export interface SentenceGroup {
  id: string;
  text: string;
  note: string;
  segmentIds: string[];
  speed?: number;
}
export interface JointSettings {
  pauseMs: number;
  fadeOutMs: number;
  fadeInMs: number;
}
export interface CodexModelInfo {
  id: string;
  name: string;
  description: string;
  reasoning: string[];
  defaultReasoning: string;
  isDefault: boolean;
  fast: boolean;
}
export interface CodexSelection {
  model: string;
  reasoning: string;
  fast: boolean;
}
export interface StudioPreferences {
  hasExportedMaster: boolean;
}
export interface MixProject {
  version: 1;
  id: string;
  name: string;
  tracks: AudioTrack[];
  groups: SentenceGroup[];
  segments: AudioSegment[];
  model: TranscriptionModel;
  joinFadeMs: number;
  audioSchema?: 2;
  jointDefaults?: JointSettings;
  jointOverrides?: Record<string, Partial<JointSettings>>;
  codex?: CodexSelection;
  updatedAt: string;
}
export type StudioTheme = "light" | "dark" | "system";
export interface WorkspaceSession {
  version: 1;
  projects: MixProject[];
  activeProjectId: string;
  theme: StudioTheme;
  closedProjects?: MixProject[];
}
export interface MasterClip extends AudioSegment {
  offset: number;
  duration: number;
  sourceDuration?: number;
  speed?: number;
  pauseBeforeMs?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
}
export interface AnalysisGroup {
  text: string;
  note: string;
  variations: { trackId: string; start: number; end: number; text: string }[];
}
export interface AlignmentResult {
  groups: AnalysisGroup[];
}
export interface DependencyStatus {
  codex: { available: boolean; path?: string; detail: string };
  ffmpeg: { available: boolean; path?: string; detail: string };
  whisperx: { available: boolean; path?: string; detail: string };
  models: { id: TranscriptionModel; downloaded: boolean }[];
}
export interface OperationProgress {
  projectId?: string;
  phase:
    | "importing"
    | "installing"
    | "downloading"
    | "transcribing"
    | "aligning"
    | "grouping"
    | "exporting";
  message: string;
  fraction?: number;
  trackId?: string;
}
export interface StudioAPI {
  preferences(): Promise<StudioPreferences>;
  codexModels(): Promise<CodexModelInfo[]>;
  restoreWorkspace(): Promise<WorkspaceSession | null>;
  autosaveWorkspace(session: WorkspaceSession): Promise<void>;
  setTheme(theme: StudioTheme): Promise<void>;
  dependencies(): Promise<DependencyStatus>;
  importAudio(projectId?: string): Promise<AudioTrack[]>;
  importPaths(paths: string[], projectId?: string): Promise<AudioTrack[]>;
  audioSlice(
    trackId: string,
    start: number,
    end: number,
    speed?: number,
  ): Promise<ArrayBuffer>;
  pathForFile(file: File): string;
  analyze(project: MixProject): Promise<MixProject>;
  setupTranscription(
    model: TranscriptionModel,
    projectId?: string,
  ): Promise<DependencyStatus>;
  cancel(projectId?: string): Promise<void>;
  saveProject(project: MixProject, saveAs?: boolean): Promise<string | null>;
  openProject(projectId?: string): Promise<MixProject | null>;
  restoreProject(): Promise<MixProject | null>;
  autosave(project: MixProject): Promise<void>;
  exportAudio(
    project: MixProject,
    format: "wav" | "mp3",
  ): Promise<string | null>;
  exportAlignment(project: MixProject): Promise<string | null>;
  demoProject(projectId?: string): Promise<MixProject>;
  openExternal(target: "codex" | "ffmpeg" | "whisperx"): Promise<void>;
  onProgress(
    listener: (progress: OperationProgress | null) => void,
  ): () => void;
}
declare global {
  interface Window {
    studio: StudioAPI;
  }
}
