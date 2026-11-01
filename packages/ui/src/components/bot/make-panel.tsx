import { useMemo, useRef, useState } from 'react';
import type { Id, WorkItem } from '@baocut/protocol';
import {
  ActionButton,
  ActionMenu,
  Button,
  DialogContainer,
  MenuItem,
  ProgressCircle,
  SegmentedControl,
  SegmentedControlItem,
  Text,
  ToastQueue,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import Calendar from '@react-spectrum/s2/icons/Calendar';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import Close from '@react-spectrum/s2/icons/Close';
import Lightbulb from '@react-spectrum/s2/icons/Lightbulb';
import MagicWand from '@react-spectrum/s2/icons/MagicWand';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { describeCadence } from '../../model/agent-schedule.ts';
import {
  MAKE_TEMPLATES,
  makeGallery,
  opensAsTab,
  outputKey,
  suggestionPreview,
  type MakeOutput,
  type MakeScope,
  type MakeTemplateId,
  type SuggestionPreview,
} from '../../model/bot.ts';
import { agoLabel } from '../../model/format.ts';
import { useChannels } from '../../state/channels-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { useWorkItems } from '../../state/work-items-store.ts';
import { ScheduleDialog } from '../agent-schedule/schedule-dialog.tsx';
import { useNow } from '../use-now.ts';
import { transitionWorkItem, useBotCall } from './bot-actions.ts';
import { BOT_COPY as C } from './bot-copy.ts';
import { OUTPUT_ICON, outputLabel } from './bot-output-link.tsx';
import { StatusIcon } from './status-badge.tsx';
import { Section, list, panel, row, rowMain, rowSub, rowText, rowTitle } from './task-panel.tsx';
import { SuggestionButtons } from './timeline/proposal-card.tsx';

/** 原型 page-bot.css 的 `.bot-make*`。 */
/** 顶上一行：左边切范围，右边「给点建议」（原型 page-bot.css `.bot-make__scope`）；名字在页签上。 */
const scopeBar = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexShrink: 0, paddingStart: 16, paddingEnd: 12, paddingTop: 12, paddingBottom: 8 });
const body = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
  flexGrow: 1,
  minHeight: 0,
  overflowY: 'auto',
  paddingX: 16,
  paddingTop: 4,
  paddingBottom: 24,
});
const none = style({ margin: 0, padding: 16, borderRadius: '[10px]', backgroundColor: 'gray-50', font: 'body-sm', color: 'gray-700' });
const loadingRow = style({ display: 'flex', justifyContent: 'center' });
const hero = style({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 0,
  overflow: 'hidden',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderRadius: '[10px]',
  backgroundColor: 'gray-25',
});
const art = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  height: 128,
  backgroundColor: 'orange-100',
  color: 'orange-900',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const artIcon = iconStyle({ size: 'XL' });
const frame = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'end',
  gap: 4,
  height: 88,
  boxSizing: 'border-box',
  paddingBottom: { default: 0, isWide: 12 },
  aspectRatio: { default: '[9 / 16]', isWide: '[16 / 9]' },
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'orange-300',
  borderRadius: 'lg',
  backgroundColor: 'gray-25',
});
const captionBar = style({ height: 6, width: { default: '[72%]', isShort: '[48%]' }, borderRadius: 'sm', backgroundColor: 'gray-800' });
const heroDismiss = style({ position: 'absolute', top: 8, insetEnd: 8 });
const heroBody = style({ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 });
const heroTitle = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });
const tag = style({
  flexShrink: 0,
  paddingX: 8,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderRadius: 'lg',
  paddingY: 2,
  font: 'ui-xs',
  color: 'gray-800',
});
const heroName = style({
  flexGrow: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  font: 'ui',
  fontWeight: 'bold',
  color: 'gray-900',
});
const heroReason = style({ font: 'ui-xs', color: 'gray-700' });
const sectionBox = style({ display: 'flex', flexDirection: 'column', gap: 8 });
const rowActions = style({ display: 'flex', alignItems: 'center', gap: 4, alignSelf: 'center', flexShrink: 0, paddingEnd: 4 });
const rowMore = style({ paddingStart: 40, paddingEnd: 8, paddingBottom: 8 });
const grid = style({
  display: 'grid',
  gridTemplateColumns: ['minmax(0, 1fr)', 'minmax(0, 1fr)'],
  gap: 8,
  margin: 0,
  padding: 0,
  listStyleType: 'none',
});
const outputCell = style({ display: 'flex', minWidth: 0 });
const outputButton = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  width: 'full',
  boxSizing: 'border-box',
  overflow: 'hidden',
  paddingX: 12,
  paddingTop: 12,
  paddingBottom: 0,
  borderWidth: 0,
  borderRadius: '[10px]',
  backgroundColor: { default: 'gray-75', ':hover': 'gray-100' },
  font: 'ui',
  textAlign: 'start',
  cursor: 'default',
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: 2,
});
const outputName = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  font: 'ui',
  fontWeight: 'medium',
  color: 'gray-900',
});
const outputMeta = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  minWidth: 0,
  font: 'ui-xs',
  color: 'gray-600',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const outputMetaText = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const outputThumb = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 56,
  marginTop: 8,
  borderWidth: 1,
  borderBottomWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderTopStartRadius: 'lg',
  borderTopEndRadius: 'lg',
  backgroundColor: 'gray-25',
  color: 'gray-400',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const thumbIcon = iconStyle({ size: 'L' });
