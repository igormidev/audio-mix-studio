import {
  Check,
  Download,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  X,
} from "lucide-react";
import type {
  DependencyStatus,
  MixProject,
  TranscriptionModel,
} from "../shared/types";
import { transcriptionModels } from "../shared/types";
export function Settings({
  project,
  status,
  busy,
  onClose,
  onChangeModel,
  onFade,
  onSetup,
  onRefresh,
  onExportJSON,
}: {
  project: MixProject;
  status: DependencyStatus | null;
  busy: boolean;
  onClose: () => void;
  onChangeModel: (model: TranscriptionModel) => void;
  onFade: (n: number) => void;
  onSetup: () => void;
  onRefresh: () => void;
  onExportJSON: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <section
        className="settings modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) onClose();
        }}
      >
        <header>
          <div>
            <span className="eyebrow">YOUR LOCAL STUDIO</span>
            <h2 id="settings-title">Studio settings</h2>
          </div>
          <button
            autoFocus
            className="icon-button"
            aria-label="Close settings"
            disabled={busy}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <div className="setting-section">
          <h3>Transcription</h3>
          <p>
            WhisperX runs on your Mac. The default is large-v3-turbo; smaller
            models use less memory.
          </p>
          <label className="field-label" htmlFor="transcription-model">
            WhisperX model
          </label>
          <select
            id="transcription-model"
            value={project.model}
            disabled={busy}
            onChange={(e) =>
              onChangeModel(e.target.value as TranscriptionModel)
            }
          >
            {transcriptionModels.map((model) => (
              <option key={model} value={model}>
                {model}
                {model === "large-v3-turbo" ? " · Recommended" : ""}
                {status?.models.find((m) => m.id === model)?.downloaded
                  ? " · Downloaded"
                  : ""}
              </option>
            ))}
          </select>
          <div className="model-state">
            <span
              className={
                status?.models.find((m) => m.id === project.model)?.downloaded
                  ? "dot green"
                  : "dot amber"
              }
            />
            {status?.models.find((m) => m.id === project.model)?.downloaded
              ? "Model ready on this Mac"
              : "Model will download before transcription"}
          </div>
          <button
            className="button secondary"
            disabled={busy}
            onClick={onSetup}
          >
            {busy ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <Download size={15} />
            )}
            Prepare selected model
          </button>
        </div>
        <div className="setting-section">
          <div className="section-heading">
            <h3>Local tools</h3>
            <button className="text-button" disabled={busy} onClick={onRefresh}>
              <RefreshCw size={13} />
              Recheck
            </button>
          </div>
          {(["whisperx", "codex", "ffmpeg"] as const).map((key) => (
            <div className="dependency" key={key}>
              <span
                className={`dependency-symbol ${status?.[key].available ? "ready" : ""}`}
              >
                {status?.[key].available ? (
                  <Check size={15} />
                ) : (
                  <Download size={15} />
                )}
              </span>
              <div>
                <strong>
                  {key === "whisperx"
                    ? "WhisperX"
                    : key === "codex"
                      ? "Codex CLI"
                      : "FFmpeg"}
                </strong>
                <p>{status?.[key].detail ?? "Checking installation…"}</p>
              </div>
              <button
                className="icon-button"
                aria-label={`Open ${key} installation guide`}
                onClick={() => void window.studio.openExternal(key)}
              >
                <ExternalLink size={15} />
              </button>
            </div>
          ))}
          <p className="privacy-note">
            Audio and transcription stay local. Sentence grouping sends
            transcript text to Codex using your signed-in account. No audio is
            uploaded.
          </p>
        </div>
        <div className="setting-section">
          <h3>Joins</h3>
          <label className="fade-setting">
            Fade each clip edge
            <span>
              <input
                aria-label="Clip edge fade milliseconds"
                type="number"
                min="0"
                max="20"
                step="1"
                disabled={busy}
                value={project.joinFadeMs}
                onChange={(e) =>
                  onFade(Math.max(0, Math.min(20, Number(e.target.value))))
                }
              />{" "}
              ms
            </span>
          </label>
          <p>
            A tiny fade reduces clicks at cuts. It does not overlap sentences or
            change the mix duration.
          </p>
        </div>
        <footer>
          <button
            className="text-button"
            disabled={busy || !project.groups.length}
            onClick={onExportJSON}
          >
            Export alignment JSON
          </button>
          <button className="button primary" disabled={busy} onClick={onClose}>
            Done
          </button>
        </footer>
      </section>
    </div>
  );
}
