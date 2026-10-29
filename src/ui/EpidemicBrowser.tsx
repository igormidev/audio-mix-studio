import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  AudioLines,
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  Headphones,
  KeyRound,
  Layers3,
  LoaderCircle,
  Music2,
  Pause,
  Play,
  RefreshCw,
  Search,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Volume2,
  Waves,
  X,
} from "lucide-react";
import type { AudioTrack } from "../shared/types";
import type {
  EpidemicCatalog,
  EpidemicConnection,
  EpidemicKind,
  EpidemicMatch,
  EpidemicOption,
  EpidemicResult,
  EpidemicSearchPage,
  EpidemicSearchRequest,
  EpidemicStem,
} from "../shared/epidemic";
import {
  EpidemicKeyForm,
  useEpidemicDialogFocus,
  epidemicErrorMessage,
} from "./EpidemicKeyDialog";
import { clock } from "./format";
import { Waveform } from "./Waveform";
import "./epidemic.css";

const emptyPage: EpidemicSearchPage = {
  items: [],
  total: null,
  hasNextPage: false,
  endCursor: null,
};
const stemNames: Record<EpidemicStem, string> = {
  FULL: "Full mix",
  BASS: "Bass",
  DRUMS: "Drums",
  INSTRUMENTS: "Instruments",
};
const sortNames = {
  RELEVANCE: "Relevance",
  POPULARITY: "Popularity",
  DATE: "Release date",
  DURATION: "Duration",
  TITLE: "Title",
  BPM: "Tempo",
} as const;
const initialFilters = (): Omit<EpidemicSearchRequest, "kind"> => ({
  sort: "POPULARITY",
  order: "DESCENDING",
  first: 24,
});
const cancellation = (failure: unknown) =>
  /cancel|abort/i.test(failure instanceof Error ? failure.message : "");
const message = epidemicErrorMessage;

export interface EpidemicBrowserProps {
  initialKind: EpidemicKind;
  projectId: string;
  active: boolean;
  canImport: boolean;
  onClose: () => void;
  onSelect: (track: AudioTrack, kind: EpidemicKind) => void;
  onBusyChange?: (busy: boolean) => void;
}

