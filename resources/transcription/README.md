# Local WhisperX engine

Audio Mix Studio uses the same **WhisperX 3.8.6** engine, pinned Python 3.11.15,
uv 0.10.9, dependency hashes, model revisions, CPU int8 inference, Silero speech
detection and optional word alignment as [Vandashi](https://github.com/igormidev/Vandashi).
The default model is `large-v3-turbo`; only selected models are downloaded.

The engine, download manifests and bootstrap routines were adapted from Vandashi,
copyright (c) 2026 Igor, under its MIT license. The full notice is included in
`VANDASHI-LICENSE.txt`. Changes add read-only reuse of an existing Vandashi model
cache and omit music classification because every imported source is narration.

Python runs in a private application environment. Setup requires no administrator
permissions and never changes system Python. Current packaged support is macOS on
Apple Silicon. All wheel distributions require pinned hashes; the sole source
build, ANTLR's pure Python package, also has a pinned source hash and build tools.

WhisperX and its model inference run locally. Downloads use exact immutable
revisions, bounded file lengths and SHA-256 checks. Interrupted downloads use
temporary files; cancellation stops the worker and its descendants. An existing
Vandashi environment/cache is consumed read-only when its version/hash matches;
new models and alignment weights go into Audio Mix Studio's own cache.
Model download progress covers the whole selected model rather than restarting
for each weight/configuration file. Completed transcripts are cached by the exact
audio fingerprint, selected model and pinned engine revision so retrying semantic
grouping does not repeat successful local inference.

Supported alignment languages use separately downloaded language models. Other
languages retain the actual ASR segment timestamps without fabricated word times.
If forced alignment omits an unalignable word, the complete original ASR segments
are retained. These cases may have coarser cuts, which can be refined manually.
Silent media produces an empty transcript. Background semantic grouping receives
only transcript text and anonymous track IDs through the user's
installed, authenticated Codex CLI. Original audio files stay local.

Codex receives compact transcript units and returns inclusive word/segment indices;
the application maps those indices to exact local timestamps. Every spoken unit
must appear exactly once. Unknown sources, missing speech, duplicate coverage and
invalid ranges are rejected. Codex runs ephemerally in a temporary read-only
workspace with user configuration/rules, host skill discovery, shell execution,
apps, plugins, hooks, memory, agents, browsing and computer/image tools disabled.

## Upstream licenses

- [WhisperX](https://github.com/m-bain/whisperX/tree/v3.8.6): BSD-2-Clause.
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper/tree/v1.2.1),
  [CTranslate2](https://github.com/OpenNMT/CTranslate2),
  [Silero VAD](https://github.com/snakers4/silero-vad),
  [Whisper weights](https://github.com/openai/whisper): MIT.
- [LiteRT](https://github.com/google-ai-edge/LiteRT): Apache-2.0.
- [PyTorch](https://github.com/pytorch/pytorch): BSD-3-Clause.
- [uv](https://github.com/astral-sh/uv/tree/0.10.9): MIT or Apache-2.0.
- Alignment-model repositories, immutable revisions and individual licenses are
  recorded in `models.json`. Downloaded wheels and Python retain license metadata.
- NLTK Punkt data retains its model notices inside the downloaded archive.
