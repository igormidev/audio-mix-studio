# Pitch-preserving tempo

Audio Mix Studio uses the external SoundTouch `soundstretch` program to change duration while preserving pitch. FFmpeg handles decoding, sample trimming, fades, layering, and final encoding. Neither pitch shift nor playback-rate transposition is used for tempo changes.

## Audacity source inspection

As requested, the upstream Audacity repository was cloned outside this application's workspace and inspected at commit [`cd9074f148e5918ad79513be1ad6619f46227d18`](https://github.com/audacity/audacity/tree/cd9074f148e5918ad79513be1ad6619f46227d18).

The relevant sources are:

- [`au3/libraries/au3-builtin-effects/ChangeTempoBase.cpp`](https://github.com/audacity/audacity/blob/cd9074f148e5918ad79513be1ad6619f46227d18/au3/libraries/au3-builtin-effects/ChangeTempoBase.cpp): the default Change Tempo branch initializes SoundTouch with `setTempoChange`, and maps the output duration to source duration divided by the tempo ratio. Its separate optional high-quality branch delegates to SBSMS with unchanged pitch.
- [`au3/libraries/au3-builtin-effects/SoundTouchBase.cpp`](https://github.com/audacity/audacity/blob/cd9074f148e5918ad79513be1ad6619f46227d18/au3/libraries/au3-builtin-effects/SoundTouchBase.cpp): sets the source sample rate and channel count, feeds floating-point samples, receives processed samples, and flushes the processor at the end of the selection.
- [`au3/src/effects/ChangeTempo.cpp`](https://github.com/audacity/audacity/blob/cd9074f148e5918ad79513be1ad6619f46227d18/au3/src/effects/ChangeTempo.cpp): exposes percent change and duration controls around that processing contract.

This application follows that tempo-only SoundTouch behavior through its separately installed CLI. It does not copy or embed Audacity source, reproduce every Audacity effect, or claim to reproduce its optional SBSMS path. SoundTouch remains an external LGPL dependency; the application retains its own MIT license. Upstream [SoundTouch](https://www.surina.net/soundtouch/) and the [Audacity Change Tempo manual](https://manual.audacityteam.org/man/change_tempo.html) describe independent tempo and pitch processing.

## Installation and discovery

Install with `brew install sound-touch`. The implementation was verified using SoundTouch 2.4.1. Studio settings discovers and runs `soundstretch`, reports its availability, and supplies a copyable AI installation prompt when it is missing. Finder launches search standard Homebrew locations as well as the shell PATH. A 1× recording needs no tempo processor; changing its speed requires SoundTouch and reports an actionable error if it cannot run.

## Shared processing and timing

A logical clip is trimmed on the 48 kHz sample grid, converted to floating-point WAV, and processed with `-tempo=(ratio−1)×100`. The result is padded or trimmed to the exact rounded output-frame count. No extra fades or gaps are added by tempo processing. Voiceover sentence offsets are recomputed in sequence, so changing sentence speed keeps neighbors together except for explicitly requested joint pauses.

Processed intervals are cached under the application's own `tempo-cache` directory. Keys include the immutable imported source ID, sample boundaries, tempo ratio, processing revision, and installed engine file identity. In-flight creation is shared per interval; cancellation of an owner does not prevent another live request from retrying. Completed files are installed by atomic rename. Original audio and other applications' caches are not changed.

Bounded previews of a long logical clip carry its complete source interval to the host. SoundTouch processes that complete interval once, and subsequent preview chunks and seeks read windows from the same result used by export. This prevents the processor from restarting its overlap analysis at every playback chunk. Multitrack previews use the same sample-accurate mix graph and fade expressions as export; each preview request returns at most 60 seconds of PCM, and the player normally requests 20-second windows. Shared source inputs are deduplicated for export, while window previews seek to their required source position before applying the correctly offset fade envelope.

## Keyframe behavior and limits

A keyframe marks a boundary in source time. Each interval has its own constant tempo ratio, gain, fade durations, fade positions, and curve. Editing interval speed changes its output duration and moves the following intervals of that clip. These are explicit interval settings, not a continuously accelerating tempo ramp or automatic gain interpolation. The curve presets and custom exponent control the shape of the selected interval's fade.

The UI offers 0.5× through 2× speed in one-percent steps. Previously saved voiceover speeds through 2.5× remain readable. Pitch-preserving time stretching resynthesizes audio; extreme rates and abrupt interval changes can still produce audible processing artifacts. This is the same practical distinction as Audacity's tempo change versus a promise of distortion-free audio.

## Verification

Real generated-audio tests verify unchanged pitch at 0.5×, 0.73×, 1.37×, and 2×; exact sample counts; simultaneous voiceover/music/effect layers; interval-specific tempo; delayed/custom fades; cancellation; and preview/export agreement within floating-point and 24-bit export rounding. A 127-second source also verifies agreement across decoder chunks and a late seek. Existing original-source sample equality, joint pause, cut order, recovery, and playback scheduling checks remain part of the suite.