const stripWrap = style({ position: 'relative' });
const strip = style({
  display: 'flex',
  gap: 8,
  margin: 0,
  paddingStart: 0,
  paddingEnd: 32,
  paddingY: 0,
  paddingBottom: 4,
  listStyleType: 'none',
  overflowX: 'auto',
});
const template = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  flexShrink: 0,
  width: 160,
  boxSizing: 'border-box',
  paddingStart: 12,
  paddingEnd: 8,
  paddingTop: 8,
  paddingBottom: 12,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderRadius: '[10px]',
  backgroundColor: 'gray-25',
});
const templateTop = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'gray-700' });
const templateName = style({ font: 'ui', fontWeight: 'bold', color: 'gray-900' });
const templateText = style({ font: 'ui-xs', color: 'gray-700', lineClamp: 2 });
const templateEvery = style({ font: 'ui-xs', color: 'gray-600' });
const moreTemplates = style({
  position: 'absolute',
  top: '[50%]',
  insetEnd: 0,
  transform: 'translateY(-50%)',
  borderRadius: 'lg',
  backgroundColor: 'gray-25',
});

/** 建议大卡的预览：按建议的种类画一个示意（竖版是三块 9:16，字幕是一帧画面加两行字幕条），不是真缩略图。 */
function SuggestionArt({ preview }: { preview: SuggestionPreview }) {
  return (
    <div className={art} aria-hidden="true" data-bc-icons="own">
      {preview === 'clips' ? (
        [0, 1, 2].map((n) => <span key={n} className={frame({ isWide: false })} />)
      ) : preview === 'captions' ? (
        <span className={frame({ isWide: true })}>
          <span className={captionBar({ isShort: false })} />
          <span className={captionBar({ isShort: true })} />
        </span>
      ) : (
        <Lightbulb styles={artIcon} />
      )}
    </div>
  );
}

function useRun(): [boolean, (fn: () => Promise<unknown>) => Promise<void>] {
  const [pending, setPending] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setPending(true);
    await fn();
    setPending(false);
  };
  return [pending, run];
}

/** 第一条建议（BOT-MK-04）：预览、种类标签与标题、理由，下面是依据、归属、改标题与「现在做」「加入」；右上角 ✕ 是忽略。 */
function SuggestionHero({ item, channelName }: { item: WorkItem; channelName: string | null }) {
  const call = useBotCall();
  const [pending, run] = useRun();
  const preview = suggestionPreview(item.suggestion?.kindTag);
  const reason = [channelName, item.suggestion?.reason].filter(Boolean).join(' · ');
  return (
    <section className={hero} aria-label={C.make.hero(item.title)}>
      <SuggestionArt preview={preview} />
      <span className={heroDismiss}>
        <ActionButton
          isQuiet
          size="S"
          aria-label={C.make.dismissOne(item.title)}
          isDisabled={pending}
          onPress={() => void run(() => transitionWorkItem(call, item.id, { type: 'dismiss' }))}>
          <Close />
        </ActionButton>
      </span>
      <div className={heroBody}>
        <div className={heroTitle}>
          <span className={tag}>{C.make.kind[preview]}</span>
          <span className={heroName} title={item.title}>
            {item.title}
          </span>
        </div>
        {reason ? <span className={heroReason}>{reason}</span> : null}
        <SuggestionButtons item={item} pending={pending} run={run} call={call} dismiss={false} accent />
      </div>
    </section>
  );
}

/**
 * 其余的建议：一行一条，行尾「现在做」和 ⋯（加入、忽略），按建议里的归属采纳。点标题展开成和大卡一样的完整处理
 * （依据、归属、改标题），收起时行尾按钮回来。
 */
