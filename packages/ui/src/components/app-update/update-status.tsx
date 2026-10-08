import { Button, Link, ProgressBar } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { NOTES_LANG, view } from '../../model/app-update.ts';
import { useAppUpdate } from '../../state/app-update-store.ts';
import { useNow } from '../use-now.ts';
import { U } from './update-copy.ts';
import { useUpdateActions } from './use-update-actions.ts';
import { useWaitingCount } from './use-waiting-count.ts';

/*
 * 设置 › 关于的更新状态块（设计稿 settings-update.jsx `UpdateStatus`、settings-update.css `.upd`）：一行状态、进度、
 * 版本说明（最多 6 行）、按钮与「前往下载页」。宿主没有 `updates` 面（网页）时不出现。
 */

const block = style({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: 'full', marginTop: 12 });
const line = style({
  font: { default: 'ui-sm', tone: { strong: 'ui' } },
  fontWeight: { default: 'normal', tone: { strong: 'bold' } },
  color: { default: 'gray-700', tone: { positive: 'positive-900', negative: 'negative-900', muted: 'gray-600', strong: 'gray-900' } },
});
const progress = style({ width: 240 });
const notes = style({
  boxSizing: 'border-box',
  width: 'full',
  maxWidth: 400,
  margin: 0,
  paddingX: 12,
  paddingY: 8,
  borderRadius: 'lg',
  backgroundColor: 'gray-75',
  listStyleType: 'none',
  textAlign: 'start',
  font: 'ui-sm',
  color: 'gray-700',
  userSelect: 'text',
});
const buttons = style({ display: 'flex', alignItems: 'center', gap: 12 });
const sub = style({ font: 'ui-xs', color: 'gray-600' });

export function UpdateStatus() {
  const snapshot = useAppUpdate((s) => s.snapshot);
  const waiting = useWaitingCount();
  const act = useUpdateActions();
  // 「上次检查：…」按分钟走。
  const now = useNow(60_000, snapshot?.state.k === 'idle');
  if (!snapshot) return null;
  const v = view(snapshot.state, { lang: NOTES_LANG, lastCheck: snapshot.lastCheckAt, now: Math.floor(now / 1000), waiting });
  return (
    <div className={block} aria-live="polite">
      {v.line ? <div className={line({ tone: v.tone })}>{v.line}</div> : null}
      {v.progress != null ? <ProgressBar size="S" aria-label={U.progress} value={v.progress} styles={progress} /> : null}
      {v.notes && v.notes.lines.length ? (
        <ul className={notes} aria-label={U.notes}>
          {v.notes.lines.map((text, i) => (
            <li key={i}>{text}</li>
          ))}
        </ul>
      ) : null}
      {v.warn ? <div className={line({ tone: 'negative' })}>{v.warn}</div> : null}
      {v.actions.length || v.link ? (
        <div className={buttons}>
          {v.actions.map((b) => (
            <Button key={b.k} size="S" variant={b.variant} isDisabled={b.disabled} onPress={() => act(b.k)}>
              {b.label}
            </Button>
          ))}
          {v.link ? (
            <Link isStandalone isQuiet onPress={() => act(v.link!.k)}>
              {v.link.label}
            </Link>
          ) : null}
        </div>
      ) : null}
      {v.sub ? <div className={sub}>{v.sub}</div> : null}
    </div>
  );
}
