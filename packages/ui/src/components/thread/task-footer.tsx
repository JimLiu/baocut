import { memo } from 'react';
import { localizeText, type Id } from '@baocut/protocol';
import { PixelLoader } from '@react-spectrum/ai/loader';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { clockLabel, footerLabel, type Turn } from '../../model/agent-turn.ts';
import { useNow } from '../use-now.ts';
import { loaderSequence } from './agent-loader-icons.ts';
import { CopyButton } from './copy-button.tsx';
import { T } from './thread-copy.ts';
import { TaskRecovery } from './task-recovery.tsx';
import './agent-thread.css';

const stack = style({ display: 'flex', flexDirection: 'column', gap: 8 });

/**
 * 回合页脚（产品设计 §3.2.2）：一轮从一条用户消息到下一条之前，页脚挂在这一轮最后一行下面。
 * 状态来自任务事件，不来自模型说了什么（架构设计 §11.3）。进行中「正在工作 · 0:42」每秒跳，只有计时的小组件自己重渲；
 * 等审批时「等你允许 · 0:42」；完成后「已工作 1:03」，hover 换成结束时刻。右侧复制这一轮的回复正文（Markdown 源码，不含工具与思考）。
 * `recover`：这是会话里最后一个任务、失败了、会话空闲，下面挂恢复区。
 */
export const TaskFooter = memo(function TaskFooter({
  turn,
  live,
  conversationId,
  recover = false,
}: {
  turn: Turn;
  live: boolean;
  conversationId: Id;
  recover?: boolean;
}) {
  const task = turn.task;
  const failed = task?.status === 'failed';
  const line = (
    <div className={`bc-turn${failed ? ' bc-turn--failed' : ''}`}>
      {live ? <LiveClock turn={turn} /> : <DoneClock turn={turn} />}
      <span className="bc-turn__grow" />
      {!live && turn.text ? <CopyButton text={turn.text} label={T.copyReply} showLabel /> : null}
    </div>
  );
  if (!recover || !task) return line;
  return (
    <div className={stack}>
      {line}
      <TaskRecovery item={task} conversationId={conversationId} />
    </div>
  );
});

/**
 * 进行中的计时：每秒重渲的只有它。前面一个通用序列的像素加载图形（与正文左边对齐），等你允许时不放；
 * 图形是扫光文字的兄弟节点（扫光把文字色设成透明，放进去 currentColor 就没了）。
 */
function LiveClock({ turn }: { turn: Turn }) {
  const now = useNow(1000);
  const task = turn.task;
  const label = footerLabel({
    status: task?.status ?? null,
    startedAt: task ? Date.parse(task.startedAt) : null,
    now,
    waiting: turn.waiting,
  });
  return (
    <>
      {turn.waiting ? null : <PixelLoader icon={loaderSequence('thinking')} size={14} className="bc-turn__loader" />}
      <span className={`bc-turn__live${turn.waiting ? '' : ' bc-shimmer'}`}>{label}</span>
    </>
  );
}

/** 结束后的时长；hover 换成结束时刻。隐藏的 sizer 占住两种文案里较长的宽度，换字时不抖。失败只写原因。 */
function DoneClock({ turn }: { turn: Turn }) {
  const task = turn.task;
  if (!task) return null;
  const endedAt = task.endedAt ? Date.parse(task.endedAt) : null;
  const label = footerLabel({ status: task.status, startedAt: Date.parse(task.startedAt), endedAt, now: Date.now(), error: localizeText(task.error, task.errorRef) });
  if (!label) return null;
  if (task.status === 'failed' || endedAt === null) return <span>{label}</span>;
  const at = clockLabel(endedAt);
  return (
    <span className="bc-turn__time">
      <span className="bc-turn__sizer" aria-hidden>
        {label.length >= at.length ? label : at}
      </span>
      <span className="bc-turn__spent">{label}</span>
      <span className="bc-turn__at" aria-hidden>
        {at}
      </span>
    </span>
  );
}