function SuggestionRow({ item, channelName }: { item: WorkItem; channelName: string | null }) {
  const call = useBotCall();
  const [pending, run] = useRun();
  const [expanded, setExpanded] = useState(false);
  const owner = item.suggestion?.owner ?? item.owner;
  const sub = [channelName, item.suggestion?.reason].filter(Boolean).join(' · ');
  const accept = (start: boolean) => void run(() => transitionWorkItem(call, item.id, { type: 'accept', start, owner }));
  const dismiss = () => void run(() => transitionWorkItem(call, item.id, { type: 'dismiss' }));
  return (
    <li>
      <div className={row({ isSelected: expanded })}>
        <button type="button" className={rowMain} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          <StatusIcon statusKey="suggested" chip />
          <span className={rowText}>
            <span className={rowTitle({ isStruck: false })}>{item.title}</span>
            {sub ? <span className={rowSub}>{sub}</span> : null}
          </span>
        </button>
        {expanded ? null : (
          <span className={rowActions}>
            {owner === 'agent' ? (
              <Button size="S" variant="secondary" isDisabled={pending} onPress={() => accept(true)}>
                {C.proposal.doNow}
              </Button>
            ) : null}
            <ActionMenu
              aria-label={C.common.more}
              isQuiet
              size="S"
              isDisabled={pending}
              onAction={(key) => (key === 'add' ? accept(false) : dismiss())}>
              <MenuItem id="add" textValue={C.proposal.add}>
                <Text>{C.proposal.add}</Text>
              </MenuItem>
              <MenuItem id="dismiss" textValue={C.proposal.dismiss}>
                <Text>{C.proposal.dismiss}</Text>
              </MenuItem>
            </ActionMenu>
          </span>
        )}
      </div>
      {expanded ? (
        <div className={rowMore}>
          <SuggestionButtons item={item} pending={pending} run={run} call={call} />
        </div>
      ) : null}
    </li>
  );
}

/** 产物卡：名字、种类 ·（全部频道时的频道名）· 多久以前，下面是种类图标的占位预览；点了在右栏推开它的产物页签（产物页签开不了的产物打开产出它的任务）。 */
function OutputCard({
  output,
  channelName,
  now,
  onOpen,
}: {
  output: MakeOutput;
  channelName: string | null;
  now: number;
  onOpen: () => void;
}) {
  const Icon = OUTPUT_ICON[output.kind];
  const label = outputLabel(output.output);
  const meta = [C.make.outputKind[output.kind], channelName, agoLabel(new Date(output.at).toISOString(), now)].filter(Boolean).join(' · ');
  return (
    <li className={outputCell}>
      <button
        type="button"
        className={outputButton}
        onClick={onOpen}
        aria-label={C.make.openOutput(label, meta, output.item.title)}>
        <span className={outputName}>{label}</span>
        <span className={outputMeta}>
          <Icon />
          <span className={outputMetaText}>{meta}</span>
        </span>
        <span className={outputThumb} aria-hidden="true" data-bc-icons="own">
          <Icon styles={thumbIcon} />
        </span>
      </button>
    </li>
  );
}

/** 模板卡（BOT-MK-05）：图标、「＋」、名字、做什么与频率。 */
function TemplateCard({ id, every, onAdd }: { id: MakeTemplateId; every: string; onAdd: () => void }) {
  const copy = C.make.template[id];
  return (
    <li className={template}>
      <div className={templateTop}>
        <Calendar />
        <ActionButton isQuiet size="S" aria-label={C.make.addTemplate(copy.title)} onPress={onAdd}>
          <Add />
        </ActionButton>
      </div>
      <span className={templateName}>{copy.title}</span>
      <span className={templateText}>{copy.prompt}</span>
      <span className={templateEvery}>{every}</span>
    </li>
  );
}

/**
 * Make 面板（BOT-MK-01、04、05，需求 §6、§11.11）：右栏的「Make」页签，由频道头的「Make」开关打开。
 * 顶上一行切「这个频道 / 全部频道」（范围由 Bot 页持有，看全部频道时 Bot 页订阅所有没归档频道的任务），右边是「给点建议」
 * （`bot.make.run`，给这个频道）；收起与关闭在页签条上。最上面是建议（第一条是带预览的大卡，其余一行一条），然后是最近的产物，
 * 最后一排周期任务模板：「＋」打开周期任务对话框，名字、指令与频率填好、目标是这个频道，确认才建。
 */
