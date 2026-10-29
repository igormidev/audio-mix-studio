import type { AudioTrack } from "./types";

export type EpidemicKind = "music" | "soundtrack";
export type EpidemicStem = "FULL" | "BASS" | "DRUMS" | "INSTRUMENTS";
export type EpidemicMatch = "ALL" | "ANY" | "NOT_ANY";
export interface EpidemicConnection {
  connected: boolean;
  verifiedAt?: string;
  secureStorage: boolean;
}
export interface EpidemicOption {
  label: string;
  value: string;
}
export interface EpidemicCatalog {
  genres: EpidemicOption[];
  moods: EpidemicOption[];
  instruments: EpidemicOption[];
  soundEffects: EpidemicOption[];
  musicalKeys?: EpidemicOption[];
  decades?: EpidemicOption[];
  countries?: EpidemicOption[];
  themes: EpidemicOption[];
  fetchedAt: string;
  sources: string[];
}
export interface EpidemicSearchRequest {
  kind: EpidemicKind;
  term?: string;
  topic?: string;
  after?: string;
  first?: number;
  sort?: "RELEVANCE" | "POPULARITY" | "DATE" | "DURATION" | "TITLE" | "BPM";
  order?: "ASCENDING" | "DESCENDING";
  genres?: string[];
  moods?: string[];
  instruments?: string[];
  musicalKeys?: string[];
  decades?: string[];
  countries?: string[];
  tags?: string[];
  artistSlugs?: string[];
  vocals?: "any" | "instrumental" | "vocals";
  bpmMin?: number;
  bpmMax?: number;
  durationMin?: number;
  durationMax?: number;
  similarToId?: string;
  reference?: string;
  taxonomyMatch?: EpidemicMatch;
  moodMatch?: EpidemicMatch;
  instrumentMatch?: EpidemicMatch;
  tagMatch?: EpidemicMatch;
  artistMatch?: EpidemicMatch;
}
export interface EpidemicResult {
  id: string;
  kind: EpidemicKind;
  title: string;
  artists: string[];
  artistFilters?: EpidemicOption[];
  duration: number;
  bpm?: number;
  coverArtUrl?: string;
  tags: { label: string; dimension: string; slug?: string }[];
  stems: EpidemicStem[];
}
export interface EpidemicSearchPage {
  items: EpidemicResult[];
  total: number | null;
  hasNextPage: boolean;
  endCursor: string | null;
}
export interface EpidemicAssetRequest {
  id: string;
  kind: EpidemicKind;
  stem?: EpidemicStem;
  format?: "WAV" | "MP3";
}
export interface EpidemicAPI {
  epidemicStatus(): Promise<EpidemicConnection>;
  epidemicConnect(key: string, requestId: string): Promise<EpidemicConnection>;
  epidemicDisconnect(): Promise<void>;
  epidemicCatalog(): Promise<EpidemicCatalog>;
  epidemicSearch(
    request: EpidemicSearchRequest,
    requestId: string,
  ): Promise<EpidemicSearchPage>;
  epidemicPreview(
    request: EpidemicAssetRequest,
    requestId: string,
  ): Promise<AudioTrack>;
  epidemicImport(
    request: EpidemicAssetRequest,
    projectId: string,
    requestId: string,
  ): Promise<AudioTrack>;
  epidemicCancel(requestId: string): Promise<void>;
}
