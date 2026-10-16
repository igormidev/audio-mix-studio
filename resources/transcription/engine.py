"""Full-file local speech analysis. No user media is uploaded."""
import gc
import math
import zipfile

import numpy as np
import torch
from ai_edge_litert.interpreter import Interpreter
from silero_vad import get_speech_timestamps, load_silero_vad
import whisperx
from whisperx.vads.silero import Silero

from downloads import MANIFEST, model


class PackagedSilero(Silero):
    """Use wheel-owned weights, never WhisperX's mutable torch.hub source download."""
    def __init__(self):
        self.vad_onset = 0.5
        self.chunk_size = 30
        self.vad_pipeline = load_silero_vad()
        self.get_speech_timestamps = get_speech_timestamps


def classify(audio, cache, emit):
    if not np.isfinite(audio).all():
        raise ValueError("Decoded audio contains invalid samples")
    if not len(audio) or float(np.max(np.abs(audio))) < 0.0003:
        return "dialog"
    interpreter = Interpreter(model_path=str(cache / "yamnet.tflite"), num_threads=2)
    interpreter.allocate_tensors()
    input_info = interpreter.get_input_details()[0]
    output_info = interpreter.get_output_details()[0]
    width = int(np.prod(input_info["shape"]))
    with zipfile.ZipFile(cache / "yamnet.tflite") as archive:
        labels = archive.read("yamnet_label_list.txt").decode().splitlines()
    speech = [i for i, label in enumerate(labels) if label in {
        "Speech", "Child speech, kid speaking", "Conversation", "Narration, monologue",
        "Babbling", "Speech synthesizer", "Whispering", "Shout", "Yell", "Children shouting",
    }]
    music = labels.index("Music")
    maximum_speech, total_music, clear_frames, count = 0.0, 0.0, 0, 0
    for start in range(0, max(1, len(audio)), width // 2):
        samples = np.zeros(width, dtype=np.float32)
        chunk = audio[start:start + width]
        samples[:len(chunk)] = chunk
        interpreter.set_tensor(input_info["index"], samples.reshape(input_info["shape"]))
        interpreter.invoke()
        scores = interpreter.get_tensor(output_info["index"]).reshape(-1)
        maximum_speech = max(maximum_speech, float(np.max(scores[speech])))
        total_music += float(scores[music])
        clear_frames += int(float(np.max(scores)) >= 0.5)
        count += 1
        if count % 100 == 0:
            emit({"type": "progress", "phase": "classifying", "fraction": min(1, (start + width) / max(1, len(audio)))})
        # Speech anywhere must not be erased by music elsewhere or by a global mean.
        if maximum_speech >= 0.12:
            return "dialog"
    if total_music / count >= 0.5:
        return "music"
    if total_music / count < 0.15 and clear_frames / count >= 0.9:
        return "sound-effect"
    return "dialog"


def clean_segments(values, duration, word=False):
    result = []
    for value in values:
        start, end = value.get("start"), value.get("end")
        text = value.get("word" if word else "text", "").strip()
        if start is None or end is None or not text:
            continue
        if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end < start or end > duration + 0.1:
            raise ValueError("Transcriber returned invalid timestamps")
        result.append({"start": min(duration, start), "end": min(duration, end), "text": text})
    return result


def analyze(request, cache, model_path, emit):
    audio = np.memmap(request["pcmPath"], dtype="<f4", mode="c")
    duration = len(audio) / 16000
    category = request.get("category")
    source = "video" if request["kind"] == "video" else "user" if category else "classifier"
    if request["kind"] == "video":
        category = "dialog"
    elif category is None:
        emit({"type": "progress", "phase": "classifying"})
        category = classify(audio, cache, emit)
    result = {"schemaVersion": 1, "sourceHash": request["sourceHash"], "category": category, "categorySource": source}
    if category != "dialog":
        result["transcription"] = {"status": "not-required", "reason": category}
        return result
    emit({"type": "progress", "phase": "transcribing"})
    vad = PackagedSilero()
    # No speech is a completed analysis, not a missing transcript or an ASR hallucination.
    speech = get_speech_timestamps(torch.from_numpy(np.array(audio)), vad.vad_pipeline, sampling_rate=16000)
    transcript = {"status": "complete", "engine": "whisperx", "model": request["model"], "language": None,
                  "duration": duration, "alignment": "none", "segments": [], "words": []}
    result["transcription"] = transcript
    if not speech:
        return result
    transcriber = whisperx.load_model(str(model_path), "cpu", compute_type="int8", vad_model=vad,
                                    local_files_only=True, threads=2)
    raw = transcriber.transcribe(np.asarray(audio), batch_size=1,
                                progress_callback=lambda percent: emit({"type": "progress", "phase": "transcribing", "fraction": percent / 100}))
    del transcriber
    gc.collect()
    language = raw["language"]
    transcript["language"] = language
    transcript["segments"] = clean_segments(raw["segments"], duration)
    transcript["alignment"] = "segment" if transcript["segments"] else "none"
    if transcript["segments"] and language in MANIFEST["alignment"]:
        emit({"type": "progress", "phase": "aligning"})
        alignment_path = model(cache, "alignment", language, emit, request.get("readOnly", False))
        aligned_model, metadata = whisperx.load_align_model(language, "cpu", model_name=str(alignment_path), model_cache_only=True)
        aligned = whisperx.align(raw["segments"], aligned_model, metadata, np.asarray(audio), "cpu",
                                return_char_alignments=False,
                                progress_callback=lambda percent: emit({"type": "progress", "phase": "aligning", "fraction": percent / 100}))
        # Keep the complete ASR text even if forced alignment omits an unalignable word.
        transcript["words"] = clean_segments(aligned["word_segments"], duration, word=True)
        transcript["alignment"] = "word" if transcript["words"] else "segment"
    return result
