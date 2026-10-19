import { useEffect, useState } from 'react';
import { localizeText, type HistoryEntry } from '@baocut/protocol';
import { Button, ProgressCircle, ToastQueue } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { agoLabel } from '../../model/format.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { useNow } from '../use-now.ts';
import { useEditorActions } from './editor-context.tsx';
import { VIDEO_BAR_COPY as VB } from './video-bar-copy.ts';

/**
 * 历史对话框的「修改」视图（产品设计 §5.1、§5.5；原型 video-versions.jsx 的 Changes）：撤销历史，每笔提交是一个修订，
 * 新的在前，可以单独撤销其中一笔；与之后的修改冲突时引擎会拒绝并说明。不在项目里的视频也有。
 */
export function VideoChanges({ revision }: { revision: string | null }) {
  const runtime = useRuntime();
  const { undo } = useEditorActions();
  const editable = useVideo((s) => canEdit(s.video));
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const now = useNow(30_000);

  useEffect(() => {
    let cancelled = false;
    // 引擎按版本从新到旧返回：最近的修改在最上面。修订号变了（撤销、智能体在改）再读一次。
    runtime.videos.history(100).then(
      (list) => !cancelled && setEntries(list),
      (error: Error) => !cancelled && ToastQueue.negative(VB.historyFailed(error.message), { timeout: 5000 }),
    );
    return () => {
      cancelled = true;
    };
  }, [runtime, revision]);

  if (entries === null)
    return (
      <div className={emptyBox}>
        <ProgressCircle isIndeterminate aria-label={VB.historyLoading} />
      </div>
    );
  if (entries.length === 0)
    return (
      <div className={emptyBox}>
        <span className={entryMeta}>{VB.noChanges}</span>
      </div>
    );
  return (
    <ul className={`${list} bc-scroll`}>
      {entries.map((item) => {
        const undone = Boolean(item.undoneBy);
        return (
          <li key={item.transactionId} className={entry}>
            <span className={entryText}>
              <span className={entryLabel({ isUndone: undone })}>
                {localizeText(item.label, item.labelRef)}
                {undone ? VB.undoneMark : ''}
              </span>
              <span className={entryMeta}>{VB.historyMeta(item.videoRevision, actorLabel(item), agoLabel(item.committedAt, now))}</span>
            </span>
            {item.undoAvailable && !undone ? (
              <Button variant="secondary" size="S" isDisabled={!editable} onPress={() => void undo({ transaction: item.transactionId })}>
                {VB.undo}
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function actorLabel(entry: HistoryEntry): string {
  if (entry.actor.kind === 'agent') return VB.actorAgent;
  if (entry.actor.kind === 'system') return VB.actorSystem;
  return VB.actorYou;
}

/* ---------- 样式（原型 video-versions.css 的 vh-changes） ---------- */

const NARROW = '@media (max-width: 720px)';

const list = style({
  flexGrow: 1,
  minHeight: 0,
  overflowY: 'auto',
  margin: 0,
  paddingY: 8,
  paddingX: { default: 24, [NARROW]: 16 },
  listStyleType: 'none',
});
const entry = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  paddingY: 8,
  borderBottomWidth: { default: 1, ':last-child': 0 },
  borderTopWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-100',
});
const entryText = style({ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 });
const entryLabel = style({ font: 'ui', color: { default: 'gray-900', isUndone: 'gray-600' } });
const entryMeta = style({ font: 'ui-xs', color: 'gray-600' });
const emptyBox = style({ display: 'grid', placeItems: 'center', flexGrow: 1, minHeight: 240, padding: 24, textAlign: 'center' });