export function EpidemicBrowser({
  initialKind,
  projectId,
  active,
  canImport,
  onClose,
  onSelect,
  onBusyChange,
}: EpidemicBrowserProps) {
  const [kind, setKind] = useState<EpidemicKind>(initialKind);
  const [connection, setConnection] = useState<EpidemicConnection | null>(null);
  const [connectionRevision, setConnectionRevision] = useState(0);
  const [editingKey, setEditingKey] = useState(false);
  const [catalog, setCatalog] = useState<EpidemicCatalog | null>(null);
  const [filters, setFilters] =
    useState<Omit<EpidemicSearchRequest, "kind">>(initialFilters);
  const [queryMode, setQueryMode] = useState<"term" | "topic" | "reference">(
    "term",
  );
  const [queryText, setQueryText] = useState("");
  const [query, setQuery] = useState<
    Pick<EpidemicSearchRequest, "term" | "topic" | "reference">
  >({});
  const [similarTitle, setSimilarTitle] = useState("");
  const [page, setPage] = useState<EpidemicSearchPage>(emptyPage);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [format, setFormat] = useState<"WAV" | "MP3">("WAV");
  const [stems, setStems] = useState<Record<string, EpidemicStem>>({});
  const [preview, setPreview] = useState<{
    item: EpidemicResult;
    track: AudioTrack;
    stem: EpidemicStem;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState<EpidemicResult | null>(
    null,
  );
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(0.8);
  const [downloading, setDownloading] = useState<EpidemicResult | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);
  const modal = useRef<HTMLElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const resultScroll = useRef<HTMLDivElement>(null);
  const searchRequest = useRef<string | null>(null);
  const moreRequest = useRef<string | null>(null);
  const previewRequest = useRef<string | null>(null);
  const importRequest = useRef<string | null>(null);
  const previewGeneration = useRef(0);
  const autostartedPreview = useRef<typeof preview>(null);
  const importGeneration = useRef(0);
  const live = useRef(true);
  const callbacks = useRef({ onSelect, onClose, onBusyChange });
  callbacks.current = { onSelect, onClose, onBusyChange };
  const orderLabels = {
    RELEVANCE: ["Best matches first", "Least relevant first"],
    POPULARITY: ["Most popular first", "Least popular first"],
    DATE: ["Newest first", "Oldest first"],
    DURATION: ["Longest first", "Shortest first"],
    TITLE: ["Z–A", "A–Z"],
    BPM: ["Fastest first", "Slowest first"],
  }[filters.sort ?? "POPULARITY"];
  const connected = Boolean(connection?.connected);
  const busy = Boolean(downloading) || keyBusy;

  const cancelRequest = (id: string | null) => {
    if (id) void window.studio.epidemicCancel(id).catch(() => undefined);
  };
  const stopPreview = useCallback(() => {
    previewGeneration.current++;
    if (previewRequest.current)
      void window.studio
        .epidemicCancel(previewRequest.current)
        .catch(() => undefined);
    previewRequest.current = null;
    audio.current?.pause();
    setPreviewLoading(null);
    setPlaying(false);
  }, []);
  const cancelImport = useCallback(() => {
    importGeneration.current++;
    if (importRequest.current)
      void window.studio
        .epidemicCancel(importRequest.current)
        .catch(() => undefined);
    importRequest.current = null;
    setDownloading(null);
    callbacks.current.onBusyChange?.(false);
  }, []);
  const close = useCallback(() => {
    stopPreview();
    cancelImport();
    callbacks.current.onClose();
  }, [stopPreview, cancelImport]);
  useEpidemicDialogFocus(modal, active, close);

  useEffect(() => {
    live.current = true;
    let current = true;
    const player = audio.current;
    void Promise.all([
      window.studio.epidemicStatus(),
      window.studio.epidemicCatalog(),
    ])
      .then(([status, options]) => {
        if (!current) return;
        setConnection(status);
        setCatalog(options);
      })
      .catch((failure) => {
        if (current) setError(message(failure));
      });
    const refresh = () => {
      void window.studio
        .epidemicStatus()
        .then((status) => {
          if (current) {
            setConnection(status);
            setConnectionRevision((value) => value + 1);
          }
        })
        .catch(() => undefined);
    };
    window.addEventListener("epidemic-connection-changed", refresh);
    return () => {
      current = false;
      live.current = false;
      window.removeEventListener("epidemic-connection-changed", refresh);
      for (const id of [
        searchRequest.current,
        moreRequest.current,
        previewRequest.current,
        importRequest.current,
      ])
        cancelRequest(id);
      player?.pause();
      if (importRequest.current) callbacks.current.onBusyChange?.(false);
    };
  }, []);
  useEffect(() => {
    if (!active) {
      stopPreview();
      cancelRequest(searchRequest.current);
      cancelRequest(moreRequest.current);
    }
  }, [active, stopPreview]);

  const request = useMemo<EpidemicSearchRequest>(() => {
    if (filters.similarToId)
      return { kind, similarToId: filters.similarToId, first: 24 };
    if (kind === "music") return { kind, ...filters, ...query };
    return {
      kind,
      first: 24,
      sort: filters.sort === "BPM" ? "POPULARITY" : filters.sort,
      order: filters.order,
      durationMin: filters.durationMin,
      durationMax: filters.durationMax,
      tags: filters.tags,
      tagMatch: filters.tagMatch,
      similarToId: filters.similarToId,
      term: query.term ?? query.topic,
    };
  }, [kind, filters, query]);
  useEffect(() => {
    if (!connected || !active || editingKey) return;
    let current = true;
    const id = crypto.randomUUID();
    searchRequest.current = id;
    cancelRequest(moreRequest.current);
    moreRequest.current = null;
    setLoadingMore(false);
    setLoading(true);
    setPage(emptyPage);
    setError("");
    stopPreview();
    setPreview(null);
    const timer = setTimeout(() => {
      void window.studio
        .epidemicSearch(request, id)
        .then((result) => {
          if (!current) return;
          setPage(result);
          resultScroll.current?.scrollTo({ top: 0 });
        })
        .catch((failure) => {
          if (current && !cancellation(failure)) setError(message(failure));
        })
        .finally(() => {
          if (current) {
            searchRequest.current = null;
            setLoading(false);
          }
        });
    }, 220);
    return () => {
      current = false;
      clearTimeout(timer);
      cancelRequest(id);
    };
  }, [request, connected, active, editingKey, connectionRevision, stopPreview]);

  useEffect(() => {
    const player = audio.current;
    if (
      !player ||
      !preview ||
      !active ||
      autostartedPreview.current === preview
    )
      return;
    autostartedPreview.current = preview;
    player.currentTime = 0;
    player.preservesPitch = true;
    player.playbackRate = rate;
    player.volume = volume;
    void player.play().catch(() => {
      if (live.current)
        setError("Could not play this preview. Try listening again.");
    });
    return () => player.pause();
    // Rate and volume have their own immediate controls; changing either must not restart playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, active]);

  const updateFilter = (patch: Partial<EpidemicSearchRequest>) =>
    setFilters((value) => ({ ...value, ...patch }));
  const clearFilters = () => {
    setFilters(initialFilters());
    setQuery({});
    setQueryText("");
    setSimilarTitle("");
  };
  const switchKind = (next: EpidemicKind) => {
    if (next === kind || busy) return;
    stopPreview();
    setPreview(null);
    setKind(next);
    setFilters(initialFilters());
    setQuery({});
    setQueryMode("term");
    setQueryText("");
    setSimilarTitle("");
    setPage(emptyPage);
  };
  const submitSearch = () => {
    const term = queryText.trim();
    setQuery(term ? { [kind === "music" ? queryMode : "term"]: term } : {});
    setFilters((value) => ({
      ...value,
      similarToId: undefined,
      sort: term ? "RELEVANCE" : "POPULARITY",
    }));
    setSimilarTitle("");
  };
  const chooseTheme = (label: string) => {
    setQueryText(label);
    setQueryMode("topic");
    setQuery({ topic: label });
    setFilters((value) => ({
      ...value,
      sort: "RELEVANCE",
      similarToId: undefined,
    }));
    setSimilarTitle("");
  };
  const more = async () => {
    if (!page.endCursor || loadingMore || loading || busy) return;
    const id = crypto.randomUUID();
    moreRequest.current = id;
    setLoadingMore(true);
    setError("");
    try {
      const next = await window.studio.epidemicSearch(
        { ...request, after: page.endCursor },
        id,
      );
      if (!live.current || moreRequest.current !== id) return;
      setPage((previous) => ({
        ...next,
        items: [
          ...previous.items,
          ...next.items.filter(
            (item) =>
              !previous.items.some((existing) => existing.id === item.id),
          ),
        ],
      }));
    } catch (failure) {
      if (live.current && moreRequest.current === id && !cancellation(failure))
        setError(message(failure));
    } finally {
      if (moreRequest.current === id) {
        moreRequest.current = null;
        setLoadingMore(false);
      }
    }
  };
  const listen = async (item: EpidemicResult) => {
    if (busy) return;
    const stem = stems[item.id] ?? "FULL";
    if (previewLoading?.id === item.id) {
      stopPreview();
      return;
    }
    if (preview?.item.id === item.id && preview.stem === stem) {
      if (playing) audio.current?.pause();
      else
        void audio.current
          ?.play()
          .catch(() => setError("Could not play this preview."));
      return;
    }
    stopPreview();
    const run = previewGeneration.current;
    const id = crypto.randomUUID();
    previewRequest.current = id;
    setPreviewLoading(item);
    setPreview(null);
    setPosition(0);
    setError("");
    try {
      const track = await window.studio.epidemicPreview(
        { id: item.id, kind: item.kind, stem },
        id,
      );
      if (!live.current || run !== previewGeneration.current) return;
      previewRequest.current = null;
      setPreviewLoading(null);
      setPosition(0);
      setPreview({ item, track, stem });
    } catch (failure) {
      if (
        live.current &&
        run === previewGeneration.current &&
        !cancellation(failure)
      )
        setError(message(failure));
    } finally {
      if (run === previewGeneration.current) {
        previewRequest.current = null;
        setPreviewLoading(null);
      }
    }
  };
  const importAudio = async (item: EpidemicResult) => {
    if (busy || !canImport) return;
    stopPreview();
    const id = crypto.randomUUID();
    const run = ++importGeneration.current;
    importRequest.current = id;
    setDownloading(item);
    setError("");
    callbacks.current.onBusyChange?.(true);
    try {
      const track = await window.studio.epidemicImport(
        {
          id: item.id,
          kind: item.kind,
          stem: stems[item.id] ?? "FULL",
          format,
        },
        projectId,
        id,
      );
      if (!live.current || run !== importGeneration.current) return;
      importRequest.current = null;
      setDownloading(null);
      callbacks.current.onBusyChange?.(false);
      callbacks.current.onSelect(track, item.kind);
    } catch (failure) {
      if (
        live.current &&
        run === importGeneration.current &&
        !cancellation(failure)
      )
        setError(message(failure));
    } finally {
      if (run === importGeneration.current && importRequest.current === id) {
        importRequest.current = null;
        setDownloading(null);
        callbacks.current.onBusyChange?.(false);
      }
    }
  };
  const seek = (time: number) => {
    if (!preview || !audio.current) return;
    const at = Math.max(0, Math.min(preview.track.duration, time));
    audio.current.currentTime = at;
    setPosition(at);
  };
  const chosenTags =
    kind === "music"
      ? [
          ...(filters.genres ?? []),
          ...(filters.moods ?? []),
          ...(filters.instruments ?? []),
          ...(filters.musicalKeys ?? []),
          ...(filters.decades ?? []),
          ...(filters.countries ?? []),
          ...(filters.artistSlugs ?? []),
        ]
      : (filters.tags ?? []);
  const filterCount =
    chosenTags.length +
    Number(filters.bpmMin !== undefined || filters.bpmMax !== undefined) +
    Number(
      filters.durationMin !== undefined || filters.durationMax !== undefined,
    ) +
    Number(filters.vocals !== undefined && filters.vocals !== "any");
  const discover =
    !query.term &&
    !query.topic &&
    !query.reference &&
    !filters.similarToId &&
    filterCount === 0;
  const featuredThemes = useMemo(() => {
    if (!catalog) return [];
    const names = [
      "Cinematic",
      "Documentary",
      "Horror & Thriller",
      "Motivational & Inspiring",
      "Nature",
      "Travel",
      "Podcast",
      "Technology",
    ];
    const preferred = names.flatMap((name) =>
      catalog.themes.filter((theme) => theme.label === name),
    );
    return [
      ...preferred,
      ...catalog.themes.filter(
        (theme) => !preferred.some((choice) => choice.value === theme.value),
      ),
    ].slice(0, 8);
  }, [catalog]);
  const otherThemes =
    catalog?.themes.filter(
      (theme) => !featuredThemes.some((choice) => choice.value === theme.value),
    ) ?? [];
  const artistOptions = useMemo<EpidemicOption[]>(() => {
    const choices = new Map<string, EpidemicOption>();
    for (const item of page.items)
      for (const option of item.artistFilters ?? [])
        choices.set(option.value, option);
    return [...choices.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [page.items]);

  return (
    <div className="modal-backdrop epidemic-backdrop">
      <section
        ref={modal}
        className="modal epidemic-browser"
        role="dialog"
        aria-modal="true"
        aria-labelledby="epidemic-browser-title"
      >
        <header className="epidemic-browser-header">
          <div className="epidemic-brand">
            <span className="epidemic-logo-mark">
              <AudioLines size={24} />
            </span>
            <div>
              <span className="epidemic-eyebrow">
                YOUR NEXT GREAT MIX STARTS HERE
              </span>
              <h2 id="epidemic-browser-title">Epidemic Sound</h2>
            </div>
          </div>
          <div className="epidemic-header-actions">
            {connected && !editingKey && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  stopPreview();
                  setEditingKey(true);
                }}
              >
                <KeyRound size={13} />
                <span>Connection</span>
                <span className="dot green" />
              </button>
            )}
            <button
              className="icon-button"
              aria-label="Close Epidemic Sound browser"
              onClick={close}
            >
              <X size={20} />
            </button>
          </div>
        </header>
        {!connection && !error ? (
          <div className="epidemic-initial-loading" role="status">
            <LoaderCircle className="spin" size={25} />
            <span>Checking your connection…</span>
          </div>
        ) : !connected || editingKey ? (
          <div className="epidemic-browser-key">
            {editingKey && (
              <button
                className="text-button"
                disabled={keyBusy}
                onClick={() => setEditingKey(false)}
              >
                <ArrowLeft size={13} />
                Back to catalog
              </button>
            )}
            <EpidemicKeyForm
              replace={editingKey && connected}
              startWithKey
              onBusyChange={(value) => {
                setKeyBusy(value);
                callbacks.current.onBusyChange?.(value);
              }}
              onCancel={editingKey ? () => setEditingKey(false) : close}
              onConnected={(status) => {
                setConnection(status);
                setEditingKey(false);
                setConnectionRevision((value) => value + 1);
              }}
            />
            {error && (
              <div className="epidemic-error" role="alert">
                {error}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="epidemic-discovery-bar">
              <div
                className="epidemic-kind-tabs"
                role="tablist"
                aria-label="Epidemic catalog type"
              >
                <button
                  role="tab"
                  aria-selected={kind === "music"}
                  disabled={busy}
                  onClick={() => switchKind("music")}
                >
                  <Music2 size={16} />
                  Music
                </button>
                <button
                  role="tab"
                  aria-selected={kind === "soundtrack"}
                  disabled={busy}
                  onClick={() => switchKind("soundtrack")}
                >
                  <Waves size={16} />
                  Sound effects
                </button>
              </div>
              <form
                className="epidemic-search"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitSearch();
                }}
              >
                <Search size={17} />
                <input
                  aria-label="Search Epidemic Sound"
                  value={queryText}
                  disabled={busy}
                  onChange={(event) => setQueryText(event.target.value)}
                  placeholder={
                    kind === "soundtrack"
                      ? "Search whooshes, ambience, footsteps…"
                      : queryMode === "topic"
                        ? "Describe a mood, scene, or story…"
                        : queryMode === "reference"
                          ? "Enter an artist or song to find a similar sound…"
                          : "Search music, artists, or keywords…"
                  }
                />
                {queryText && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Clear Epidemic search"
                    disabled={busy}
                    onClick={() => {
                      setQueryText("");
                      setQuery({});
                      setSimilarTitle("");
                      updateFilter({
                        similarToId: undefined,
                        sort: "POPULARITY",
                      });
                    }}
                  >
                    <X size={13} />
                  </button>
                )}
                <button
                  type="submit"
                  className="button primary"
                  disabled={busy}
                >
                  Search
                </button>
              </form>
              {kind === "music" && (
                <select
                  aria-label="Music search mode"
                  value={queryMode}
                  disabled={busy}
                  onChange={(event) =>
                    setQueryMode(event.target.value as typeof queryMode)
                  }
                >
                  <option value="term">Titles & keywords</option>
                  <option value="topic">Describe a scene</option>
                  <option value="reference">Sounds like…</option>
                </select>
              )}
            </div>
            {!canImport && (
              <p className="epidemic-voiceover-notice" role="note">
                Browse and preview now. Import your first voiceover before
                adding music or sound effects to this project.
              </p>
            )}
            <div className="epidemic-browser-body">
              <aside
                className="epidemic-filter-sidebar"
                aria-label="Epidemic Sound filters"
              >
                <div className="epidemic-filter-heading">
                  <strong>
                    <SlidersHorizontal size={14} />
                    Filters{filterCount > 0 && <span>{filterCount}</span>}
                  </strong>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={clearFilters}
                  >
                    Reset
                  </button>
                </div>
                {filters.similarToId && (
                  <p className="epidemic-filter-note">
                    Clear “Similar tracks” to use catalog filters.
                  </p>
                )}
                <fieldset disabled={busy || Boolean(filters.similarToId)}>
                  {kind === "music" ? (
                    <>
                      <FilterPicker
                        label="Genre"
                        options={catalog?.genres ?? []}
                        selected={filters.genres ?? []}
                        onChange={(genres) => updateFilter({ genres })}
                      />
                      {(filters.genres?.length ?? 0) > 0 && (
                        <p className="epidemic-filter-note">
                          {filters.taxonomyMatch === "ANY"
                            ? "Any chosen genre, decade or world style"
                            : filters.taxonomyMatch === "NOT_ANY"
                              ? "Excluding chosen genres, decades and world styles"
                              : "All chosen genres, decades and world styles"}
                          . Change this in More filters.
                        </p>
                      )}
                      <FilterPicker
                        label="Mood"
                        options={catalog?.moods ?? []}
                        selected={filters.moods ?? []}
                        match={filters.moodMatch ?? "ANY"}
                        onMatchChange={(moodMatch) =>
                          updateFilter({ moodMatch })
                        }
                        onChange={(moods) => updateFilter({ moods })}
                      />
                      <FilterPicker
                        label="Instrument"
                        options={catalog?.instruments ?? []}
                        selected={filters.instruments ?? []}
                        match={filters.instrumentMatch ?? "ANY"}
                        onMatchChange={(instrumentMatch) =>
                          updateFilter({ instrumentMatch })
                        }
                        onChange={(instruments) =>
                          updateFilter({ instruments })
                        }
                      />
                      <label className="epidemic-filter-label">
                        Vocals
                        <select
                          aria-label="Vocal filter"
                          value={filters.vocals ?? "any"}
                          onChange={(event) =>
                            updateFilter({
                              vocals: event.target
                                .value as EpidemicSearchRequest["vocals"],
                            })
                          }
                        >
                          <option value="any">Any vocals</option>
                          <option value="instrumental">
                            Instrumental only
                          </option>
                          <option value="vocals">With vocals</option>
                        </select>
                      </label>
                    </>
                  ) : (
                    <FilterPicker
                      label="Category"
                      options={catalog?.soundEffects ?? []}
                      selected={filters.tags ?? []}
                      match={filters.tagMatch ?? "ANY"}
                      onMatchChange={(tagMatch) => updateFilter({ tagMatch })}
                      onChange={(tags) => updateFilter({ tags })}
                    />
                  )}
                  <RangeFilter
                    label="Duration"
                    unit="seconds"
                    min={filters.durationMin}
                    max={filters.durationMax}
                    limit={43200}
                    onChange={(durationMin, durationMax) =>
                      updateFilter({ durationMin, durationMax })
                    }
                  />
                  {kind === "music" && (
                    <RangeFilter
                      label="Tempo"
                      unit="BPM"
                      min={filters.bpmMin}
                      max={filters.bpmMax}
                      limit={400}
                      onChange={(bpmMin, bpmMax) =>
                        updateFilter({ bpmMin, bpmMax })
                      }
                    />
                  )}
                  {kind === "music" && (
                    <details className="epidemic-advanced">
                      <summary>
                        More filters
                        <ChevronDown size={13} />
                      </summary>
                      <MatchControl
                        label="Combine genre, decade & world style"
                        value={filters.taxonomyMatch ?? "ALL"}
                        onChange={(taxonomyMatch) =>
                          updateFilter({ taxonomyMatch })
                        }
                      />
                      <FilterPicker
                        label="Musical key"
                        options={catalog?.musicalKeys ?? []}
                        selected={filters.musicalKeys ?? []}
                        onChange={(musicalKeys) =>
                          updateFilter({ musicalKeys })
                        }
                      />
                      <FilterPicker
                        label="Decade"
                        options={catalog?.decades ?? []}
                        selected={filters.decades ?? []}
                        onChange={(decades) => updateFilter({ decades })}
                      />
                      <FilterPicker
                        label="World style"
                        options={catalog?.countries ?? []}
                        selected={filters.countries ?? []}
                        onChange={(countries) => updateFilter({ countries })}
                      />
                      <FilterPicker
                        label="Artist"
                        options={artistOptions}
                        selected={filters.artistSlugs ?? []}
                        match={filters.artistMatch ?? "ANY"}
                        onMatchChange={(artistMatch) =>
                          updateFilter({ artistMatch })
                        }
                        onChange={(artistSlugs) =>
                          updateFilter({ artistSlugs })
                        }
                      />
                      <p className="epidemic-filter-note">
                        Artist choices come from these results. Instrument, key,
                        decade, and world-style choices are verified catalog
                        filters.
                      </p>
                    </details>
                  )}
                </fieldset>
                {catalog && (
                  <p className="epidemic-taxonomy-note">
                    Categories from Epidemic Sound’s official catalog.
                    <br />
                    Updated{" "}
                    {new Date(
                      `${catalog.fetchedAt}T12:00:00`,
                    ).toLocaleDateString()}
                    .
                  </p>
                )}
              </aside>
              <div
                ref={resultScroll}
                className="epidemic-results-scroll"
                aria-busy={loading}
              >
                {discover && kind === "music" && catalog && (
                  <div className="epidemic-theme-section">
                    <div className="epidemic-content-heading">
                      <div>
                        <span className="epidemic-eyebrow">
                          FIND THE FEELING
                        </span>
                        <h3>Explore a theme</h3>
                      </div>
                      <span>Search by scene and atmosphere</span>
                    </div>
                    <div className="epidemic-theme-grid">
                      {featuredThemes.map((theme, index) => (
                        <button
                          className={`epidemic-theme theme-${index % 6}`}
                          key={theme.value}
                          disabled={busy}
                          onClick={() => chooseTheme(theme.value)}
                        >
                          <span className="epidemic-theme-art">
                            <ThemeIcon index={index} />
                          </span>
                          <strong>{theme.label}</strong>
                          <ArrowLeft size={14} />
                        </button>
                      ))}
                    </div>
                    {catalog.themes.length > 8 && (
                      <details className="epidemic-more-themes">
                        <summary>
                          All {catalog.themes.length} themes
                          <ChevronDown size={13} />
                        </summary>
                        <div>
                          {otherThemes.map((theme) => (
                            <button
                              className="epidemic-topic-chip"
                              key={theme.value}
                              disabled={busy}
                              onClick={() => chooseTheme(theme.value)}
                            >
                              {theme.label}
                            </button>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                )}
                <div className="epidemic-results-heading">
                  <div>
                    <h3>
                      {filters.similarToId
                        ? `Similar to “${similarTitle}”`
                        : query.topic
                          ? `Music for “${query.topic}”`
                          : query.reference
                            ? `Sounds like “${query.reference}”`
                            : query.term
                              ? `Results for “${query.term}”`
                              : discover
                                ? kind === "music"
                                  ? "Popular music"
                                  : "Explore sound effects"
                                : "Your discoveries"}
                    </h3>
                    <span>
                      {loading
                        ? "Searching the catalog…"
                        : page.total === null
                          ? `${page.items.length} tracks loaded`
                          : page.total >= 10000
                            ? "10,000+ catalog matches"
                            : `${page.total.toLocaleString()} ${page.total === 1 ? "match" : "matches"}`}
                    </span>
                  </div>
                  <div className="epidemic-results-sort">
                    <select
                      aria-label="Sort Epidemic results"
                      disabled={busy || Boolean(filters.similarToId)}
                      value={filters.sort ?? "POPULARITY"}
                      onChange={(event) =>
                        updateFilter({
                          sort: event.target
                            .value as EpidemicSearchRequest["sort"],
                        })
                      }
                    >
                      {Object.entries(sortNames)
                        .filter(
                          ([value]) => kind === "music" || value !== "BPM",
                        )
                        .map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                    </select>
                    <select
                      aria-label="Sort order"
                      disabled={busy || Boolean(filters.similarToId)}
                      value={filters.order ?? "DESCENDING"}
                      onChange={(event) =>
                        updateFilter({
                          order: event.target
                            .value as EpidemicSearchRequest["order"],
                        })
                      }
                    >
                      <option value="DESCENDING">{orderLabels[0]}</option>
                      <option value="ASCENDING">{orderLabels[1]}</option>
                    </select>
                  </div>
                </div>
                {filters.similarToId && (
                  <button
                    className="epidemic-active-query"
                    onClick={() => {
                      setSimilarTitle("");
                      updateFilter({
                        similarToId: undefined,
                        sort: "POPULARITY",
                      });
                    }}
                  >
                    <Layers3 size={13} />
                    Similar tracks
                    <X size={12} />
                  </button>
                )}
                {filterCount > 0 && (
                  <div className="epidemic-active-filters">
                    {chosenTags.map((value) => (
                      <button
                        key={value}
                        onClick={() =>
                          setFilters((current) => ({
                            ...current,
                            genres: current.genres?.filter(
                              (item) => item !== value,
                            ),
                            moods: current.moods?.filter(
                              (item) => item !== value,
                            ),
                            instruments: current.instruments?.filter(
                              (item) => item !== value,
                            ),
                            tags: current.tags?.filter(
                              (item) => item !== value,
                            ),
                            musicalKeys: current.musicalKeys?.filter(
                              (item) => item !== value,
                            ),
                            decades: current.decades?.filter(
                              (item) => item !== value,
                            ),
                            countries: current.countries?.filter(
                              (item) => item !== value,
                            ),
                            artistSlugs: current.artistSlugs?.filter(
                              (item) => item !== value,
                            ),
                          }))
                        }
                      >
                        {optionLabel(catalog, artistOptions, value)}
                        <X size={11} />
                      </button>
                    ))}
                  </div>
                )}
                {error && (
                  <div className="epidemic-error" role="alert">
                    <span>{error}</span>
                    <button
                      className="text-button"
                      onClick={() => {
                        setError("");
                        setConnectionRevision((value) => value + 1);
                      }}
                    >
                      <RefreshCw size={13} />
                      Try again
                    </button>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => setEditingKey(true)}
                    >
                      Check API key
                    </button>
                  </div>
                )}
                {loading && !page.items.length ? (
                  <div className="epidemic-result-skeleton" role="status">
                    <LoaderCircle className="spin" size={22} />
                    <span>Finding your next soundtrack…</span>
                  </div>
                ) : (
                  <div
                    className={`epidemic-result-list ${loading ? "updating" : ""}`}
                  >
                    {page.items.map((item) => {
                      const isPreparing = previewLoading?.id === item.id;
                      const isCurrent = preview?.item.id === item.id;
                      const stem = stems[item.id] ?? "FULL";
                      return (
                        <article
                          className={`epidemic-result ${isCurrent ? "is-current" : ""}`}
                          key={item.id}
                        >
                          <button
                            className="epidemic-cover"
                            aria-label={
                              isPreparing
                                ? `Cancel preview ${item.title}`
                                : isCurrent && playing
                                  ? `Pause ${item.title}`
                                  : `Preview ${item.title}`
                            }
                            disabled={busy}
                            onClick={() => void listen(item)}
                          >
                            <span
                              className="epidemic-cover-fallback"
                              aria-hidden="true"
                            >
                              {item.kind === "music" ? (
                                <Music2 size={23} />
                              ) : (
                                <Waves size={23} />
                              )}
                            </span>
                            {item.coverArtUrl && (
                              <img
                                src={item.coverArtUrl}
                                alt=""
                                loading="lazy"
                                decoding="async"
                                referrerPolicy="no-referrer"
                                onLoad={(event) => {
                                  event.currentTarget.style.display = "block";
                                }}
                                onError={(event) => {
                                  event.currentTarget.style.display = "none";
                                }}
                              />
                            )}
                            <span className="epidemic-cover-play">
                              {isPreparing ? (
                                <LoaderCircle className="spin" size={19} />
                              ) : isCurrent && playing ? (
                                <Pause size={18} fill="currentColor" />
                              ) : (
                                <Play size={18} fill="currentColor" />
                              )}
                            </span>
                          </button>
                          <div className="epidemic-result-info">
                            <strong title={item.title}>{item.title}</strong>
                            <span className="epidemic-result-artist">
                              {item.artists.join(", ") ||
                                "Epidemic Sound Effects"}
                            </span>
                            <div className="epidemic-result-tags">
                              {item.tags.slice(0, 4).map((tag, index) =>
                                item.kind === "soundtrack" && tag.slug ? (
                                  <button
                                    key={`${tag.label}-${index}`}
                                    disabled={busy}
                                    onClick={() =>
                                      updateFilter({ tags: [tag.slug!] })
                                    }
                                  >
                                    {tag.label}
                                  </button>
                                ) : (
                                  <span key={`${tag.label}-${index}`}>
                                    {tag.label}
                                  </span>
                                ),
                              )}
                            </div>
                          </div>
                          <div className="epidemic-result-timing">
                            <span>{clock(item.duration)}</span>
                            {item.bpm !== undefined && (
                              <small>{item.bpm} BPM</small>
                            )}
                          </div>
                          <div className="epidemic-result-actions">
                            {item.kind === "music" && item.stems.length > 1 && (
                              <select
                                aria-label={`Stem for ${item.title}`}
                                disabled={busy}
                                value={stem}
                                onChange={(event) => {
                                  setStems((current) => ({
                                    ...current,
                                    [item.id]: event.target
                                      .value as EpidemicStem,
                                  }));
                                  if (isCurrent) stopPreview();
                                }}
                              >
                                {item.stems.map((value) => (
                                  <option key={value} value={value}>
                                    {stemNames[value]}
                                  </option>
                                ))}
                              </select>
                            )}
                            <button
                              className="epidemic-similar-button"
                              title="Find similar tracks"
                              aria-label={`Find similar to ${item.title}`}
                              disabled={busy}
                              onClick={() => {
                                stopPreview();
                                setSimilarTitle(item.title);
                                setQuery({});
                                setQueryText("");
                                setFilters({
                                  ...initialFilters(),
                                  similarToId: item.id,
                                });
                              }}
                            >
                              <Sparkles size={15} />
                            </button>
                            <button
                              className="button primary epidemic-add-result"
                              disabled={busy || loading || !canImport}
                              title={
                                canImport
                                  ? undefined
                                  : "Import your first voiceover before adding this audio"
                              }
                              aria-label={`Add ${item.title} to mix`}
                              onClick={() => void importAudio(item)}
                            >
                              {downloading?.id === item.id ? (
                                <LoaderCircle className="spin" size={14} />
                              ) : (
                                <Download size={14} />
                              )}
                              <span>Add</span>
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
                {!loading && !error && page.items.length === 0 && (
                  <div className="epidemic-no-results">
                    <Search size={31} />
                    <h3>No matches yet</h3>
                    <p>
                      Try a broader search or remove a filter to discover more
                      sounds.
                    </p>
                    <button className="button secondary" onClick={clearFilters}>
                      Reset search and filters
                    </button>
                  </div>
                )}
                {page.hasNextPage && (
                  <div className="epidemic-load-more">
                    <button
                      className="button secondary"
                      disabled={loading || loadingMore || busy}
                      onClick={() => void more()}
                    >
                      {loadingMore ? (
                        <LoaderCircle className="spin" size={15} />
                      ) : (
                        <ChevronDown size={15} />
                      )}{" "}
                      {loadingMore ? "Loading more…" : "Load more tracks"}
                    </button>
                  </div>
                )}
              </div>
            </div>
            <footer className="epidemic-browser-footer">
              {downloading ? (
                <div className="epidemic-download-state" role="status">
                  <LoaderCircle className="spin" size={23} />
                  <div>
                    <strong>Preparing “{downloading.title}”</strong>
                    <span>
                      Downloading {format} audio and preparing its waveform…
                    </span>
                  </div>
                  <button className="button secondary" onClick={cancelImport}>
                    Cancel import
                  </button>
                </div>
              ) : preview || previewLoading ? (
                <div className="epidemic-inline-player">
                  <button
                    className="epidemic-inline-play"
                    aria-label={
                      previewLoading
                        ? "Cancel preparing preview"
                        : playing
                          ? "Pause catalog preview"
                          : "Play catalog preview"
                    }
                    onClick={() => {
                      if (previewLoading) stopPreview();
                      else if (preview) void listen(preview.item);
                    }}
                  >
                    {previewLoading ? (
                      <LoaderCircle className="spin" size={20} />
                    ) : playing ? (
                      <Pause size={19} fill="currentColor" />
                    ) : (
                      <Play size={19} fill="currentColor" />
                    )}
                  </button>
                  <div className="epidemic-inline-title">
                    <strong>
                      {previewLoading?.title ?? preview?.item.title}
                    </strong>
                    <span>
                      {previewLoading
                        ? "Preparing preview…"
                        : `${preview?.item.artists.join(", ") || "Epidemic Sound Effects"}${preview?.stem !== "FULL" ? ` · ${stemNames[preview!.stem]}` : ""}`}
                    </span>
                  </div>
                  <div className="epidemic-inline-wave">
                    {preview && (
                      <>
                        {preview.track.peaks.length ? (
                          <Waveform peaks={preview.track.peaks} bars={150} />
                        ) : (
                          <div className="epidemic-preview-progress">
                            <span
                              style={{
                                width: `${(position / preview.track.duration) * 100}%`,
                              }}
                            />
                          </div>
                        )}
                        <input
                          type="range"
                          aria-label="Seek catalog preview"
                          disabled={Boolean(previewLoading)}
                          min={0}
                          max={preview.track.duration}
                          step={0.01}
                          value={position}
                          onChange={(event) => seek(Number(event.target.value))}
                        />
                        {!!preview.track.peaks.length && (
                          <span
                            className="epidemic-preview-position"
                            style={{
                              left: `${(position / preview.track.duration) * 100}%`,
                            }}
                          />
                        )}
                      </>
                    )}
                  </div>
                  <span className="epidemic-inline-time">
                    {clock(position)} / {clock(preview?.track.duration ?? 0)}
                  </span>
                  <div className="epidemic-preview-skips">
                    <button
                      className="icon-button"
                      aria-label="Catalog preview back 5 seconds"
                      disabled={!preview || Boolean(previewLoading)}
                      onClick={() => seek(position - 5)}
                    >
                      <SkipBack size={14} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Catalog preview forward 5 seconds"
                      disabled={!preview || Boolean(previewLoading)}
                      onClick={() => seek(position + 5)}
                    >
                      <SkipForward size={14} />
                    </button>
                  </div>
                  <select
                    aria-label="Catalog preview speed"
                    value={rate}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setRate(next);
                      if (audio.current) {
                        audio.current.preservesPitch = true;
                        audio.current.playbackRate = next;
                      }
                    }}
                  >
                    {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((value) => (
                      <option key={value} value={value}>
                        {value}×
                      </option>
                    ))}
                  </select>
                  <label className="epidemic-preview-volume">
                    <Volume2 size={14} />
                    <input
                      aria-label="Catalog preview volume"
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={volume}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        setVolume(next);
                        if (audio.current) audio.current.volume = next;
                      }}
                    />
                  </label>
                </div>
              ) : (
                <div className="epidemic-listening-hint">
                  <Headphones size={19} />
                  <span>
                    Listen here. Find the sound that belongs in your story.
                  </span>
                </div>
              )}
              <div className="epidemic-download-format">
                <label>
                  Import format
                  <select
                    aria-label="Epidemic import format"
                    disabled={busy}
                    value={format}
                    onChange={(event) =>
                      setFormat(event.target.value as typeof format)
                    }
                  >
                    <option value="WAV">WAV · lossless</option>
                    <option value="MP3">MP3 · smaller</option>
                  </select>
                </label>
                <span>Your subscription determines download access.</span>
              </div>
            </footer>
          </>
        )}
        <audio
          ref={audio}
          src={preview?.track.mediaUrl}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={() => setPosition(audio.current?.currentTime ?? 0)}
          onError={() => {
            if (preview)
              setError(
                "This preview could not be played. Try listening again.",
              );
          }}
        />
        <div className="epidemic-provider-note">
          <span>
            <Check size={11} />
            Audio downloads directly to this Mac
          </span>
          <button
            className="text-button"
            onClick={() => void window.studio.openExternal("epidemic-docs")}
          >
            About this connection
            <ExternalLink size={11} />
          </button>
        </div>
      </section>
    </div>
  );
}

function optionLabel(
  catalog: EpidemicCatalog | null,
  artists: EpidemicOption[],
  value: string,
) {
  return (
    [
      ...(catalog?.genres ?? []),
      ...(catalog?.moods ?? []),
      ...(catalog?.instruments ?? []),
      ...(catalog?.soundEffects ?? []),
      ...(catalog?.musicalKeys ?? []),
      ...(catalog?.decades ?? []),
      ...(catalog?.countries ?? []),
      ...artists,
    ].find((option) => option.value === value)?.label ?? value
  );
}
function ThemeIcon({ index }: { index: number }) {
  const Icon = [Sparkles, Headphones, Music2, Waves, Layers3, AudioLines][
    index % 6
  ];
  return <Icon size={27} strokeWidth={1.25} />;
}
function FilterPicker({
  label,
  options,
  selected,
  onChange,
  match,
  onMatchChange,
}: {
  label: string;
  options: EpidemicOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  match?: EpidemicMatch;
  onMatchChange?: (value: EpidemicMatch) => void;
}) {
  const [search, setSearch] = useState("");
  const visible = options.filter((option) =>
    option.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  return (
    <details className="epidemic-filter-picker">
      <summary>
        {label}
        <span>
          {selected.length ? selected.length : "All"}
          <ChevronDown size={12} />
        </span>
      </summary>
      <div className="epidemic-filter-picker-body">
        {match && onMatchChange && (
          <MatchControl
            label={`${label} matching`}
            value={match}
            onChange={onMatchChange}
          />
        )}
        <div className="epidemic-filter-search">
          <Search size={12} />
          <input
            aria-label={`Find ${label.toLowerCase()}`}
            placeholder={`Find ${label.toLowerCase()}…`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {selected.length > 0 && (
          <button className="text-button" onClick={() => onChange([])}>
            Clear {label.toLowerCase()}
          </button>
        )}
        {selected.length >= 20 && (
          <p className="epidemic-filter-limit">Choose up to 20 values.</p>
        )}
        <div className="epidemic-filter-options">
          {visible.map((option) => (
            <label key={option.value}>
              <input
                type="checkbox"
                disabled={
                  selected.length >= 20 && !selected.includes(option.value)
                }
                checked={selected.includes(option.value)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...selected, option.value]
                      : selected.filter((value) => value !== option.value),
                  )
                }
              />
              <span>{option.label}</span>
            </label>
          ))}
          {!visible.length && (
            <p>
              {options.length
                ? "No matching filters."
                : "No options available yet."}
            </p>
          )}
        </div>
      </div>
    </details>
  );
}
function MatchControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: EpidemicMatch;
  onChange: (value: EpidemicMatch) => void;
}) {
  return (
    <label className="epidemic-match-control">
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value as EpidemicMatch)}
      >
        <option value="ALL">Match all selected</option>
        <option value="ANY">Match any selected</option>
        <option value="NOT_ANY">Exclude selected</option>
      </select>
    </label>
  );
}
function RangeFilter({
  label,
  unit,
  min,
  max,
  limit,
  onChange,
}: {
  label: string;
  unit: string;
  min?: number;
  max?: number;
  limit: number;
  onChange: (min: number | undefined, max: number | undefined) => void;
}) {
  return (
    <div className="epidemic-range-filter">
      <label>
        {label}
        <span>{unit}</span>
      </label>
      <div>
        <input
          aria-label={`Minimum ${label.toLowerCase()}`}
          type="number"
          min={0}
          max={limit}
          placeholder="Min"
          value={min ?? ""}
          onChange={(event) => {
            const value =
              event.target.value === ""
                ? undefined
                : Number(event.target.value);
            if (
              value === undefined ||
              (Number.isFinite(value) && value >= 0 && value <= limit)
            )
              onChange(value, max);
          }}
        />
        <span>–</span>
        <input
          aria-label={`Maximum ${label.toLowerCase()}`}
          type="number"
          min={0}
          max={limit}
          placeholder="Max"
          value={max ?? ""}
          onChange={(event) => {
            const value =
              event.target.value === ""
                ? undefined
                : Number(event.target.value);
            if (
              value === undefined ||
              (Number.isFinite(value) && value >= 0 && value <= limit)
            )
              onChange(min, value);
          }}
        />
      </div>
      {min !== undefined && max !== undefined && min > max && (
        <small>Minimum must be below maximum.</small>
      )}
    </div>
  );
}
