import { useEffect } from 'react';
import { localizeText, type Id } from '@baocut/protocol';
import { Badge, Button, Content, Heading, InlineAlert, ProgressBar } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { harnessLabel } from '../../model/agent-choice.ts';
import { agentRunState, type AgentRunState } from '../../model/ai-tools-handoff.ts';
import { aiTool, toolDraftKey, type AgentToolId } from '../../model/ai-tools.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useConnection } from '../../state/connection-store.ts';
import { useDirectory } from '../../state/directory-store.ts';
import { useTimeline } from '../../state/timeline-store.ts';
import { AI_TOOLS_COPY as C } from './ai-tools-copy.ts';
import { showConversation } from './ai-tools-handoff.ts';
import { setAiToolAgentRun, type AiToolAgentRun } from './ai-tools-nav.ts';
import { PanelHead } from './panel-head.tsx';

const body = style({ flexGrow: 1, minHeight: 0, overflowY: 'auto', paddingX: 12, paddingTop: 12, paddingBottom: 16 });
const stack = style({ display: 'flex', flexDirection: 'column', gap: 12 });
/** 同参数页顶上的说明卡（原型 .aicard）。 */
const card = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 12,
  borderRadius: 'lg',
  backgroundColor: 'gray-75',
  font: 'ui-sm',
  color: 'gray-800',
  lineHeight: '[1.5]',
});
const cardTitle = style({ font: 'ui', fontWeight: 'bold', color: 'gray-900' });
const titleRow = style({ display: 'flex', alignItems: 'center', gap: 8, font: 'ui', color: 'gray-900' });
const liveDot = style({
  flexShrink: 0,
  width: 8,
  height: 8,
  borderRadius: 'full',
  backgroundColor: { default: 'blue-800', isWaiting: 'orange-800' },
});
const headTitle = style({ flexGrow: 1, minWidth: 0, fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const activity = style({ font: 'ui-xs', color: 'gray-600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const actions = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 });
const alertActions = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 8 });
const note = style({ margin: 0, font: 'ui-xs', color: 'gray-600', lineHeight: '[1.5]' });
const field = style({ width: 'full' });
const chip = style({ flexShrink: 0, marginEnd: 4 });

const finished = (state: AgentRunState) => state.kind === 'done' || state.kind === 'failed' || state.kind === 'stopped';

/**
 * 找可剪的口与刷新过期译文交给 Agent 后留在工具页上的进度卡（原型 panel-aitools-cut.jsx `AgentRun`，产品设计 §5.10「交给智能体」）：
 * 交给了谁、在会话里走到哪（`agentRunState` 读那条会话的时间线），等放行时给一个直达会话的按钮；「打开会话」把会话带到眼前，
 * 「重新设置」回参数页（会话照样跑）。结果照常写进视频——剪辑建议进文稿与时间轴、重译的句子进字幕——这里只报进度，结束后「完成」回参数页。
 */
export function AiToolAgentRun({ videoId, tool, run, onBack }: { videoId: Id; tool: AgentToolId; run: AiToolAgentRun; onBack(): void }) {
  const runtime = useRuntime();
  const { conversationId } = run;
  // 进度要读会话的时间线：盯着它（引用计数，会话页也在盯时共用一份）。
  useEffect(() => runtime.watchConversation(conversationId), [runtime, conversationId]);
  const items = useTimeline((s) => s.byConversationId[conversationId]?.items);
  const conversation = useDirectory((s) => s.conversations.find((c) => c.id === conversationId) ?? null);
  const driver = useConnection((s) => s.drivers?.find((d) => d.id === conversation?.driverId) ?? null);
  const state = agentRunState({ taskId: run.taskId, handedAt: run.handedAt, items });
  const reset = () => setAiToolAgentRun(toolDraftKey(videoId, tool), null);
  const open = () => showConversation(conversationId);
  const done = finished(state);
  const heading =
    state.kind === 'starting'
      ? C.agentStarting
      : state.kind === 'waiting'
        ? C.agentWaiting
        : state.kind === 'done'
          ? C.agentDone
          : state.kind === 'stopped'
            ? C.agentStopped
            : state.kind === 'failed'
              ? C.agentFailed
              : C.agentWorking;

  return (
    <>
      <PanelHead title={aiTool(tool).name} back={{ label: C.back, onPress: onBack }}>
        {done ? null : (
          <Badge size="S" variant="informative" fillStyle="subtle" styles={chip}>
            {C.agentChip}
          </Badge>
        )}
      </PanelHead>
      <div className={`${body} bc-scroll`}>
        <div className={stack}>
          <div className={card} role="status" aria-live="polite">
            <span className={cardTitle}>{C.agentHanded(harnessLabel(driver, conversation?.model ?? null))}</span>
            <div className={titleRow}>
              {done ? null : <span className={liveDot({ isWaiting: state.kind === 'waiting' })} aria-hidden />}
              <span className={headTitle}>{heading}</span>
            </div>
            {done ? null : <ProgressBar size="S" aria-label={heading} isIndeterminate styles={field} />}
            {(state.kind === 'running' || state.kind === 'waiting') && state.step ? <span className={activity}>{state.step}</span> : null}
          </div>
          {state.kind === 'waiting' ? (
            <InlineAlert variant="notice">
              <Heading>{C.agentWaiting}</Heading>
              <Content>
                {C.agentWaitingBody}
                <div className={alertActions}>
                  <Button size="S" variant="accent" onPress={open}>
                    {C.agentApprove}
                  </Button>
                </div>
              </Content>
            </InlineAlert>
          ) : null}
          {state.kind === 'failed' ? (
            <InlineAlert variant="negative">
              <Heading>{C.agentFailed}</Heading>
              {state.error ? <Content>{localizeText(state.error, state.errorRef)}</Content> : null}
            </InlineAlert>
          ) : null}
          <div className={actions}>
            <Button size="S" variant="secondary" onPress={open}>
              {C.openSession}
            </Button>
            <Button size="S" variant={done ? 'accent' : 'secondary'} fillStyle={done ? 'fill' : 'outline'} onPress={reset}>
              {done ? C.done : C.resetSetup}
            </Button>
          </div>
          <p className={note}>{state.kind === 'done' ? C.agentDoneNote : tool === 'cleanup' ? C.agentNoteCleanup : C.agentNoteStale}</p>
        </div>
      </div>
    </>
  );
}
