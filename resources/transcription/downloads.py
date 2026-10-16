"""Revision-pinned, bounded model downloads shared by prepare and analysis."""
import hashlib
import json
import os
from pathlib import Path
import ssl
import tempfile
import urllib.request
import zipfile

import certifi

MANIFEST = json.loads(Path(__file__).with_name("models.json").read_text())
FALLBACK_CACHE = None


def fallback(cache, path, record):
    """Consume verified Vandashi files without creating locks or writing there."""
    if FALLBACK_CACHE is not None:
        candidate = FALLBACK_CACHE / path.relative_to(cache)
        if valid(candidate, record):
            return candidate
    return None


def valid(path, record):
    if path.is_symlink() or not path.is_file() or path.stat().st_size != record["size"]:
        return False
    sha = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            sha.update(block)
    return sha.hexdigest() == record["sha256"]


def download(path, record, emit, read_only=False):
    if valid(path, record):
        return
    if read_only:
        raise ValueError("Required transcription model is not prepared. Open Vandashi to install it.")
    path.parent.mkdir(parents=True, exist_ok=True)
    # The app/CLI runtime lock excludes other workers. Recover only our interrupted downloads.
    for stale in path.parent.glob(path.name + ".*.partial"):
        stale.unlink(missing_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=path.name + ".", suffix=".partial", delete=False) as target:
            temporary = Path(target.name)
            sha, received = hashlib.sha256(), 0
            context = ssl.create_default_context(cafile=certifi.where())
            with urllib.request.urlopen(record["url"], context=context, timeout=60) as response:
                while block := response.read(1024 * 1024):
                    received += len(block)
                    if received > record["size"]:
                        raise ValueError("Model download exceeds its pinned size")
                    target.write(block)
                    sha.update(block)
                    emit({"type": "progress", "phase": "model-download", "fraction": received / record["size"]})
            if received != record["size"] or sha.hexdigest() != record["sha256"]:
                raise ValueError("Model checksum does not match its pinned manifest")
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def model(cache, group, key, emit, read_only=False):
    record = MANIFEST[group][key]
    directory = cache / group / key / record["revision"]
    if FALLBACK_CACHE is not None:
        existing = FALLBACK_CACHE / group / key / record["revision"]
        if all(valid(existing / file["path"], file) for file in record["files"]):
            return existing
    total = sum(file["size"] for file in record["files"])
    completed = 0
    for file in record["files"]:
        def model_progress(event):
            if event.get("type") == "progress" and event.get("phase") == "model-download":
                event = {**event, "fraction": (completed + file["size"] * event["fraction"]) / total}
            emit(event)
        download(directory / file["path"], file, model_progress, read_only)
        completed += file["size"]
    return directory


def prepare(cache, name, emit, read_only=False):
    model_path = model(cache, "asr", name, emit, read_only)
    # Narration is always dialogue, so Audio Mix Studio never needs YAMNet inference.
    # Keep the same pinned WhisperX/Punkt engine while reusing the existing tokenizer.
    tokenizer = cache / "punkt_tab.zip"
    inherited = fallback(cache, tokenizer, MANIFEST["punkt"])
    if inherited is not None:
        inherited_marker = inherited.parent / "nltk" / "tokenizers" / "punkt_tab" / ".verified"
        if inherited_marker.is_file() and inherited_marker.read_text() == MANIFEST["punkt"]["sha256"]:
            return model_path
    download(tokenizer, MANIFEST["punkt"], emit, read_only)
    marker = cache / "nltk" / "tokenizers" / "punkt_tab" / ".verified"
    if not marker.is_file() or marker.read_text() != MANIFEST["punkt"]["sha256"]:
        if read_only:
            raise ValueError("Required alignment tokenizer is not prepared. Open Vandashi to install it.")
        destination = marker.parent.parent
        destination.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(cache / "punkt_tab.zip") as archive:
            for entry in archive.infolist():
                relative = Path(entry.filename)
                if relative.is_absolute() or ".." in relative.parts or relative.parts[0] != "punkt_tab":
                    raise ValueError("Invalid tokenizer archive member")
            archive.extractall(destination)
        marker.write_text(MANIFEST["punkt"]["sha256"])
    return model_path
