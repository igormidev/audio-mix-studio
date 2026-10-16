"""Narrow JSON-lines process boundary. Provider diagnostics never become protocol text."""
import contextlib
import json
import os
from pathlib import Path
import sys
import traceback

sys.dont_write_bytecode = True

output = sys.stdout
output.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")


def emit(value):
    output.write(json.dumps(value, allow_nan=False, ensure_ascii=False) + "\n")
    output.flush()


def main():
    request = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    cache = Path(request["cache"])
    inherited = Path(request["fallbackCache"]) if request.get("fallbackCache") else None
    nltk_paths = [str(cache / "nltk")]
    if inherited is not None:
        nltk_paths.append(str(inherited / "nltk"))
    os.environ.update({"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1",
                       "DO_NOT_TRACK": "1", "NLTK_DATA": os.pathsep.join(nltk_paths), "TOKENIZERS_PARALLELISM": "false",
                       "MPLCONFIGDIR": str(Path(sys.argv[1]).parent / "matplotlib")})
    with contextlib.redirect_stdout(sys.stderr):
        import downloads
        downloads.FALLBACK_CACHE = inherited
        from downloads import prepare
        if request["op"] == "health":
            import engine
            emit({"type": "ready"})
            return
        model_path = prepare(cache, request["model"], emit, request.get("readOnly", False))
        from engine import analyze
        if request["op"] == "prepare":
            # Actually load the model; a downloaded file alone is not usable-runtime evidence.
            import ctranslate2
            loaded = ctranslate2.models.Whisper(str(model_path), device="cpu", compute_type="int8", intra_threads=2)
            del loaded
            emit({"type": "ready"})
        elif request["op"] == "analyze":
            emit({"type": "result", "value": analyze(request, cache, model_path, emit)})
        else:
            raise ValueError("Unknown transcription operation")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
