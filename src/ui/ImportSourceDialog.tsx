import { useEffect, useRef } from "react";
import {
  ArrowUpRight,
  AudioLines,
  FolderOpen,
  Library,
  Music2,
  X,
} from "lucide-react";
import type { EpidemicKind } from "../shared/epidemic";
import "./source-choice.css";

export function ImportSourceDialog({
  kind,
  hasLibrary,
  onChoose,
}: {
  kind: EpidemicKind;
  hasLibrary: boolean;
  onChoose: (source: "epidemic" | "computer" | "library" | null) => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.querySelector<HTMLButtonElement>("button")?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onChoose(null);
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        element?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),a[href]",
        ) ?? [],
      );
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("keydown", keys);
      previous?.focus();
    };
  }, [onChoose]);
  return (
    <div
      className="modal-backdrop source-choice-backdrop"
      onClick={() => onChoose(null)}
    >
      <section
        ref={dialog}
        className="modal source-choice-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-choice-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="eyebrow">BUILD YOUR SOUND</span>
            <h2 id="source-choice-title">
              Add {kind === "music" ? "music" : "a sound effect"}
            </h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close audio source chooser"
            onClick={() => onChoose(null)}
          >
            <X size={19} />
          </button>
        </header>
        <p>Find the sound your story needs. Choose where to bring it from.</p>
        <div className="source-choice-options">
          <button
            className="source-choice-card source-epidemic"
            onClick={() => onChoose("epidemic")}
          >
            <span className="source-choice-mark">
              <AudioLines size={30} />
            </span>
            <span className="source-choice-tag">EXPLORE THE CATALOG</span>
            <strong>Epidemic Sound</strong>
            <span>
              Discover music and effects, listen here, and add your favorite.
            </span>
            <span className="source-choice-foot">
              Browse sounds <ArrowUpRight size={16} />
            </span>
          </button>
          <button
            className="source-choice-card"
            onClick={() => onChoose("computer")}
          >
            <span className="source-choice-mark">
              <FolderOpen size={30} />
            </span>
            <span className="source-choice-tag">YOUR OWN AUDIO</span>
            <strong>This Mac</strong>
            <span>
              Choose a file from your computer. Your original stays untouched.
            </span>
            <span className="source-choice-foot">
              Choose an audio file <ArrowUpRight size={16} />
            </span>
          </button>
        </div>
        <footer>
          {hasLibrary ? (
            <button className="text-button" onClick={() => onChoose("library")}>
              <Library size={16} />
              Use audio already in this project
            </button>
          ) : (
            <span>
              <Music2 size={14} />
              Your project library stays available as you arrange.
            </span>
          )}
        </footer>
      </section>
    </div>
  );
}
