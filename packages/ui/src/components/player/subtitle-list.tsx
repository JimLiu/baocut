import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ActionButton, Text } from '@react-spectrum/s2';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { formatClock } from '../../model/format.ts';
import { activeCues, nearIndex, type Cue } from '../../model/subtitles.ts';
import { usePlaybackTime, type PlaybackController } from './playback.ts';
import { P } from './player-copy.ts';

const wrap = style({ position: 'relative', display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 });
const list = style({ flexGrow: 1, minHeight: 0, overflowY: 'auto', margin: 0, padding: 4, listStyleType: 'none' });
const follow = style({ position: 'absolute', bottom: 12, insetX: 0, display: 'flex', justifyContent: 'center', pointerEvents: 'none' });
const followButton = style({ display: 'flex', pointerEvents: 'auto' });

/**
 * 与画面同步的字幕列表（产品设计 §11.1 的 0.3）。当前句高亮，播放时跟着滚；用户自己滚了就不再跟，
 * 给一个「回到当前句」（架构设计 §11.6：播放不和用户抢滚动）。点一句跳到那里。
 */
export function SubtitleList({
  cues,
  controller,
  onSeek,
}: {
  cues: readonly Cue[];
  controller: PlaybackController | null;
  onSeek: (cue: Cue) => void;
}) {
  // 只订阅由时间推出的两个值：正在显示的句子（可能重叠）与该滚到的那一句，句子变了才重画。
  const activeKey = usePlaybackTime(controller, (t) =>
    activeCues(cues, t)
      .map((c) => c.index)
      .join(','),
  );
  const near = usePlaybackTime(controller, (t) => nearIndex(cues, t));
  const [following, setFollowing] = useState(true);
  const [focusRow, setFocusRow] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const seekRef = useRef(onSeek);
  seekRef.current = onSeek;
  const activate = useCallback((cue: Cue) => {
    setFocusRow(cue.index);
    setFollowing(true);
    seekRef.current(cue);
  }, []);

  useEffect(() => {
    if (!following || near === null) return;
    listRef.current?.querySelector<HTMLElement>(`[data-cue="${near}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [following, near]);

  const active = new Set(activeKey ? activeKey.split(',').map(Number) : []);
  const tabRow = focusRow ?? near ?? 1;

  const onKeyDown = (e: KeyboardEvent<HTMLOListElement>) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-cue]');
    if (!row) return;
    const index = Number(row.dataset.cue);
    const next =
      e.key === 'ArrowDown' ? index + 1 : e.key === 'ArrowUp' ? index - 1 : e.key === 'Home' ? 1 : e.key === 'End' ? cues.length : null;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    const clamped = Math.min(cues.length, Math.max(1, next));
    setFocusRow(clamped);
    setFollowing(false);
    listRef.current?.querySelector<HTMLElement>(`[data-cue="${clamped}"] button`)?.focus();
  };

  return (
    <div className={wrap}>
      <ol
        ref={listRef}
        className={`${list} bc-scroll`}
        aria-label={P.subtitles}
        onKeyDown={onKeyDown}
        onWheel={() => setFollowing(false)}
        onTouchMove={() => setFollowing(false)}
        // 按在滚动条上（目标是列表本身）也算用户自己滚。
        onPointerDown={(e) => e.target === e.currentTarget && setFollowing(false)}>
        {cues.map((cue) => (
          <CueRow
            key={cue.index}
            cue={cue}
            active={active.has(cue.index)}
            played={near !== null && cue.index < near && !active.has(cue.index)}
            tabbable={cue.index === tabRow}
            onActivate={activate}
          />
        ))}
      </ol>
      {!following && near !== null ? (
        <div className={follow}>
          <span className={followButton}>
            <ActionButton size="S" onPress={() => setFollowing(true)}>
              <ChevronDown />
              <Text>{P.backToCurrent}</Text>
            </ActionButton>
          </span>
        </div>
      ) : null}
    </div>
  );
}

const CueRow = memo(function CueRow({
  cue,
  active,
  played,
  tabbable,
  onActivate,
}: {
  cue: Cue;
  active: boolean;
  played: boolean;
  tabbable: boolean;
  onActivate: (cue: Cue) => void;
}) {
  return (
    <li data-cue={cue.index} className="bc-cue">
      <button
        type="button"
        className="bc-cue-button"
        data-active={active || undefined}
        data-played={played || undefined}
        aria-current={active || undefined}
        tabIndex={tabbable ? 0 : -1}
        onClick={() => onActivate(cue)}>
        <span className="bc-cue-meta">
          <span>{cue.index}</span>
          <span>{formatClock(cue.start, { tenths: true })}</span>
        </span>
        <span className="bc-cue-text">{cue.text}</span>
      </button>
    </li>
  );
});
