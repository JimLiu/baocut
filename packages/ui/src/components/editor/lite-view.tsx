import { useEffect, useMemo, useState, type RefObject } from 'react';
import type { Sequence, VideoSnapshot } from '@baocut/protocol';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { sequenceChapters } from '../../model/chapters.ts';
import { durationSeconds } from '../../model/editor.ts';
import {
  DEFAULT_LITE_LOOP,
  liteLoopJump,
  liteLoopMaxStep,
  liteLoopRange,
  liteSegments,
  type LiteLoopMode,
  type LiteSegment,
} from '../../model/lite-segments.ts';
import { useEditor } from '../../state/editor-store.ts';
import type { OpenVideo } from '../../state/video-store.ts';
import { useEditorActions } from './editor-context.tsx';
import { FontBar } from './font-bar.tsx';
import { LiteChips, type LiteChipsHandle } from './lite-chips.tsx';
import { LiteSidePanel } from './lite-side-panel.tsx';
import { LiteTransport } from './lite-transport.tsx';
import { Preview } from './preview.tsx';
import { SoundtrackBed } from './soundtrack-bed.tsx';
import { StageLiveCaptions } from './stage-live.tsx';
import { TimelineChapters } from './timeline-chapters.tsx';
import { useChapterScripts, useLiteLines } from './use-lite-lines.ts';
import { VIDEO_BAR_COPY as VB } from './video-bar-copy.ts';
import { VersionsStrip } from './video-versions-conflict.tsx';

const body = style({ display: 'flex', flexGrow: 1, minHeight: 0, minWidth: 0, overflow: 'hidden' });
const column = style({
  display: 'flex',
  flexDirection: 'column',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '[320px]',
  minWidth: 0,
  minHeight: 0,
});

/** 片尾算「播到头」的容差（秒）：引擎停在片尾的那一帧附近。 */
const END_EPSILON = 0.1;

/** 轻量视图里的段与片条的缩放口，给编辑器的快捷键用（video-editor.tsx）。 */
export interface LiteHandle extends LiteChipsHandle {
  segments: readonly LiteSegment[];
}

/**
 * 轻量视图（轻量编辑器设计 §3、§5；原型 editor-lite.jsx）：视频栏之下换掉时间线那一列——画面与舞台条（`Preview` 的 lite 档：
 * 标记、音量、全屏、侧栏开关）、章节条（与时间线共用 `TimelineChapters`，悬停出那一刻的画面）、走带、片条；右边是固定宽的侧栏。
 * 段按设计 §2 从章节、转写或整条推出来（`liteSegments`）。循环方式是这个窗口的观看态，默认整片循环。
 * 引擎、播放头、倍速与标注模式都在 editor-store 里，两种视图切换时不丢。
 */
export function LiteView({
  video,
  sequence,
  shown,
  snapshot,
  handle,
}: {
  video: OpenVideo;
  sequence: Sequence;
  /** 叠了属性页草稿的序列（与时间线视图的 `shown` 同一份），画面照它画。 */
  shown: Sequence;
  snapshot: VideoSnapshot;
  handle: RefObject<LiteHandle | null>;
}) {
  const { seek, togglePlay } = useEditorActions();
  const sideHidden = useEditor((s) => s.liteSideHidden);
  const [loop, setLoop] = useState<LiteLoopMode>(DEFAULT_LITE_LOOP);
  const duration = durationSeconds(sequence);
  const lines = useLiteLines(sequence, snapshot.assets, snapshot.documents);
  const scripts = useChapterScripts(sequence.id, snapshot.documents);
  const chapters = useMemo(() => sequenceChapters(sequence), [sequence]);
  const title = snapshot.name || video.ref?.name || VB.untitled;
  const segments = useMemo(() => liteSegments({ chapters, lines, duration, title, scripts }), [chapters, lines, duration, title, scripts]);
  const chips = useMemo<{ current: LiteChipsHandle | null }>(() => ({ current: null }), []);

  // 把段与片条的缩放口合成一个给快捷键；片条的 handle 在它挂上后才有。
  useEffect(() => {
    handle.current = { segments, zoom: (action) => chips.current?.zoom(action) };
    return () => {
      handle.current = null;
    };
  }, [handle, segments, chips]);

  // 循环：引擎播到片尾会把 playing 置回 false，这时回到循环那一截的开头再开播（整片回 0，当前段回最后一段的段首）；
  // 当前段循环还要在播过段尾时跳回段首：`liteLoopJump` 只认往前、不比真实经过的时间走得快的一步，拖动、点片、上一段 / 下一段不算。
  useEffect(() => {
    if (loop === 'off') return;
    let lastAt = performance.now();
    return useEditor.subscribe((state, previous) => {
      const now = performance.now();
      const elapsed = (now - lastAt) / 1000;
      lastAt = now;
      if (!previous.playing) return;
      if (!state.playing) {
        const range = liteLoopRange(segments, loop, previous.playhead, duration);
        if (!range || state.playhead < duration - END_EPSILON) return;
        seek(range.start);
        togglePlay();
        return;
      }
      const jump = liteLoopJump(segments, loop, previous.playhead, state.playhead, duration, liteLoopMaxStep(elapsed, state.rate));
      if (jump != null) seek(jump);
    });
  }, [loop, segments, duration, seek, togglePlay]);

  return (
    <div className={body}>
      <div className={column}>
        <FontBar videoId={video.videoId} />
        <VersionsStrip video={video} />
        <Preview
          videoId={video.videoId}
          sequence={shown}
          assets={snapshot.assets}
          documents={snapshot.documents}
          lite
          segments={segments}
        />
        <StageLiveCaptions videoId={video.videoId} sequence={shown} documents={snapshot.documents} />
        <TimelineChapters sequence={sequence} />
        <LiteTransport
          sequence={sequence}
          segments={segments}
          loop={loop}
          onLoop={setLoop}
          onZoom={(action) => chips.current?.zoom(action)}
        />
        <LiteChips segments={segments} duration={duration} handle={chips} />
      </div>
      {sideHidden ? null : (
        <LiteSidePanel
          segments={segments}
          videoId={video.videoId}
          sequence={sequence}
          documents={snapshot.documents}
          assets={snapshot.assets}
        />
      )}
      {video.videoId ? <SoundtrackBed videoId={video.videoId} sequence={sequence} assets={snapshot.assets} /> : null}
    </div>
  );
}
