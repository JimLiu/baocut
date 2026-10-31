import { useState } from 'react';
import { BOT_LIMITS, type Id, type TimelineItem, type WorkItem, type WorkItemOwner } from '@baocut/protocol';
import { ActionButton, Button, ButtonGroup, SegmentedControl, SegmentedControlItem, Text, TextArea, TextField } from '@react-spectrum/s2';
import Edit from '@react-spectrum/s2/icons/Edit';
import OpenIn from '@react-spectrum/s2/icons/OpenIn';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { ACCESS_MODE_LABEL } from '../../../copy.ts';
import { describeCadence } from '../../../model/agent-schedule.ts';
import { useShell } from '../../../state/shell-store.ts';
import { useWorkItem } from '../../../state/work-items-store.ts';
import { transitionWorkItem, useBotCall } from '../bot-actions.ts';
import { BOT_COPY as C } from '../bot-copy.ts';
import { EvidenceLinks } from './evidence-links.tsx';
import { card } from './work-item-ref-card.tsx';

type Proposal = Extract<TimelineItem, { kind: 'proposal' }>;

const box = style({ display: 'flex', flexDirection: 'column', gap: 8, flexGrow: 1, minWidth: 0 });
const heading = style({ font: 'ui', fontWeight: 'bold', color: 'gray-900' });
const fact = style({ margin: 0, font: 'ui-sm', color: 'gray-800', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' });
const factMuted = style({ margin: 0, font: 'ui-sm', color: 'gray-600' });
const settled = style({ display: 'flex', alignItems: 'center', gap: 8, font: 'ui-sm', color: 'gray-700' });
const suggestionRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
  paddingY: 4,
  borderTopWidth: { default: 1, ':first-child': 0 },
  borderXWidth: 0,
  borderBottomWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-100',
});
const suggestionText = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, flexBasis: 200, minWidth: 0 });
const suggestionTitle = style({ font: 'ui', color: 'gray-900' });
const suggestionReason = style({ font: 'ui-xs', color: 'gray-600' });
const controls = style({ display: 'flex', flexDirection: 'column', gap: 8, flexBasis: '[100%]', minWidth: 0 });
const controlRow = style({ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' });

/**
 * 智能体提出、等用户点的卡片（需求 §11.4）：建立频道、周期任务、建议任务。建频道与周期任务「建立」「忽略」走
 * `bot.proposals.respond`，处理过就缩成一行；建议任务每行「现在做」「加入」「忽略」走 `workItems.transition`。
 */
export function ProposalCard({ item, conversationId, channelId }: { item: Proposal; conversationId: Id; channelId: Id | null }) {
  const { proposal } = item;
  if (proposal.type === 'suggestions') {
    return (
      <div className={card} data-find-item={item.id}>
        <div className={box}>
          <span className={heading}>{C.proposal.suggestionsTitle}</span>
          <div role="list">
            {proposal.workItemIds.map((id) => (
              <SuggestionRow key={id} workItemId={id} channelId={channelId} />
            ))}
          </div>
        </div>
      </div>
    );
  }
  return <DecisionCard item={item} conversationId={conversationId} />;
}

function DecisionCard({ item, conversationId }: { item: Proposal; conversationId: Id }) {
  const call = useBotCall();
  const go = useShell((s) => s.go);
  const [pending, setPending] = useState<'accept' | 'decline' | null>(null);
  // 「修改」（需求 §11.4 建立频道卡）：改名字与用途后再建立，改动随 `edits` 一起交给 Runtime。
  const [edits, setEdits] = useState<{ name: string; purpose: string } | null>(null);
  const { proposal } = item;
  if (proposal.type === 'suggestions') return null;
  const heading_ = proposal.type === 'channel' ? C.proposal.channelTitle : C.proposal.scheduleTitle;
  const respond = async (accept: boolean) => {
    setPending(accept ? 'accept' : 'decline');
    const changed = accept && edits && proposal.type === 'channel' ? channelEdits(proposal, edits) : null;
    await call('bot.proposals.respond', { conversationId, itemId: item.id, accept, ...(changed ? { edits: changed } : {}) });
    setPending(null);
  };
  if (item.status !== 'pending') {
    const word = item.status === 'accepted' ? C.proposal.created : item.status === 'declined' ? C.proposal.dismissed : C.proposal.stale;
    return (
      <div className={settled} data-find-item={item.id}>
        <span>{`${heading_} · ${proposal.name} · ${word}`}</span>
        {item.status === 'accepted' && proposal.type === 'channel' && item.resultId ? (
          <ActionButton isQuiet size="S" onPress={() => go({ tab: 'bot', channelId: item.resultId, workItemId: null, view: 'channel' })}>
            <OpenIn />
            <Text>{C.proposal.openChannel}</Text>
          </ActionButton>
        ) : null}
      </div>
    );
  }
  return (
    <div className={card} data-find-item={item.id}>
      <div className={box}>
        <span className={heading}>{heading_}</span>
        {edits && proposal.type === 'channel' ? (
          <>
            <TextField
              label={C.dialog.name}
              value={edits.name}
              onChange={(name) => setEdits({ ...edits, name })}
              maxLength={BOT_LIMITS.channelName}
              isRequired
              autoFocus
            />
            <TextArea label={C.dialog.purpose} value={edits.purpose} onChange={(purpose) => setEdits({ ...edits, purpose })} maxLength={BOT_LIMITS.channelPurpose} />
          </>
        ) : (
          <p className={fact}>{proposal.name}</p>
        )}
        {proposal.type === 'channel' ? (
          proposal.purpose && !edits ? <p className={factMuted}>{proposal.purpose}</p> : null
        ) : (
          <>
            <p className={factMuted}>{describeCadence(proposal.cadence)}</p>
            <p className={factMuted}>{C.proposal.each(proposal.template.title)}</p>
            {proposal.accessMode ? <p className={factMuted}>{C.proposal.access(ACCESS_MODE_LABEL[proposal.accessMode])}</p> : null}
          </>
        )}
        <ButtonGroup>
          <Button
            variant="accent"
            size="S"
            isPending={pending === 'accept'}
            isDisabled={!!pending || (!!edits && !edits.name.trim())}
            onPress={() => void respond(true)}>
            {C.proposal.create}
          </Button>
          {proposal.type === 'channel' ? (
            edits ? (
              <Button variant="secondary" size="S" isDisabled={!!pending} onPress={() => setEdits(null)}>
                {C.common.cancel}
              </Button>
            ) : (
              <Button variant="secondary" size="S" isDisabled={!!pending} onPress={() => setEdits({ name: proposal.name, purpose: proposal.purpose ?? '' })}>
                {C.proposal.modify}
              </Button>
            )
          ) : null}
          <Button variant="secondary" size="S" isPending={pending === 'decline'} isDisabled={!!pending} onPress={() => void respond(false)}>
            {C.proposal.dismiss}
          </Button>
        </ButtonGroup>
      </div>
    </div>
  );
}

/** 只交改过的字段；都没改就不带 `edits`。 */
function channelEdits(proposal: { name: string; purpose?: string | null }, edits: { name: string; purpose: string }): { name?: string; purpose?: string } | null {
  const out: { name?: string; purpose?: string } = {};
  const name = edits.name.trim();
  if (name && name !== proposal.name) out.name = name;
  if (edits.purpose.trim() !== (proposal.purpose ?? '').trim()) out.purpose = edits.purpose.trim();
  return Object.keys(out).length ? out : null;
}

/** 建议卡的一行：还是建议时给三个按钮，采纳或忽略后写结果（需求 §11.4「采纳后该行变成…『已加入接下来』」）。 */
function SuggestionRow({ workItemId, channelId }: { workItemId: Id; channelId: Id | null }) {
  const item = useWorkItem(workItemId);
  const call = useBotCall();
  const go = useShell((s) => s.go);
  const [pending, setPending] = useState(false);
  if (!item) {
    return (
      <div className={suggestionRow} role="listitem">
        <span className={factMuted}>{C.proposal.suggestionMissing}</span>
      </div>
    );
  }
  const run = async (fn: () => Promise<unknown>) => {
    setPending(true);
    await fn();
    setPending(false);
  };
  return (
    <div className={suggestionRow} role="listitem">
      <div className={suggestionText}>
        <span className={suggestionTitle}>{item.title}</span>
        {item.suggestion?.reason ? <span className={suggestionReason}>{item.suggestion.reason}</span> : null}
      </div>
      {item.status === 'suggested' ? (
        <SuggestionButtons item={item} pending={pending} run={run} call={call} />
      ) : (
        <span className={settled}>
          <span>{settledWord(item)}</span>
          {item.status === 'active' ? (
            <ActionButton isQuiet size="S" onPress={() => go({ tab: 'bot', channelId: item.channelId ?? channelId, workItemId: item.id, view: 'channel' })}>
              <OpenIn />
              <Text>{C.card.open}</Text>
            </ActionButton>
          ) : null}
        </span>
      )}
    </div>
  );
}

/**
 * 建议的处理（BOT-MK-04）：依据链接、归属（默认取建议里的，通常交给智能体，可切成我来做）、采纳前可改标题，
 * 再「现在做」「加入」「忽略」。归属是我来做时没有「现在做」（Runtime 不给用户自己的任务开线程）。
 */
export function SuggestionButtons({
  item,
  pending,
  run,
  call,
}: {
  item: WorkItem;
  pending: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  call: ReturnType<typeof useBotCall>;
}) {
  const [owner, setOwner] = useState<WorkItemOwner>(item.suggestion?.owner ?? item.owner);
  const [title, setTitle] = useState<string | null>(null);
  const edited = title?.trim() && title.trim() !== item.title ? title.trim() : undefined;
  const accept = (start: boolean) =>
    void run(() => transitionWorkItem(call, item.id, { type: 'accept', start, owner, ...(edited ? { title: edited } : {}) }));
  return (
    <div className={controls}>
      {title !== null ? (
        <TextField label={C.panel.taskTitle} value={title} onChange={setTitle} maxLength={BOT_LIMITS.title} isRequired autoFocus />
      ) : null}
      <EvidenceLinks refs={item.suggestion?.evidence ?? []} />
      <div className={controlRow}>
        <SegmentedControl aria-label={C.panel.owner} selectedKey={owner} onSelectionChange={(key) => setOwner(key as WorkItemOwner)}>
          <SegmentedControlItem id="agent">{C.panel.ownerAgent}</SegmentedControlItem>
          <SegmentedControlItem id="user">{C.panel.ownerUser}</SegmentedControlItem>
        </SegmentedControl>
        {title === null ? (
          <ActionButton isQuiet size="S" aria-label={C.proposal.editTitle} isDisabled={pending} onPress={() => setTitle(item.title)}>
            <Edit />
          </ActionButton>
        ) : null}
      </div>
      <ButtonGroup>
        {owner === 'agent' ? (
          <Button variant="secondary" size="S" isDisabled={pending || title?.trim() === ''} onPress={() => accept(true)}>
            {C.proposal.doNow}
          </Button>
        ) : null}
        <Button variant="secondary" size="S" isDisabled={pending || title?.trim() === ''} onPress={() => accept(false)}>
          {C.proposal.add}
        </Button>
        <Button variant="secondary" fillStyle="outline" size="S" isDisabled={pending} onPress={() => void run(() => transitionWorkItem(call, item.id, { type: 'dismiss' }))}>
          {C.proposal.dismiss}
        </Button>
      </ButtonGroup>
    </div>
  );
}

function settledWord(item: WorkItem): string {
  if (item.status === 'upNext' || item.status === 'scheduled') return C.proposal.added;
  if (item.status === 'active') return C.proposal.started;
  if (item.status === 'resolved' && item.resolution?.kind !== 'done') return C.proposal.dismissed;
  return C.status.done;
}
