import { useState } from "react";
import {
  Check,
  CircleHelp,
  Download,
  ExternalLink,
  LoaderCircle,
  Monitor,
  Moon,
  RefreshCw,
  Sun,
  X,
} from "lucide-react";
import type {
  DependencyStatus,
  JointSettings,
  CodexSelection,
  MixProject,
  StudioTheme,
  TranscriptionModel,
} from "../shared/types";
import { transcriptionModels } from "../shared/types";
import { CodexSettings } from "./CodexSettings";
import { EpidemicSettings } from "./EpidemicKeyDialog";
export function Settings({
  project,
  status,
  busy,
  theme,
  onThemeChange,
  onClose,
  onCancel,
  onChangeModel,
  onJointDefaults,
  onCodexChange,
  onGuide,
  onSetup,
  onRefresh,
  onExportJSON,
  onConnectionBusyChange,
}: {
  project: MixProject;
  status: DependencyStatus | null;
  busy: boolean;
  theme: StudioTheme;
  onThemeChange: (theme: StudioTheme) => void;
  onClose: () => void;
  onCancel?: () => void;
  onChangeModel: (model: TranscriptionModel) => void;
  onJointDefaults: (update: Partial<JointSettings>) => void;
  onCodexChange: (value: CodexSelection) => void;
  onGuide: () => void;
  onSetup: () => void;
  onRefresh: () => void;
  onExportJSON: () => void;
  onConnectionBusyChange?: (busy: boolean) => void;
}) {
  const [connectionBusy, setConnectionBusy] = useState(false);
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
          <h2 id="settings-title">Studio settings</h2>
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
          <h3>Appearance</h3>
          <div className="theme-picker" role="group" aria-label="Appearance">
            {(
              [
                ["light", "Light", Sun],
                ["dark", "Dark", Moon],
                ["system", "System", Monitor],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                aria-pressed={theme === value}
                onClick={() => onThemeChange(value)}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="setting-section">
          <h3>Transcription</h3>
          <p>Local WhisperX. Smaller models use less memory.</p>
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
            {busy && !connectionBusy ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <Download size={15} />
            )}
            Prepare model
          </button>
        </div>
        <EpidemicSettings
          disabled={busy}
          onBusyChange={(value) => {
            setConnectionBusy(value);
            onConnectionBusyChange?.(value);
          }}
        />
        <CodexSettings
          value={project.codex}
          disabled={busy}
          onChange={onCodexChange}
        />
        <div className="setting-section">
          <div className="section-heading">
            <h3>Local tools</h3>
            <button className="text-button" disabled={busy} onClick={onRefresh}>
              <RefreshCw size={13} />
              Recheck
            </button>
          </div>
          {(["whisperx", "codex", "ffmpeg", "soundtouch"] as const).map(
            (key) => (
              <div className="dependency" key={key}>
                <span
                  className={`dependency-symbol ${status?.[key]?.available ? "ready" : ""}`}
                >
                  {status?.[key]?.available ? (
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
                        : key === "soundtouch"
                          ? "SoundTouch tempo"
                          : "FFmpeg"}
                  </strong>
                  <p>{status?.[key]?.detail ?? "Checking installation…"}</p>
                </div>
                <button
                  className="icon-button"
                  aria-label={`Open ${key} installation guide`}
                  onClick={() => void window.studio.openExternal(key)}
                >
                  <ExternalLink size={15} />
                </button>
              </div>
            ),
          )}
          {status && !status.soundtouch?.available && (
            <div className="setup-instructions">
              <p>Give this prompt to your AI assistant:</p>
              <textarea
                readOnly
                aria-label="SoundTouch installation prompt"
                value="Install the Homebrew sound-touch package on this Mac (brew install sound-touch). Verify soundstretch runs, then recheck Local tools in Audio Mix Studio. Preserve other app settings and model caches."
              />
              <button
                className="button secondary"
                onClick={() =>
                  void navigator.clipboard.writeText(
                    "Install the Homebrew sound-touch package on this Mac (brew install sound-touch). Verify soundstretch runs, then recheck Local tools in Audio Mix Studio. Preserve other app settings and model caches.",
                  )
                }
              >
                Copy installation prompt
              </button>
            </div>
          )}
          <p className="privacy-note">
            Audio stays on your Mac. Grouping sends transcript text to your
            signed-in Codex account.
          </p>
        </div>
        <div className="setting-section">
          <h3>Joints</h3>
          {(
            [
              ["fadeInMs", "Default fade-in clip edge", 5000],
              ["fadeOutMs", "Default fade-out clip edge", 5000],
              ["pauseMs", "Default pause", 10000],
            ] as const
          ).map(([key, label, max]) => (
            <label className="fade-setting" key={key}>
              {label}
              <span>
                <input
                  aria-label={label + " milliseconds"}
                  type="number"
                  min={0}
                  max={max}
                  step={10}
                  disabled={busy}
                  value={project.jointDefaults?.[key] ?? 0}
                  onChange={(event) =>
                    onJointDefaults({
                      [key]: Math.max(
                        0,
                        Math.min(max, Number(event.target.value)),
                      ),
                    })
                  }
                />{" "}
                ms
              </span>
            </label>
          ))}
        </div>
        <div className="setting-section guide-setting">
          <button className="text-button" disabled={busy} onClick={onGuide}>
            <CircleHelp size={15} />
            Quick guide
          </button>
        </div>
        <footer>
          <button
            className="text-button"
            disabled={busy || !project.groups.length}
            onClick={onExportJSON}
          >
            Export alignment JSON
          </button>
          <div className="settings-footer-actions">
            {busy && !connectionBusy && onCancel && (
              <button className="button secondary" onClick={onCancel}>
                Cancel operation
              </button>
            )}
            <button
              className="button primary"
              disabled={busy}
              onClick={onClose}
            >
              Done
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