export function MakePanel({
  channelId,
  scope,
  onScope,
}: {
  channelId: Id;
  scope: MakeScope;
  onScope: (scope: MakeScope) => void;
}) {
  const go = useShell((s) => s.go);
  const call = useBotCall();
  const now = useNow(60_000);
  const summaries = useChannels((s) => s.channels);
  const byChannel = useWorkItems((s) => s.byChannel);
  const ids = useMemo(
    () => (scope === 'all' ? summaries.filter((c) => !c.channel.archived).map((c) => c.channel.id) : [channelId]),
    [scope, summaries, channelId],
  );
  const items = useMemo(() => ids.flatMap((id) => byChannel[id]?.items ?? []), [ids, byChannel]);
  const loaded = ids.every((id) => id in byChannel);
  const gallery = useMemo(() => makeGallery(items, now), [items, now]);
  const nameOf = (id: Id) => (scope === 'all' ? (summaries.find((c) => c.channel.id === id)?.channel.name ?? null) : null);
  const [making, setMaking] = useState(false);
  const [adding, setAdding] = useState<MakeTemplateId | null>(null);
  const stripRef = useRef<HTMLUListElement>(null);
  const [first, ...rest] = gallery.suggestions;

  const suggest = async () => {
    setMaking(true);
    const result = await call('bot.make.run', { channelId });
    setMaking(false);
    if (result && result.shown === 0) ToastQueue.neutral(C.make.noneNew, { timeout: 4000 });
  };
  // 产物卡在右栏开它的产物页签；在这里看不了的（文档 id 这类）开产出它的任务。
  const open = ({ item, output }: MakeOutput) =>
    go({ tab: 'bot', channelId: item.channelId, workItemId: item.id, view: 'channel', ...(opensAsTab(output) ? { output: outputKey(output) } : {}) });
  const cards = (outputs: readonly MakeOutput[]) => (
    <ul className={grid}>
      {outputs.map((o, n) => (
        <OutputCard key={`${o.item.id}-${n}`} output={o} channelName={nameOf(o.item.channelId)} now={now} onOpen={() => open(o)} />
      ))}
    </ul>
  );
  const addingTemplate = adding ? MAKE_TEMPLATES.find((t) => t.id === adding) : undefined;

  return (
    <section className={panel} aria-label={C.make.title}>
      <div className={scopeBar}>
        <SegmentedControl aria-label={C.make.scope} selectedKey={scope} onSelectionChange={(key) => onScope(key as MakeScope)}>
          <SegmentedControlItem id="channel">{C.make.scopeChannel}</SegmentedControlItem>
          <SegmentedControlItem id="all">{C.make.scopeAll}</SegmentedControlItem>
        </SegmentedControl>
        <TooltipTrigger>
          <ActionButton isQuiet size="S" aria-label={C.make.suggest} isPending={making} onPress={() => void suggest()}>
            <MagicWand />
          </ActionButton>
          <Tooltip>{C.make.suggest}</Tooltip>
        </TooltipTrigger>
      </div>
      <div className={`${body} bc-scroll`}>
        {!loaded ? (
          <div className={loadingRow}>
            <ProgressCircle size="S" isIndeterminate aria-label={C.common.loading} />
          </div>
        ) : null}
        {first ? (
          <SuggestionHero key={first.id} item={first} channelName={nameOf(first.channelId)} />
        ) : loaded ? (
          <p className={none}>{C.make.none}</p>
        ) : null}
        {rest.length ? (
          <div className={sectionBox}>
            <Section title={C.make.more} count={rest.length}>
              <ul className={list}>
                {rest.map((item) => (
                  <SuggestionRow key={item.id} item={item} channelName={nameOf(item.channelId)} />
                ))}
              </ul>
            </Section>
          </div>
        ) : null}
        {gallery.today.length ? (
          <Section title={C.make.today} count={gallery.today.length}>
            {cards(gallery.today)}
          </Section>
        ) : null}
        {gallery.earlier.length ? <Section title={C.make.earlier}>{cards(gallery.earlier)}</Section> : null}
        {!gallery.today.length && !gallery.earlier.length && loaded ? (
          <Section title={C.make.outputs}>
            <p className={none}>{C.make.noOutputs}</p>
          </Section>
        ) : null}
        <Section title={C.make.templates}>
          <div className={stripWrap}>
            <ul className={`${strip} bc-scroll`} ref={stripRef}>
              {MAKE_TEMPLATES.map((t) => (
                <TemplateCard key={t.id} id={t.id} every={describeCadence(t.cadence)} onAdd={() => setAdding(t.id)} />
              ))}
            </ul>
            <span className={moreTemplates}>
              <ActionButton
                isQuiet
                size="S"
                aria-label={C.make.moreTemplates}
                onPress={() => stripRef.current?.scrollBy({ left: 180, behavior: 'smooth' })}>
                <ChevronRight />
              </ActionButton>
            </span>
          </div>
        </Section>
      </div>
      <DialogContainer onDismiss={() => setAdding(null)}>
        {addingTemplate ? (
          <ScheduleDialog
            channelId={channelId}
            initial={{
              name: C.make.template[addingTemplate.id].title,
              prompt: C.make.template[addingTemplate.id].prompt,
              cadence: structuredClone(addingTemplate.cadence),
            }}
            onClose={() => setAdding(null)}
          />
        ) : null}
      </DialogContainer>
    </section>
  );
}
