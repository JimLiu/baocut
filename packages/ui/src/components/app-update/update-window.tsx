import { useId } from 'react';
import { ActionButton, Button, CustomDialog, ProgressBar, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import Close from '@react-spectrum/s2/icons/Close';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import type { DialogView } from '../../model/app-update.ts';
import { U } from './update-copy.ts';
import { useUpdateActions } from './use-update-actions.ts';

/*
 * 更新窗（设计稿 settings-update.jsx `UpdateWindow`、settings-update.css `.upddlg`）：模态，宽 480。头是标题、
 * 「BaoCut 2.3.0 · Build 57」与关闭；正文是当前版本一句（已下载时接着说退出时也会装）、「更新内容」与全部说明（可滚）；
 * 底栏随态。×、Esc、点背景、「稍后」都只关窗；「重启并更新」与关于页、toast 走同一个动作。设计稿头部的 App 图标没画：
 * 界面包里还没有图标资源。
 */

const frame = style({ display: 'flex', flexDirection: 'column', maxHeight: '[min(560px, calc(100vh - 96px))]' });
const head = style({ display: 'flex', alignItems: 'start', gap: 12 });
const headText = style({ flexGrow: 1, minWidth: 0 });
const title = style({ margin: 0, font: 'title', color: 'gray-900' });
const sub = style({ marginTop: 2, font: 'ui-sm', color: 'gray-600' });
const body = style({ flexGrow: 1, flexShrink: 1, minHeight: 0, overflow: 'auto', marginTop: 16 });
const current = style({ marginTop: 0, marginBottom: 16, font: 'body-sm', color: 'gray-800' });
const notesTitle = style({ font: 'ui', fontWeight: 'bold', color: 'gray-900' });
const notes = style({ marginTop: 8, marginBottom: 0, paddingStart: 20, font: 'body-sm', color: 'gray-700', userSelect: 'text' });
const note = style({ marginTop: { default: 0, ':nth-child(n+2)': 4 } });
const foot = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginTop: 16,
  paddingTop: 16,
  borderTopWidth: 1,
  borderXWidth: 0,
  borderBottomWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const left = style({ display: 'flex', alignItems: 'center', gap: 8, flexGrow: 1, minWidth: 0 });
const progress = style({ width: 120, flexShrink: 0 });
/** 按钮不让位：左边的进度、出错与等待说明换行，按钮的字不折。 */
const actions = style({ display: 'flex', gap: 8, flexShrink: 0 });
const leftText = style({ font: 'ui-sm', color: { default: 'gray-700', isError: 'negative-900' }, fontVariantNumeric: 'tabular-nums' });

export function UpdateWindow({ view, onClose }: { view: DialogView; onClose: () => void }) {
  const act = useUpdateActions();
  const titleId = useId();
  const f = view.footer;
  return (
    <CustomDialog size="M" isDismissible aria-labelledby={titleId}>
      <div className={frame}>
        <div className={head}>
          <div className={headText}>
            <h2 id={titleId} className={title}>
              {view.title}
            </h2>
            <div className={sub}>{view.sub}</div>
          </div>
          <TooltipTrigger>
            <ActionButton isQuiet size="S" aria-label={U.close} onPress={onClose}>
              <Close />
            </ActionButton>
            <Tooltip>{U.close}</Tooltip>
          </TooltipTrigger>
        </div>
        <div className={body}>
          {view.current || view.note ? <p className={current}>{[view.current, view.note].filter(Boolean).join('')}</p> : null}
          <div className={notesTitle}>{view.notesTitle}</div>
          <ul className={notes}>
            {view.notes.map((text, i) => (
              <li key={i} className={note}>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <div className={foot}>
          <div className={left}>
            {f.left && 'progress' in f.left ? (
              <>
                <ProgressBar size="S" aria-label={U.progress} value={f.left.progress} styles={progress} />
                <span className={leftText({})}>{f.left.text}</span>
              </>
            ) : null}
            {f.left && 'error' in f.left ? <span className={leftText({ isError: true })}>{f.left.error}</span> : null}
            {f.left && 'note' in f.left ? <span className={leftText({})}>{f.left.note}</span> : null}
          </div>
          <div className={actions}>
            {f.buttons.map((b) => (
              <Button key={b.k} variant={b.variant} onPress={() => act(b.k)}>
                {b.label}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </CustomDialog>
  );
}
