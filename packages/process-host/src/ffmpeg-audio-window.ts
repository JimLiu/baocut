/**
 * How far ahead of a window an audio decode seeks. The rest is cut from decoded frames, by timestamp.
 *
 * What a decoder discards after an input-side `-ss` depends on the ffmpeg version, so nothing here relies on it. Since
 * FFmpeg 9.0 the mov demuxer exports its edit-list offset as `initial_padding`, the decoder takes that as samples to skip,
 * and a seek does not clear the count, so the first audio decoded after any `-ss`, even `-ss 0`, is lost. The frames that
 * survive keep their correct timestamps, but raw PCM carries none and `asetpts=PTS-STARTPTS` drops them, so the window plays
 * early by however much was lost.
 *
 * How much that is depends on the file (measured on 9.0.2):
 * - AAC priming: up to 2112 frames, about 23 ms from ffmpeg's encoder at 44.1 kHz.
 * - A file already cut with `-c copy`: the distance from the first packet it kept to the edit, of any codec the demuxer
 *   gives an offset to. AAC, MP3, AC-3 and even PCM lost 36864 frames (0.77 s) from a cut with a 1 s GOP.
 *
 * The longest reach measured was a little over 1 s: a margin of 1 s still came up about 13 ms short on a cut file, and 1.5 s
 * did not. The margin is 2 s because decoding audio is cheap, so a late window in a long file costs next to nothing.
 */
export const AUDIO_SEEK_MARGIN_SEC = 2;

export interface AudioWindow {
  /** Options that go before `-i`. */
  inputArgs: string[];
  /**
   * Filters that have to run first on the decoded audio, before anything that changes its timing such as `atempo`.
   * Empty when the window starts at the top of the file, where nothing is cut.
   */
  filters: string[];
}

/**
 * Decode `[startSec, startSec + durationSec)` of an input's audio; a null duration runs to the end. Seeks
 * `AUDIO_SEEK_MARGIN_SEC` ahead of the window, or not at all inside that margin, and cuts the window with `atrim`.
 *
 * Only for decoded audio. A video stream on the same input would start up to the margin too early, and `-c:a copy` runs no
 * filters; neither has anything to lose, since the discard happens in the audio decoder.
 */
export function audioWindow(startSec: number, durationSec: number | null): AudioWindow {
  const start = Math.max(0, startSec);
  const trim = Math.min(start, AUDIO_SEEK_MARGIN_SEC);
  const seek = start - trim;
  return {
    inputArgs: [
      ...(seek > 0 ? ['-ss', seek.toFixed(6)] : []),
      ...(durationSec !== null ? ['-t', (trim + durationSec).toFixed(6)] : []),
    ],
    filters: trim > 0 ? [`atrim=start=${trim.toFixed(6)}`, 'asetpts=PTS-STARTPTS'] : [],
  };
}
