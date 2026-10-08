import { isObject, num } from './text-style.ts';

/**
 * 字幕文档（`baocut.caption/1`）的正文：时间折成文档时钟上的秒。时间线与字幕面板读它；字幕画在渲染内核里
 * （`crates/frame-render` 经 `crates/subtitle-render`）。
 */

export interface CaptionCue {
  id: string;
  /** 在文档时钟上的秒。 */
  start: number;
  end: number;
  text: string;
}

export interface CaptionTrack {
  clock: 'source-asset' | 'sequence';
  cues: CaptionCue[];
}

const tracks = new WeakMap<object, CaptionTrack | null>();

/** 读字幕文档的正文；不是 `baocut.caption/1` 时返回 null。同一份正文只解析一次。 */
export function readCaptions(body: unknown): CaptionTrack | null {
  if (!isObject(body)) return null;
  const cached = tracks.get(body);
  if (cached !== undefined) return cached;
  let track: CaptionTrack | null = null;
  if (body.schema === 'baocut.caption/1' && Array.isArray(body.cues)) {
    const timescale = num(body.timescale, 1_000_000) || 1_000_000;
    const cues = body.cues.filter(isObject).map((cue, index) => {
      const start = num(cue.start, 0) / timescale;
      return {
        id: typeof cue.id === 'string' ? cue.id : `cue-${index}`,
        start,
        end: Math.max(start, num(cue.end, num(cue.start, 0)) / timescale),
        text: typeof cue.text === 'string' ? cue.text : '',
      };
    });
    track = { clock: body.clock === 'sequence' ? 'sequence' : 'source-asset', cues };
  }
  tracks.set(body, track);
  return track;
}
