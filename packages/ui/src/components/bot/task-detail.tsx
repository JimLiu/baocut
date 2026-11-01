import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { localizeText, type Id, type RevertPlan, type WorkItem, type WorkItemStateName, type WorkItemTransition } from '@baocut/protocol';
import {
  ActionButton,
  ActionMenu,
  Button,
  ButtonGroup,
  Content,
  Dialog,
  DialogContainer,
  Heading,
  MenuItem,
  ProgressCircle,
  Radio,
  RadioGroup,
  Text,
  TextArea,
  ToastQueue,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import ChevronUp from '@react-spectrum/s2/icons/ChevronUp';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { FINISHED_STEPS_SHOWN, canRevertItem, opensAsTab, outputKey, type WorkItemStatusKey } from '../../model/bot.ts';
import type { ConversationOutput } from '../../model/conversation-outputs.ts';
import { agoLabel } from '../../model/format.ts';
import { formatMoneyOne } from '../../model/usage-format.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useTimelineItems } from '../../state/timeline-store.ts';
import { useTransitionTick, useWorkItem } from '../../state/work-items-store.ts';
import { ConversationView } from '../conversation-view.tsx';
import { useNow } from '../use-now.ts';
import { answerWorkItemQuestion, errorText, nextLine, transitionWorkItem, useBotCall } from './bot-actions.ts';
import { BOT_COPY as C } from './bot-copy.ts';
import { formatDay } from './bot-format.ts';
import { useTaskSpend } from './task-spend.ts';
import { StatusIcon } from './status-badge.tsx';
import { TaskEditDialog } from './task-edit-dialog.tsx';
import { BotOutputLink } from './bot-output-link.tsx';
import { TaskRefs, useRefResolver } from './task-refs.tsx';
import { BotTimeline } from './timeline/bot-timeline.tsx';
import { useBotMessageExtras } from './timeline/message-extras.tsx';
import { SuggestionChips } from './timeline/suggestion-chips.tsx';
import { statusLabel, workItemStatus } from './work-item-status.ts';

const frame = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, minWidth: 0 });
/** 用户自己的任务没有线程：任务信息自己一个滚动区。 */
const scroll = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, overflowY: 'auto' });
/** 头部一行贴在滚动区顶上（原型 page-bot.css `.bot-detail__bar`）。 */
const bar = style({ position: 'sticky', top: 0, zIndex: 1, flexShrink: 0, backgroundColor: 'layer-1' });
/** 任务信息与线程同一栏宽（Thread 的 column：760 居中、左右 24）。 */
const infoColumn = style({
  display: 'flex',
  flexDirection: 'column',
  width: 'full',
  maxWidth: '[760px]',
  marginX: 'auto',
  paddingX: 24,
  paddingTop: 4,
  paddingBottom: 12,
  boxSizing: 'border-box',
});
/** 有线程时任务信息下面一道 2px 的分隔，和线程分开（原型 `.bot-detail__info--divided`）。 */
const infoBox = style({
  display: { default: 'flex', isHidden: 'none' },
  flexDirection: 'column',
  gap: 16,
  paddingBottom: { default: 0, isDivided: 16 },
  borderStyle: 'solid',
  borderColor: 'gray-100',
  borderTopWidth: 0,
  borderXWidth: 0,
  borderBottomWidth: { default: 0, isDivided: 2 },
});
const more = style({ display: { default: 'flex', isHidden: 'none' }, flexDirection: 'column', gap: 16 });
const headRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  width: 'full',
  maxWidth: '[760px]',
  marginX: 'auto',
  paddingStart: 16,
  paddingEnd: 12,
  paddingTop: 12,
  paddingBottom: 8,
  boxSizing: 'border-box',
  minWidth: 0,
});
const heading = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, marginStart: 4 });
const title = style({
  margin: 0,
  font: 'ui',
  fontWeight: 'bold',
  color: { default: 'gray-900', isStruck: 'gray-600' },
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  textDecoration: { default: 'none', isStruck: 'line-through' },
});
const subline = style({ font: 'ui-sm', color: 'gray-700', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const facts = style({ display: 'flex', flexWrap: 'wrap', gap: 12, font: 'ui-sm', color: 'gray-700' });
const description = style({ margin: 0, font: 'body-sm', color: 'gray-800', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' });
const block = style({ display: 'flex', flexDirection: 'column', gap: 8 });
const blockTitle = style({ margin: 0, font: 'ui-sm', fontWeight: 'bold', color: 'gray-700' });
const waiting = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 12,
  borderRadius: 'lg',
  backgroundColor: 'notice-subtle',
});
const questionText = style({ margin: 0, font: 'body', color: 'gray-900', overflowWrap: 'anywhere' });
const options = style({ display: 'flex', flexWrap: 'wrap', gap: 8 });
const optionNote = style({ font: 'ui-xs', color: 'gray-700' });
const items = style({ display: 'flex', flexDirection: 'column', gap: 4, margin: 0, padding: 0, listStyleType: 'none', font: 'ui-sm', color: 'gray-800' });
const itemRow = style({ display: 'flex', gap: 8, alignItems: 'baseline', overflowWrap: 'anywhere' });
const muted = style({ font: 'ui-xs', color: 'gray-600', flexShrink: 0 });
const activeStep = style({ fontWeight: 'bold' });
const centered = style({ display: 'flex', alignItems: 'center', justifyContent: 'center', flexGrow: 1, padding: 24, font: 'body-sm', color: 'gray-600', textAlign: 'center' });
const changeList = style({ margin: 0, paddingStart: 16, font: 'ui-xs', color: 'gray-600' });
const dialogBody = style({ display: 'flex', flexDirection: 'column', gap: 12, font: 'body-sm', color: 'gray-800' });

type MenuAction =
  | 'edit'
  | 'stop'
  | 'redirect'
  | 'refresh'
  | 'markDone'
  | 'reopen'
  | 'dismiss'
  | 'start'
  | 'handToAgent'
  | 'takeOver'
  | 'revertAll'
  | 'deleteRecord';

/** 详情「⋯」里这条任务此刻能做的事（需求 §11.6）。 */
export function menuActions(item: WorkItem): MenuAction[] {
  const out: MenuAction[] = [];
  const agent = item.owner === 'agent';
  if (item.status === 'active' && agent && item.active?.state !== 'blocked') out.push('stop');
  if (item.status === 'active' && agent) out.push('redirect', 'refresh');
  if ((item.status === 'upNext' || item.status === 'scheduled') && agent) out.push('start');
  if (item.status !== 'resolved' && item.status !== 'suggested') out.push('markDone', 'dismiss');
  if (item.status === 'suggested') out.push('dismiss');
  if (item.status === 'resolved') out.push('reopen');
  if (item.status !== 'resolved') out.push(agent ? 'takeOver' : 'handToAgent');
  if (canRevertItem(item)) out.push('revertAll');
  // 删除记录（BOT-EX-20）任何状态都给；进行中的先停线程（Runtime 的 `deleteRecord` 先停再删，对话框里写明）。
  out.push('deleteRecord');
  return out;
}

const MENU_LABEL: Record<MenuAction, () => string> = {
  edit: () => C.detail.editMenu,
  stop: () => C.detail.stop,
  redirect: () => C.detail.redirect,
  refresh: () => C.detail.refresh,
  markDone: () => C.detail.markDone,
  reopen: () => C.detail.reopen,
  dismiss: () => C.detail.dismiss,
  start: () => C.detail.start,
  handToAgent: () => C.detail.handToAgent,
  takeOver: () => C.detail.takeOver,
  revertAll: () => C.detail.revertAll,
  deleteRecord: () => C.detail.deleteRecord,
};

/** 转换记录里的状态名：子状态与解决方式用状态表的字，`active`、`resolved` 两个总状态用「工作中」「已完成」。 */
function stateName(name: WorkItemStateName): string {
  if (name === 'active') return C.status.working;
  if (name === 'resolved') return C.status.done;
  return statusLabel(name as WorkItemStatusKey);
}

/** 截止日、活动日旁写明是谁定的（BOT-TK-06）：你定的 / 来自你的消息；旧数据没记就不写。 */
export function dateFact(label: string, day: string, by: WorkItem['dueOnBy']): string {
  const text = `${label}: ${formatDay(day)}`;
  if (!by) return text;
  return `${text} · ${by === 'user' ? C.detail.setByYou : C.detail.fromYourMessage}`;
}

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className={block} aria-label={label}>
      <h3 className={blockTitle}>{label}</h3>
      {children}
    </section>
  );
}

