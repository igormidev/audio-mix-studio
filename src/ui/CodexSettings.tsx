import { Bot, Brain, LoaderCircle, RefreshCw, Zap } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { CodexModelInfo, CodexSelection } from "../shared/types";
import { validCodexSelection } from "../domain/project";

const reasoningLabels: Record<string, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
  ultra: "Ultra",
};

/** Uses Vandashi's live model/effort/speed semantics without exposing a chat. */
export function CodexSettings({
  value,
  disabled = false,
  onChange,
}: {
  value?: CodexSelection;
  disabled?: boolean;
  onChange: (selection: CodexSelection) => void;
}) {
  const id = useId();
  const [models, setModels] = useState<CodexModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void window.studio
      .codexModels()
      .then((catalog) => {
        if (active) setModels(catalog);
      })
      .catch((cause) => {
        if (active) {
          setModels([]);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refresh]);
  const selection = validCodexSelection(value, models);
  const model = models.find((entry) => entry.id === selection.model);
  const locked = disabled || loading;
  return (
    <div className="setting-section" aria-busy={loading}>
      <div className="section-heading">
        <h3>Sentence grouping</h3>
        <button
          type="button"
          className="text-button"
          aria-label="Refresh Codex models"
          disabled={locked}
          onClick={() => setRefresh((current) => current + 1)}
        >
          {loading ? (
            <LoaderCircle className="spin" size={13} />
          ) : (
            <RefreshCw size={13} />
          )}
          Refresh
        </button>
      </div>
      <div className="codex-controls">
        <div className="codex-model-field">
          <label className="field-label" htmlFor={`${id}-model`}>
            <Bot size={14} aria-hidden="true" />
            Codex model
          </label>
          <select
            id={`${id}-model`}
            value={model?.id ?? ""}
            disabled={locked || !models.length}
            title={model?.description}
            onChange={(event) => {
              const next = models.find(
                (entry) => entry.id === event.target.value,
              );
              if (next)
                onChange({
                  model: next.id,
                  reasoning: next.defaultReasoning,
                  fast: false,
                });
            }}
          >
            {!models.length && (
              <option value="">
                {loading ? "Loading models…" : "Models unavailable"}
              </option>
            )}
            {models.map((entry) => (
              <option value={entry.id} key={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </div>
        <div className="codex-reasoning-field">
          <label className="field-label" htmlFor={`${id}-reasoning`}>
            <Brain size={14} aria-hidden="true" />
            Reasoning
          </label>
          <select
            id={`${id}-reasoning`}
            value={model ? selection.reasoning : ""}
            disabled={locked || !model}
            onChange={(event) =>
              onChange({ ...selection, reasoning: event.target.value })
            }
          >
            {!model && (
              <option value="">{loading ? "Loading…" : "Unavailable"}</option>
            )}
            {(model?.reasoning ?? []).map((level) => (
              <option value={level} key={level}>
                {reasoningLabels[level] ?? level}
              </option>
            ))}
          </select>
        </div>
        {model?.fast && (
          <button
            type="button"
            className="button secondary codex-fast"
            disabled={locked}
            aria-pressed={selection.fast}
            title="Use the faster service tier supported by this model."
            onClick={() => onChange({ ...selection, fast: !selection.fast })}
          >
            <Zap size={15} fill={selection.fast ? "currentColor" : "none"} />
            Fast
          </button>
        )}
      </div>
      {error && (
        <p className="codex-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
