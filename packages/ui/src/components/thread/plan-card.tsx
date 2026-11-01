import { memo, useState } from 'react';
import { ACCESS_MODES, type AccessMode, type Id, type TimelineItem } from '@baocut/protocol';
import {
  ActionButton,
  Button,
  Disclosure,
  DisclosurePanel,
  DisclosureTitle,
  Picker,
  PickerItem,
  Text,
  ToastQueue,
} from '@react-spectrum/s2';
import FileText from '@react-spectrum/s2/icons/FileText';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { planDecidedLabel } from '../../model/thread.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { MODE_ICON } from '../access-picker.tsx';
import { ACCESS_MODE_LABEL } from '../../copy.ts';
import { AgentMarkdown } from './agent-markdown.tsx';
import { PLAN_COPY } from './plan-copy.ts';

type Approval = Extract<TimelineItem, { kind: 'approval' }>;
type Plan = Extract<Approval['request'], { kind: 'plan' }>;

/** 批准方案时默认切到的访问模式（与 Harness 不指定时的默认一致）。 */
const DEFAULT_MODE: AccessMode = 'autoAcceptEdits';

/** 待批准的卡（原型 ui.css `.aplan`）：与提问卡同一种蓝底细边，方案正文限高滚动。 */
const card = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  paddingX: 16,
  paddingY: 12,
  marginStart: '[var(--bc-agent-indent, 36px)]',
  borderRadius: '[10px]',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'blue-300',
  backgroundColor: 'blue-100',
});
const head = style({ display: 'flex', alignItems: 'center', gap: 8, font: 'ui', fontWeight: 'bold', color: 'blue-1000' });
const body = style({
  maxHeight: 360,
  overflowY: 'auto',
  paddingX: 12,
  paddingY: 8,
  borderRadius: 'default',
  backgroundColor: 'base',
  userSelect: 'text',
});
const actions = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 });
const hint = style({ margin: 0, font: 'ui-sm', color: 'gray-700' });
/** 决定过的方案收成一行 quiet Disclosure，展开是方案全文。 */
const decided = style({ marginStart: '[var(--bc-agent-indent, 36px)]', alignSelf: 'stretch' });
const decidedTitle = style({ display: 'flex', alignItems: 'center', gap: 4, font: 'ui-sm', color: 'gray-600' });
/** 页脚下面那一行（与回复正文对齐）。 */
const row = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginStart: '[var(--bc-agent-indent, 36px)]', font: 'ui-sm', color: 'gray-700' });

/**
 * 方案审批（产品设计 §6.6「批准方案」，原型 agent-plan.jsx `AgentPlanMsg`）：Agent 在「先给方案」里写完方案，停下来等批准。
 * 「按方案实施」先把会话切到选定的访问模式（默认自动接受修改），Agent 接着按方案改；「继续改方案」按不批准结束，Agent 留在规划里。
 * 直接在输入框发消息也算回复（见 conversation-view）。决定之后卡片收成一行记录，展开是方案全文。
 */
export const PlanCard = memo(function PlanCard({ item, conversationId }: { item: Approval; conversationId: string }) {
  const runtime = useRuntime();
  const request = item.request as Plan;
  const [mode, setMode] = useState<AccessMode>(DEFAULT_MODE);
  const [pending, setPending] = useState<'accept' | 'decline' | null>(null);

  if (item.status !== 'pending') {
    return (
      <Disclosure size="S" isQuiet styles={decided}>
        <DisclosureTitle>
          <span className={decidedTitle}>
            <FileText />
            {planDecidedLabel(item)} · {PLAN_COPY.kind}
          </span>
        </DisclosureTitle>
        <DisclosurePanel>
          <AgentMarkdown text={request.plan} streaming={false} conversationId={conversationId} />
        </DisclosurePanel>
      </Disclosure>
    );
  }

  const submit = async (kind: 'accept' | 'decline') => {
    setPending(kind);
    try {
      if (kind === 'accept') await runtime.respondToApproval(conversationId, item.approvalId, 'accept', mode);
      else await runtime.respondToApproval(conversationId, item.approvalId, 'decline');
    } catch (error) {
      ToastQueue.negative(PLAN_COPY.failed((error as Error).message), { timeout: 5000 });
      setPending(null);
    }
  };

  return (
    <div className={card} role="group" aria-label={PLAN_COPY.title}>
      <div className={head}>
        <FileText />
        <span>{PLAN_COPY.title}</span>
      </div>
      <div className={body}>
        <AgentMarkdown text={request.plan} streaming={false} conversationId={conversationId} />
      </div>
      <div className={actions}>
        <ModePicker value={mode} onChange={setMode} disabled={pending !== null} />
        <Button size="S" variant="accent" isPending={pending === 'accept'} isDisabled={pending !== null} onPress={() => submit('accept')}>
          {PLAN_COPY.implement}
        </Button>
        <ActionButton size="S" isQuiet isDisabled={pending !== null} onPress={() => submit('decline')}>
          <Text>{PLAN_COPY.keepPlanning}</Text>
        </ActionButton>
      </div>
      <p className={hint}>{PLAN_COPY.hint}</p>
    </div>
  );
});

/**
 * 回合结束、会话还在「先给方案」时挂在页脚下面的一行（没有方案审批的 Agent 也能接着实施）：选访问模式，「按方案实施」
 * 把会话切过去并替用户发一句「按上面的方案实施」。
 */
export function PlanImplementRow({ conversationId }: { conversationId: Id }) {
  const runtime = useRuntime();
  const [mode, setMode] = useState<AccessMode>(DEFAULT_MODE);
  const [pending, setPending] = useState(false);
  const implement = async () => {
    setPending(true);
    try {
      await runtime.updateConversation(conversationId, { accessMode: mode });
      await runtime.send(conversationId, PLAN_COPY.followUp);
    } catch (error) {
      ToastQueue.negative(PLAN_COPY.failed((error as Error).message), { timeout: 5000 });
      setPending(false);
    }
  };
  return (
    <div className={row} role="group" aria-label={PLAN_COPY.implement}>
      <span>{PLAN_COPY.rowLead}</span>
      <ModePicker value={mode} onChange={setMode} disabled={pending} />
      <Button size="S" variant="accent" isPending={pending} onPress={() => void implement()}>
        {PLAN_COPY.implement}
      </Button>
    </div>
  );
}

function ModePicker({ value, onChange, disabled }: { value: AccessMode; onChange(mode: AccessMode): void; disabled: boolean }) {
  return (
    <Picker
      size="S"
      aria-label={PLAN_COPY.modeLabel}
      selectedKey={value}
      isDisabled={disabled}
      onSelectionChange={(key) => key && onChange(key as AccessMode)}>
      {ACCESS_MODES.map((mode) => {
        const Icon = MODE_ICON[mode];
        return (
          <PickerItem key={mode} id={mode} textValue={ACCESS_MODE_LABEL[mode]}>
            <Icon />
            <Text slot="label">{ACCESS_MODE_LABEL[mode]}</Text>
          </PickerItem>
        );
      })}
    </Picker>
  );
}