/** 任务转换记录：转换事件来时重取（`workItems.get`），也顺便拿到不在已订阅频道里的任务本身。 */
export function useWorkItemRecord(id: Id) {
  const runtime = useRuntime();
  const tick = useTransitionTick(id);
  const [record, setRecord] = useState<{ item: WorkItem; transitions: WorkItemTransition[] } | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let live = true;
    runtime.client
      .request('workItems.get', { id })
      .then((result) => {
        if (live) setRecord({ item: result.item, transitions: result.transitions });
      })
      .catch(() => {
        if (live) setMissing(true);
      });
    return () => {
      live = false;
    };
  }, [runtime, id, tick]);
  return { record, missing };
}

/** 任务信息收起或展开，按任务记（离开再回来照旧）；没记过是展开的。 */
const infoOpen = new Map<Id, boolean>();

/**
 * 任务详情（BOT-TK-06…10、BOT-CH-11、BOT-EX-19/20、需求 §11.6 的修订稿）：右栏的一个任务页签，一栏从上滚到下。
 * 顶上一行贴着：状态、标题与「状态 · 下一步 · N 条进展」、收起或展开任务信息、「⋯」（编辑也在里面）；返回、占满与关闭在页签条上。
 * 下面是任务信息——等你的问题（带选项按钮，收起时也在）、事实、步骤、产物与资源、进展、转换记录——然后是线程，照普通会话画，
 * 输入框发的话进线程；任务信息跟着线程一起滚（ConversationView 的 `header`）。用户自己的任务没有线程。
 * 「产物」的每一行与线程里这些产物的卡按下都交给 `onOpenOutput(outputKey)`：在右栏开那个产物的页签（bot-output-view.tsx）。
 * 删掉记录后 `onClose` 关掉这个页签。
 */
