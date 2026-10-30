import { useState } from 'react';
import type { ForkNote } from '@baocut/protocol';
import { Link } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { untitled } from '../../copy.ts';
import { useDirectory } from '../../state/directory-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { ForkIcon } from '../fork-icon.tsx';
import { FORK_COPY as F } from './fork-copy.ts';

const wrap = style({ display: 'flex', flexDirection: 'column' });
const line = style({ display: 'flex', alignItems: 'center', gap: 12, font: 'ui-xs', color: 'gray-600' });
const rule = style({ flexGrow: 1, flexShrink: 1, flexBasis: 24, height: 1, backgroundColor: 'gray-200' });
const text = style({
  flexGrow: 0,
  flexShrink: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexWrap: 'wrap',
  gap: 4,
  textAlign: 'center',
});
const history = style({
  marginTop: 8,
  marginBottom: 0,
  paddingX: 12,
  paddingY: 8,
  maxHeight: 280,
  overflow: 'auto',
  overscrollBehavior: 'contain',
  borderRadius: 'lg',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  backgroundColor: 'gray-75',
  font: 'code-xs',
  color: 'gray-800',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'break-word',
  userSelect: 'text',
});

/**
 * 分叉出来的会话线程顶上那一条（产品设计 §3.2.2「分叉」，原型 agent-fork.jsx `AgentMarker`）：「分叉自「标题」· 截至第 N 轮」，
 * 标题点了回原会话（原会话删了就写明）；旁边「带进去的记录 · N 轮」点开看第一次交给智能体的原文。
 */
export function ForkMarker({ note }: { note: ForkNote }) {
  const [open, setOpen] = useState(false);
  const go = useShell((s) => s.go);
  const ready = useDirectory((s) => s.ready);
  const source = useDirectory((s) => s.conversations.find((c) => c.id === note.conversationId));
  const label = F.forkedFrom(note.title || untitled(), note.turn);
  return (
    <div className={wrap}>
      <div className={line} role="note">
        <span className={rule} aria-hidden />
        <span className={text}>
          <ForkIcon />
          {source ? (
            <Link variant="secondary" onPress={() => go({ tab: 'home', conversationId: source.id, projectId: source.projectId })}>
              {label}
            </Link>
          ) : (
            <span>{ready ? `${label} ${F.sourceDeleted}` : label}</span>
          )}
          <Link variant="secondary" aria-expanded={open} onPress={() => setOpen((v) => !v)}>
            {open ? F.hideHistory : F.history(note.turns, note.omitted)}
          </Link>
        </span>
        <span className={rule} aria-hidden />
      </div>
      {open ? <pre className={history}>{note.history}</pre> : null}
    </div>
  );
}
