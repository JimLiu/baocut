import { useEffect, useMemo, useState } from 'react';
import type { InboxRow } from '@baocut/protocol';
import { ActionButton, Button, ProgressCircle, Text } from '@react-spectrum/s2';
import OpenIn from '@react-spectrum/s2/icons/OpenIn';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { groupInbox } from '../../model/bot.ts';
import { agoLabel } from '../../model/format.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useChannels } from '../../state/channels-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { useWorkItem } from '../../state/work-items-store.ts';
import { useNow } from '../use-now.ts';
import { answerWorkItemQuestion, errorText, respondApproval } from './bot-actions.ts';
import { BOT_COPY as C } from './bot-copy.ts';
import { StatusLabel } from './status-badge.tsx';
import { costLine } from './task-detail.tsx';

const page = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, minWidth: 0, overflowY: 'auto' });
const inner = style({ width: 'full', maxWidth: '[760px]', marginX: 'auto', paddingX: 24, paddingY: 24, boxSizing: 'border-box' });
const heading = style({ margin: 0, font: 'title-lg', color: 'gray-900' });
const lead = style({ marginTop: 4, marginBottom: 16, font: 'body-sm', color: 'gray-700' });
const group = style({ marginTop: 20 });
const groupTitle = style({ margin: 0, marginBottom: 8, font: 'ui', fontWeight: 'bold', color: 'gray-800' });
const list = style({ display: 'flex', flexDirection: 'column', gap: 8, margin: 0, padding: 0, listStyleType: 'none' });
const card = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 12,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderRadius: 'lg',
  backgroundColor: 'gray-25',
});
const cardHead = style({ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' });
const cardTitle = style({ font: 'ui', fontWeight: 'medium', color: 'gray-900', flexGrow: 1, minWidth: 0, overflowWrap: 'anywhere' });
const since = style({ font: 'ui-xs', color: 'gray-600' });
const text = style({ margin: 0, font: 'body-sm', color: 'gray-900', overflowWrap: 'anywhere' });
const buttons = style({ display: 'flex', gap: 8, flexWrap: 'wrap' });
const empty = style({ marginTop: 48, textAlign: 'center', font: 'body', color: 'gray-600' });
const centered = style({ display: 'flex', justifyContent: 'center', padding: 48 });

/** 收件箱的一行：等你回答的问题直接在这里点选项；待批准的授权单独允许或拒绝，不能批量。 */
function InboxCard({ row, now }: { row: InboxRow; now: number }) {
  const runtime = useRuntime();
  const go = useShell((s) => s.go);
  const item = useWorkItem(row.workItemId);
  const [pending, setPending] = useState<string | null>(null);
  const open = () => go({ tab: 'bot', channelId: row.channelId, workItemId: row.workItemId, view: 'channel' });
  const question = row.question;
  const canAnswer = !!question && !!item?.threadId && question.options.length > 0;
  const act = async (key: string, fn: () => Promise<unknown>) => {
    setPending(key);
    await fn();
    setPending(null);
  };
  return (
    <li className={card} aria-label={row.title}>
      <div className={cardHead}>
        <span className={cardTitle}>{row.title}</span>
        <StatusLabel statusKey={row.state} />
        <span className={since}>{C.inbox.since(agoLabel(row.since, now))}</span>
      </div>
      {question ? <p className={text}>{question.text}</p> : null}
      {row.approval ? (
        <p className={text}>{[row.approval.summary, costLine(row.approval.cost)].filter(Boolean).join(' · ')}</p>
      ) : null}
      <div className={buttons}>
        {canAnswer
          ? question.options.map((option, index) => (
              <Button
                key={option.label}
                size="S"
                variant={!question.risky && question.pick === index ? 'accent' : 'secondary'}
                isPending={pending === `q${index}`}
                isDisabled={pending !== null}
                onPress={() => void act(`q${index}`, () => answerWorkItemQuestion(runtime, item!, question, index))}>
                {option.label}
              </Button>
            ))
          : null}
        {row.approval && !question ? (
          <>
            <Button
              size="S"
              variant="accent"
              isPending={pending === 'allow'}
              isDisabled={pending !== null}
              onPress={() => void act('allow', () => respondApproval(runtime, row.approval!.approvalId, true))}>
              {C.detail.allow}
            </Button>
            <Button
              size="S"
              variant="secondary"
              isPending={pending === 'deny'}
              isDisabled={pending !== null}
              onPress={() => void act('deny', () => respondApproval(runtime, row.approval!.approvalId, false))}>
              {C.detail.deny}
            </Button>
          </>
        ) : null}
        <ActionButton isQuiet size="S" onPress={open}>
          <OpenIn />
          <Text>{question && !canAnswer ? C.inbox.reply : C.inbox.openTask}</Text>
        </ActionButton>
      </div>
    </li>
  );
}

/**
 * 「等你处理」（BOT-CH-11、需求 §11.7）：所有频道里等你的任务，按频道分组；每件单独回答或批准，没有批量通过。
 * 频道摘要一变（等你的数变了）就重取。
 */
export function InboxView() {
  const runtime = useRuntime();
  const channels = useChannels((s) => s.channels);
  const now = useNow(60_000);
  const [rows, setRows] = useState<InboxRow[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    runtime.client
      .request('bot.inbox', {})
      .then((result) => {
        if (!live) return;
        setRows(result.rows);
        setFailure(null);
      })
      .catch((error: unknown) => {
        if (live) setFailure(errorText(error));
      });
    return () => {
      live = false;
    };
  }, [runtime, channels]);

  const groups = useMemo(() => groupInbox(rows ?? []), [rows]);
  return (
    <section className={`${page} bc-scroll`} aria-label={C.inbox.title}>
      <div className={inner}>
        <h1 className={heading}>{C.inbox.title}</h1>
        <p className={lead}>{C.inbox.lead}</p>
        {failure && !rows ? (
          <p className={empty}>{C.common.failed(failure)}</p>
        ) : !rows ? (
          <div className={centered}>
            <ProgressCircle isIndeterminate aria-label={C.common.loading} />
          </div>
        ) : !groups.length ? (
          <p className={empty}>{C.inbox.empty}</p>
        ) : (
          groups.map((g) => (
            <section key={g.channelId} className={group} aria-label={g.channelName}>
              <h2 className={groupTitle}>{g.channelName}</h2>
              <ul className={list}>
                {g.rows.map((row) => (
                  <InboxCard key={`${row.workItemId}:${row.approval?.approvalId ?? ''}`} row={row} now={now} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </section>
  );
}