export function TaskDetail({
  workItemId,
  channelId,
  onClose,
  onOpenOutput,
}: {
  workItemId: Id;
  channelId: Id | null;
  onClose: () => void;
  onOpenOutput: (output: string) => void;
}) {
  const live = useWorkItem(workItemId);
  const { record, missing } = useWorkItemRecord(workItemId);
  const item = live ?? record?.item;
  const runtime = useRuntime();
  const call = useBotCall();
  const now = useNow(60_000);
  const [dialog, setDialog] = useState<'redirect' | 'revert' | 'delete' | 'edit' | null>(null);
  const [allFinished, setAllFinished] = useState(false);
  const [answering, setAnswering] = useState<number | null>(null);
  // 线程里也能改自己的消息、给智能体的消息点 👍 👎（BOT-EX-06、BOT-EX-10）；线程里这个任务的产物卡在右栏开产物页签。
  const messageExtras = useBotMessageExtras();
  const { resolve } = useRefResolver(item);
  const outputs = item?.outputs;
  const threadExtras = useMemo(() => {
    const openOutput = (card: ConversationOutput) => {
      // 幻灯片、设计稿与协作文档在右栏看不了，照常去功能区。
      if (card.slides || card.design || card.designSystem || card.docs) return false;
      // 线程的卡与任务的产物按卡的 id 对（视频是视频 id，文件是 Space 条目 id）；同一部视频先认整部视频，再认片段。
      const hits = (outputs ?? []).filter((ref) => opensAsTab(ref) && resolve(ref)?.id === card.id);
      const hit = hits.find((ref) => ref.kind !== 'video-range') ?? hits[0];
      if (!hit) return false;
      onOpenOutput(outputKey(hit));
      return true;
    };
    return { unread: null, ...messageExtras, openOutput };
  }, [messageExtras, outputs, resolve, onOpenOutput]);
  const spent = useTaskSpend(item?.channelId ?? channelId, workItemId);

  const [open, setOpen] = useState(() => infoOpen.get(workItemId) !== false);
  const toggleInfo = () => {
    infoOpen.set(workItemId, !open);
    setOpen(!open);
  };

  if (!item) {
    return (
      <div className={frame}>
        <div className={centered}>{missing ? C.card.missing : <ProgressCircle size="S" isIndeterminate aria-label={C.common.loading} />}</div>
      </div>
    );
  }

  const status = workItemStatus(item);
  const actions: MenuAction[] = ['edit', ...menuActions(item)];
  const line = nextLine(item);
  const sub = [status.label, line, item.updates.length ? C.detail.updateCount(item.updates.length) : null].filter(Boolean).join(' · ');
  const question = item.question;
  const finished = allFinished ? item.finishedSteps : item.finishedSteps.slice(-FINISHED_STEPS_SHOWN);
  const placeholder = item.status === 'resolved' ? C.detail.placeholderResolved : question ? C.detail.placeholderWaiting : C.detail.placeholderWorking;

  const run = (action: MenuAction) => {
    if (action === 'edit') setDialog('edit');
    else if (action === 'stop') void call('workItems.stop', { id: item.id });
    else if (action === 'refresh') void call('workItems.refresh', { id: item.id });
    else if (action === 'markDone') void transitionWorkItem(call, item.id, { type: 'resolve', evidence: null });
    else if (action === 'reopen') void transitionWorkItem(call, item.id, { type: 'reopen' });
    else if (action === 'dismiss') void transitionWorkItem(call, item.id, { type: 'dismiss' });
    else if (action === 'start') void transitionWorkItem(call, item.id, { type: 'start' });
    else if (action === 'handToAgent') void transitionWorkItem(call, item.id, { type: 'set-owner', owner: 'agent' });
    else if (action === 'takeOver') void transitionWorkItem(call, item.id, { type: 'set-owner', owner: 'user' });
    else if (action === 'redirect') setDialog('redirect');
    else if (action === 'revertAll') setDialog('revert');
    else setDialog('delete');
  };

  const answer = async (index: number) => {
    if (!question) return;
    setAnswering(index);
    await answerWorkItemQuestion(runtime, item, question, index);
    setAnswering(null);
  };

  const infoId = `bot-detail-info-${item.id}`;
  const infoLabel = open ? C.detail.hideInfo : C.detail.showInfo;
  const header = (
    <>
      <div className={bar}>
        <div className={headRow}>
          <StatusIcon statusKey={status.key} chip />
          <div className={heading}>
            <h2 className={title({ isStruck: status.strike })} title={item.title}>
              {item.title}
            </h2>
            <span className={subline} title={sub}>
              {sub}
            </span>
          </div>
          <TooltipTrigger>
            <ActionButton isQuiet size="S" aria-label={infoLabel} aria-expanded={open} aria-controls={infoId} onPress={toggleInfo}>
              {open ? <ChevronUp /> : <ChevronDown />}
            </ActionButton>
            <Tooltip>{infoLabel}</Tooltip>
          </TooltipTrigger>
          <ActionMenu aria-label={C.common.more} isQuiet size="S" onAction={(key) => run(key as MenuAction)}>
            {actions.map((action) => (
              <MenuItem key={action} id={action} textValue={MENU_LABEL[action]()}>
                <Text>{MENU_LABEL[action]()}</Text>
              </MenuItem>
            ))}
          </ActionMenu>
        </div>
      </div>
      <div className={infoColumn}>
        <div className={infoBox({ isHidden: !question && !open, isDivided: !!item.threadId && (!!question || open) })}>
          {question ? (
            <section className={waiting} aria-label={C.detail.waiting}>
              <h3 className={blockTitle}>{C.detail.waiting}</h3>
              <p className={questionText}>{question.text}</p>
              {question.options.length && item.threadId ? (
                <div className={options}>
                  {question.options.map((option, index) => (
                    <Button
                      key={option.label}
                      size="S"
                      variant={!question.risky && question.pick === index ? 'accent' : 'secondary'}
                      isPending={answering === index}
                      isDisabled={answering !== null && answering !== index}
                      onPress={() => void answer(index)}>
                      {option.label}
                    </Button>
                  ))}
                </div>
              ) : null}
              {question.options.some((option) => option.description) ? (
                <ul className={items}>
                  {question.options
                    .filter((option) => option.description)
                    .map((option) => (
                      <li key={option.label} className={optionNote}>{`${option.label}: ${option.description}`}</li>
                    ))}
                </ul>
              ) : null}
            </section>
          ) : null}
          <div id={infoId} className={more({ isHidden: !open })}>
            <div className={facts}>
              <span>{`${C.detail.priority}: ${C.detail.priorities[item.priority]}`}</span>
              {item.dueOn ? <span>{dateFact(C.detail.due, item.dueOn, item.dueOnBy)}</span> : null}
              {item.eventOn ? <span>{dateFact(C.detail.event, item.eventOn, item.eventOnBy)}</span> : null}
              <span>{item.owner === 'user' ? C.common.me : C.common.agent}</span>
              {spent ? <span>{spent}</span> : null}
            </div>
            {item.description ? <p className={description}>{item.description}</p> : null}
            {item.owner === 'user' ? <p className={optionNote}>{C.detail.userTask}</p> : null}
            {item.steps.length ? (
              <Block label={C.detail.steps}>
                <ol className={items}>
                  {item.steps.map((step, index) => (
                    <li key={`${index}:${step.text}`} className={step.state === 'active' ? activeStep : undefined}>
                      {step.text}
                    </li>
                  ))}
                </ol>
              </Block>
            ) : null}
            {item.finishedSteps.length ? (
              <Block label={C.detail.finished}>
                <ul className={items}>
                  {finished.map((step, index) => (
                    <li key={`${step.at}:${index}`} className={itemRow}>
                      <span>{step.result ? `${step.text} — ${step.result}` : step.text}</span>
                    </li>
                  ))}
                </ul>
                {!allFinished && item.finishedSteps.length > FINISHED_STEPS_SHOWN ? (
                  <div>
                    <ActionButton isQuiet size="S" onPress={() => setAllFinished(true)}>
                      {C.detail.showAll(item.finishedSteps.length)}
                    </ActionButton>
                  </div>
                ) : null}
              </Block>
            ) : null}
            {item.outputs.length ? (
              <Block label={C.detail.outputs}>
                <ul className={items}>
                  {item.outputs.map((ref, index) => (
                    <li key={`${outputKey(ref)}:${index}`} className={itemRow}>
                      <BotOutputLink output={ref} onOpen={opensAsTab(ref) ? () => onOpenOutput(outputKey(ref)) : undefined} />
                    </li>
                  ))}
                </ul>
              </Block>
            ) : null}
            {item.resources.length ? (
              <Block label={C.detail.resources}>
                <TaskRefs refs={item.resources} item={item} />
              </Block>
            ) : null}
            {item.updates.length ? (
              <Block label={C.detail.updates}>
                <ul className={items}>
                  {[...item.updates].reverse().map((update, index) => (
                    <li key={`${update.at}:${index}`} className={itemRow}>
                      <span>{update.text}</span>
                      <span className={muted}>{`${C.detail.actor[update.by]} · ${agoLabel(update.at, now)}`}</span>
                    </li>
                  ))}
                </ul>
              </Block>
            ) : null}
            {record?.transitions.length ? (
              <Block label={C.detail.history}>
                <ul className={items}>
                  {[...record.transitions].reverse().map((transition, index) => (
                    <li key={`${transition.at}:${index}`} className={itemRow}>
                      <span>{C.detail.transition(stateName(transition.from), stateName(transition.to), C.detail.actor[transition.actor])}</span>
                      <span className={muted}>{agoLabel(transition.at, now)}</span>
                    </li>
                  ))}
                </ul>
              </Block>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );

  return (
    <section className={frame} aria-label={C.detail.label}>
      {item.threadId ? (
        <BotTimeline channelId={channelId ?? item.channelId} extras={threadExtras}>
          <ConversationView
            conversationId={item.threadId}
            autoFocus={false}
            placeholder={placeholder}
            header={header}
            empty={<div className={centered}>{C.detail.thread}</div>}
            aboveComposer={<ThreadChips threadId={item.threadId} />}
          />
        </BotTimeline>
      ) : (
        <div className={`${scroll} bc-scroll`}>
          {header}
          {item.owner !== 'user' ? <div className={centered}>{C.detail.noThread}</div> : null}
        </div>
      )}
      {dialog === 'redirect' ? <RedirectDialog item={item} onClose={() => setDialog(null)} /> : null}
      {dialog === 'edit' ? <TaskEditDialog item={item} onClose={() => setDialog(null)} /> : null}
      {dialog === 'revert' ? <RevertDialog item={item} onClose={() => setDialog(null)} /> : null}
      {dialog === 'delete' ? <DeleteRecordDialog item={item} onClose={() => setDialog(null)} onDeleted={onClose} /> : null}
    </section>
  );
}

/**
 * 线程的提示芯片（BOT-SG-01/02）：线程用 `suggest_replies` 给的答案与确认提示、Runtime 补的「是」「否」，与频道对话一样挂在输入框上方。
 */
export function ThreadChips({ threadId }: { threadId: Id }) {
  const items = useTimelineItems(threadId);
  return <SuggestionChips conversationId={threadId} items={items} />;
}

/** 改方向（BOT-TK-08）：新的要求，以及已经做到一半的那份停掉还是留着。 */
function RedirectDialog({ item, onClose }: { item: WorkItem; onClose: () => void }) {
  const call = useBotCall();
  const [text, setText] = useState('');
  const [oldWork, setOldWork] = useState<'stop' | 'keep'>('stop');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const result = await call('workItems.redirect', { id: item.id, text: text.trim(), oldWork });
    setBusy(false);
    if (result) onClose();
  };
  return (
    <DialogContainer onDismiss={onClose}>
      <Dialog size="M">
        {({ close }) => (
          <>
            <Heading slot="title">{C.detail.redirectTitle}</Heading>
            <Content>
              <div className={dialogBody}>
                <TextArea label={C.detail.redirectLabel} value={text} onChange={setText} autoFocus />
                <RadioGroup label={C.detail.oldWork} value={oldWork} onChange={(value) => setOldWork(value as 'stop' | 'keep')} orientation="horizontal">
                  <Radio value="stop">{C.detail.stopOld}</Radio>
                  <Radio value="keep">{C.detail.keepOld}</Radio>
                </RadioGroup>
              </div>
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={close}>
                {C.common.cancel}
              </Button>
              <Button variant="accent" isDisabled={!text.trim()} isPending={busy} onPress={() => void submit()}>
                {C.detail.send}
              </Button>
            </ButtonGroup>
          </>
        )}
      </Dialog>
    </DialogContainer>
  );
}

/** 视频在任务产物或资源里的名字；没有就用 id。 */
function videoName(item: WorkItem, videoId: Id): string {
  const named = [...item.outputs].find((ref) => (ref.kind === 'video' || ref.kind === 'video-range') && ref.videoId === videoId && ref.label);
  return named?.label ?? videoId;
}

/**
 * 整体撤销（BOT-EX-19）：先试算（`dryRun`），列出每部视频此后有没有你自己的改动；都能只撤智能体的时给「只撤智能体的」，
 * 否则写出原因，只能连你的一起撤。确认后才真的恢复。
 */
export function RevertDialog({ item, onClose }: { item: WorkItem; onClose: () => void }) {
  const runtime = useRuntime();
  const call = useBotCall();
  const [plan, setPlan] = useState<RevertPlan | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState<'agent' | 'all' | null>(null);
  useEffect(() => {
    let live = true;
    runtime.client
      .request('workItems.revertAll', { id: item.id, dryRun: true })
      .then((result) => {
        if (live && 'plan' in result) setPlan(result.plan);
      })
      .catch((error: unknown) => {
        if (live) setFailure(errorText(error));
      });
    return () => {
      live = false;
    };
  }, [runtime, item.id]);
  const agentOnly = !!plan?.videos.length && plan.videos.every((video) => video.agentOnlyPossible);
  const blocked = plan?.videos.find((video) => !video.agentOnlyPossible && video.reason)?.reason ?? null;
  const revert = async (keepUserEdits: boolean) => {
    setBusy(keepUserEdits ? 'agent' : 'all');
    const result = await call('workItems.revertAll', { id: item.id, keepUserEdits });
    setBusy(null);
    if (result && 'restored' in result) {
      ToastQueue.positive(C.detail.reverted(result.restored.length), { timeout: 4000 });
      onClose();
    }
  };
  return (
    <DialogContainer onDismiss={onClose}>
      <Dialog size="M" role="alertdialog">
        {({ close }) => (
          <>
            <Heading slot="title">{C.detail.revertTitle}</Heading>
            <Content>
              <div className={dialogBody}>
                {failure ? (
                  <span>{C.common.failed(failure)}</span>
                ) : !plan ? (
                  <span>{C.detail.revertChecking}</span>
                ) : !plan.videos.length ? (
                  <span>{C.detail.revertNothing}</span>
                ) : (
                  <>
                    <ul className={items}>
                      {plan.videos.map((video) => (
                        <li key={video.videoId}>
                          {C.detail.revertVideo(videoName(item, video.videoId), video.userEdits.length)}
                          <RevertChanges edits={video.userEdits} />
                        </li>
                      ))}
                    </ul>
                    {!agentOnly && blocked ? <span>{C.detail.revertBlocked(blocked)}</span> : null}
                  </>
                )}
              </div>
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={close}>
                {C.common.cancel}
              </Button>
              {plan?.videos.length && agentOnly ? (
                <Button variant="accent" isPending={busy === 'agent'} isDisabled={!!busy} onPress={() => void revert(true)}>
                  {C.detail.revertAgentOnly}
                </Button>
              ) : null}
              {plan?.videos.length ? (
                <Button variant="negative" fillStyle={agentOnly ? 'outline' : 'fill'} isPending={busy === 'all'} isDisabled={!!busy} onPress={() => void revert(false)}>
                  {C.detail.revertEverything}
                </Button>
              ) : null}
            </ButtonGroup>
          </>
        )}
      </Dialog>
    </DialogContainer>
  );
}

/** 你在这期间改了什么（BOT-EX-19「哪部视频、改了什么」）：同名的操作合在一起计次数。 */
function RevertChanges({ edits }: { edits: RevertPlan['videos'][number]['userEdits'] }) {
  const counts = new Map<string, number>();
  for (const edit of edits) for (const change of edit.changes ?? []) {
    const label = localizeText(change.label, change.labelRef);
    counts.set(label, (counts.get(label) ?? 0) + change.count);
  }
  if (!counts.size) return null;
  return (
    <ul className={changeList}>
      {[...counts].map(([label, count]) => (
        <li key={label}>{C.detail.revertChange(label, count)}</li>
      ))}
    </ul>
  );
}

/** 删除任务记录（BOT-EX-20）：先试算要删的文件与因为别的任务还在用而保留的，确认时带上这份文件单。 */
export function DeleteRecordDialog({ item, onClose, onDeleted }: { item: WorkItem; onClose: () => void; onDeleted: () => void }) {
  const runtime = useRuntime();
  const call = useBotCall();
  const [plan, setPlan] = useState<{ files: string[]; keptShared: string[] } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    runtime.client
      .request('workItems.deleteRecord', { id: item.id, dryRun: true })
      .then((result) => {
        if (live) setPlan({ files: result.files, keptShared: result.keptShared });
      })
      .catch((error: unknown) => {
        if (live) setFailure(errorText(error));
      });
    return () => {
      live = false;
    };
  }, [runtime, item.id]);
  const confirm = async () => {
    if (!plan) return;
    setBusy(true);
    const result = await call('workItems.deleteRecord', { id: item.id, confirm: { files: plan.files } });
    setBusy(false);
    if (result?.deleted) {
      onClose();
      onDeleted();
    }
  };
  return (
    <DialogContainer onDismiss={onClose}>
      <Dialog size="M" role="alertdialog">
        {({ close }) => (
          <>
            <Heading slot="title">{C.detail.deleteTitle}</Heading>
            <Content>
              <div className={dialogBody}>
                <span>{C.detail.deleteBody}</span>
                {item.status === 'active' && item.threadId ? <span>{C.detail.deleteStopsFirst}</span> : null}
                {failure ? (
                  <span>{C.common.failed(failure)}</span>
                ) : !plan ? (
                  <ProgressCircle size="S" isIndeterminate aria-label={C.common.loading} />
                ) : (
                  <>
                    {plan.files.length ? (
                      <ul className={items}>
                        {plan.files.map((file) => (
                          <li key={file}>{file}</li>
                        ))}
                      </ul>
                    ) : (
                      <span>{C.detail.deleteNoFiles}</span>
                    )}
                    {plan.keptShared.length ? (
                      <>
                        <span>{C.detail.deleteKept}</span>
                        <ul className={items}>
                          {plan.keptShared.map((file) => (
                            <li key={file}>{file}</li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                  </>
                )}
              </div>
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={close}>
                {C.common.cancel}
              </Button>
              <Button variant="negative" isDisabled={!plan} isPending={busy} onPress={() => void confirm()}>
                {C.detail.delete}
              </Button>
            </ButtonGroup>
          </>
        )}
      </Dialog>
    </DialogContainer>
  );
}

/** 授权的花费一行（收件箱也用）。 */
export function costLine(cost: { amount: string; currency: string } | null): string | null {
  return cost ? C.detail.cost(formatMoneyOne(cost)) : null;
}
