import { useEffect, useRef, useState } from "react";
import {
  AudioLines,
  Check,
  Mic2,
  Music2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";
import type { AudioRole, AudioTrack } from "../shared/types";
import { Waveform } from "./Waveform";
import { clock } from "./format";

const kinds = [
  {
    role: "voiceover",
    label: "Voiceover",
    description: "A narration take to compare sentence by sentence.",
    Icon: Mic2,
  },
  {
    role: "soundtrack",
    label: "Sound effect",
    description: "An accent, atmosphere, or sound-design moment.",
    Icon: AudioLines,
  },
  {
    role: "music",
    label: "Music",
    description: "A score or music bed underneath your story.",
    Icon: Music2,
  },
] as const;

export function ImportKindDialog({
  track,
  onChoose,
  initialRole = "voiceover",
}: {
  track: AudioTrack;
  initialRole?: AudioRole;
  onChoose: (role: AudioRole | null) => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [rate, setRate] = useState(1);
  const [role, setRole] = useState<AudioRole>(initialRole);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current;
    const prior = document.activeElement as HTMLElement | null;
    element?.querySelector<HTMLButtonElement>("button")?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onChoose(null);
      }
      if (event.key !== "Tab") return;
      const items = Array.from(
        element?.querySelectorAll<HTMLElement>("button,input,select") ?? [],
      );
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keys);
    const player = audio.current;
    return () => {
      player?.pause();
      document.removeEventListener("keydown", keys);
      prior?.focus();
    };
  }, [onChoose]);
  const seek = (value: number) => {
    const time = Math.max(0, Math.min(track.duration, value));
    if (audio.current) audio.current.currentTime = time;
    setPosition(time);
  };
  return (
    <div className="modal-backdrop import-backdrop">
      <section
        ref={dialog}
        className="modal import-kind-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-kind-title"
      >
        <header>
          <div>
            <span className="eyebrow">ADD TO YOUR LIBRARY</span>
            <h2 id="import-kind-title">What are we listening to?</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Cancel import"
            onClick={() => onChoose(null)}
          >
            <X size={19} />
          </button>
        </header>
        <div className="import-audition">
          <strong title={track.name}>{track.name}</strong>
          <div className="import-wave">
            <Waveform peaks={track.peaks} bars={200} />
            <span style={{ left: `${(position / track.duration) * 100}%` }} />
          </div>
          <audio
            ref={audio}
            src={track.mediaUrl}
            preload="metadata"
            onTimeUpdate={() => setPosition(audio.current?.currentTime ?? 0)}
            onEnded={() => setPlaying(false)}
            onPause={() => setPlaying(false)}
            onPlay={() => setPlaying(true)}
            onError={() =>
              setError(
                "This audio could not be previewed. Try importing it again.",
              )
            }
          />
          <div className="import-transport">
            <button
              className="icon-button"
              aria-label="Back 5 seconds"
              onClick={() => seek(position - 5)}
            >
              <SkipBack size={17} />
            </button>
            <button
              className="play-master"
              aria-label={
                playing ? "Pause imported audio" : "Play imported audio"
              }
              onClick={() => {
                if (playing) audio.current?.pause();
                else
                  void audio.current
                    ?.play()
                    .catch(() => setError("Could not play this audio."));
              }}
            >
              {playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button
              className="icon-button"
              aria-label="Forward 5 seconds"
              onClick={() => seek(position + 5)}
            >
              <SkipForward size={17} />
            </button>
            <span>
              {clock(position)} / {clock(track.duration)}
            </span>
            <label>
              Listen at{" "}
              <select
                aria-label="Import preview speed"
                value={rate}
                onChange={(event) => {
                  const speed = Number(event.target.value);
                  setRate(speed);
                  if (audio.current) {
                    audio.current.preservesPitch = true;
                    audio.current.playbackRate = speed;
                  }
                }}
              >
                {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((value) => (
                  <option key={value} value={value}>
                    {value}×
                  </option>
                ))}
              </select>
            </label>
          </div>
          <input
            type="range"
            aria-label="Seek imported audio"
            min={0}
            max={track.duration}
            step={0.01}
            value={position}
            onChange={(event) => seek(Number(event.target.value))}
          />
          {error && <p role="alert">{error}</p>}
        </div>
        <div
          className="import-kind-options"
          role="radiogroup"
          aria-label="Audio type"
        >
          {kinds.map(({ role: kind, label, description, Icon }) => (
            <button
              key={kind}
              role="radio"
              aria-checked={role === kind}
              className={`import-kind-option ${role === kind ? "selected" : ""}`}
              onClick={() => setRole(kind)}
            >
              <span className={`kind-icon kind-${kind}`}>
                <Icon size={25} />
              </span>
              <strong>{label}</strong>
              <small>{description}</small>
              <span className="kind-check">
                {role === kind && <Check size={13} />}
              </span>
            </button>
          ))}
        </div>
        <footer className="modal-actions">
          <button className="button secondary" onClick={() => onChoose(null)}>
            Cancel
          </button>
          <button className="button primary" onClick={() => onChoose(role)}>
            <Check size={15} />
            Add {kinds.find((kind) => kind.role === role)?.label.toLowerCase()}
          </button>
        </footer>
      </section>
    </div>
  );
}
