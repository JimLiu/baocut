import { useState } from 'react';
import type { ApprovalGrantChoice, ServiceApproval } from '@baocut/protocol';
import { Button, ToastQueue } from '@react-spectrum/s2';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { approvalGrants, approvalSecondsLeft, grantLine, liveApprovals, mcpToolTitle } from '../../model/services-mcp.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useConnection } from '../../state/connection-store.ts';
import { useServices } from '../../state/services-store.ts';
import { useTasks } from '../../state/tasks-store.ts';
import { useNow } from '../use-now.ts';
import { APPROVAL_CARD_COPY } from './services-copy.ts';
import { toastFailure } from './use-service-actions.ts';

/*
 * 服务审批卡（原型 designs/baocut/app/page-services.jsx `.svc__ask`；架构设计 §3.12、§4.8）：
 * 「修改前询问」下外部客户端的写入、任务与生成，在这里逐条确认；50 秒没人处理按拒绝。
 * 要外发数据又没有授权覆盖时（§12.5，`tasks` 主题统一列表里的 `grants`），允许分「只允许这一次」与「允许并记住」。
 * 原型的「详情」里有完整参数；Runtime 的审批只带一行摘要（不含参数正文），所以没有「详情」与「复制完整参数」。
 */

const card = style({
  boxSizing: 'border-box',
  maxWidth: '[640px]',
  padding: 16,
  marginTop: 12,
  borderRadius: 'lg',
  backgroundColor: 'orange-100',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'orange-400',
});
const head = style({ display: 'flex', alignItems: 'start', gap: 12 });
const icon = iconStyle({ size: 'M', color: 'notice' });
const txt = style({ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0 });
const title = style({ font: 'title-sm', color: 'gray-900', overflowWrap: 'anywhere' });
const line = style({ font: 'ui-sm', color: 'gray-700', overflowWrap: 'anywhere' });
const callLine = style({ font: 'code-sm', color: 'gray-800', overflowWrap: 'anywhere' });
const small = style({ font: 'ui-xs', color: 'gray-600' });
const buttons = style({ display: 'flex', flexWrap: 'wrap', justifyContent: 'end', gap: 8, marginTop: 12 });

/** 一项服务所有还没过时限的审批，旧的在前。 */
export function ServiceApprovals({ serviceId }: { serviceId: ServiceApproval['serviceId'] }) {
  const approvals = useServices((s) => s.approvals);
  const now = useNow(1000, approvals.length > 0);
  const live = liveApprovals(approvals, serviceId, now);
  return (
    <>
      {live.map((a) => (
        <ApprovalCard key={a.approvalId} approval={a} secondsLeft={approvalSecondsLeft(a, now)} />
      ))}
    </>
  );
}

function ApprovalCard({ approval, secondsLeft }: { approval: ServiceApproval; secondsLeft: number }) {
  const runtime = useRuntime();
  const connected = useConnection((s) => s.state.status === 'connected');
  const pending = useTasks((s) => s.approvals);
  const grants = approvalGrants(pending, approval.approvalId);
  const [busy, setBusy] = useState(false);
  const toolTitle = approval.serviceId === 'mcp' ? mcpToolTitle(approval.tool) : approval.tool;

  const respond = (decision: 'allow' | 'deny', grant?: ApprovalGrantChoice) => {
    setBusy(true);
    runtime
      .respondToPendingApproval(approval.approvalId, decision, grant)
      .then((status) => {
        if (status === 'already-resolved') ToastQueue.neutral(APPROVAL_CARD_COPY.already, { timeout: 4000 });
        else if (status === 'allowed') ToastQueue.positive(APPROVAL_CARD_COPY.allowed, { timeout: 3000 });
        else ToastQueue.neutral(APPROVAL_CARD_COPY.denied, { timeout: 3000 });
      })
      .catch(toastFailure)
      .finally(() => setBusy(false));
  };

  return (
    <section className={card} role="status" aria-label={APPROVAL_CARD_COPY.title(approval.clientName, toolTitle)}>
      <div className={head}>
        <AlertTriangle styles={icon} />
        <span className={txt}>
          <span className={title}>{APPROVAL_CARD_COPY.title(approval.clientName, toolTitle)}</span>
          <span className={line}>
            {approval.video ? APPROVAL_CARD_COPY.video(approval.video.name) : APPROVAL_CARD_COPY.noVideo}
            {approval.summary ? ` · ${approval.summary}` : ''}
          </span>
          <code className={callLine}>{approval.tool}</code>
          {grants.map((g, i) => (
            <span key={i} className={line}>
              {grantLine(g)}
            </span>
          ))}
          {grants.length ? <span className={small}>{APPROVAL_CARD_COPY.grantPersistNote}</span> : null}
          <span className={small}>{APPROVAL_CARD_COPY.left(secondsLeft)}</span>
        </span>
      </div>
      <div className={buttons}>
        <Button variant="secondary" size="S" isDisabled={!connected || busy} onPress={() => respond('deny')}>
          {APPROVAL_CARD_COPY.deny}
        </Button>
        {grants.length ? (
          <>
            <Button variant="secondary" size="S" isDisabled={!connected || busy} onPress={() => respond('allow', { persist: true })}>
              {APPROVAL_CARD_COPY.allowPersist}
            </Button>
            <Button variant="accent" size="S" isDisabled={!connected || busy} onPress={() => respond('allow', { persist: false })}>
              {APPROVAL_CARD_COPY.allowOnce}
            </Button>
          </>
        ) : (
          <Button variant="accent" size="S" isDisabled={!connected || busy} onPress={() => respond('allow')}>
            {APPROVAL_CARD_COPY.allow}
          </Button>
        )}
      </div>
    </section>
  );
}
