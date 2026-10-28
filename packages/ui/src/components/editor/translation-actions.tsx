import { useMemo, useState, type ReactNode, type RefObject } from 'react';
import type { Id } from '@baocut/protocol';
import { ActionButton, ActionMenu, Button, DialogTrigger, Menu, MenuItem, MenuSection, MenuTrigger, Popover, Text, ToastQueue, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import AIMark from '@react-spectrum/s2/icons/AIMark';
import Chat from '@react-spectrum/s2/icons/Chat';
import Checkmark from '@react-spectrum/s2/icons/Checkmark';
import Clock from '@react-spectrum/s2/icons/Clock';
import Copy from '@react-spectrum/s2/icons/Copy';
import Translate from '@react-spectrum/s2/icons/Translate';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton } from 'react-aria-components';
import { retranslatePrompt, TOOL_SKILL } from '../../model/ai-tools.ts';
import { currentConversation } from '../../model/ai-tools-handoff.ts';
import { gateGuide, homeGate } from '../../model/home-brief.ts';
import { translateModelOptions } from '../../model/tool-runs.ts';
import { findOption, initialModelKey, optionName, parseModelKey, withoutCaution } from '../../model/tools-models.ts';
import { isStale, type PairRow, type PairStats } from '../../model/translation-doc.ts';
import { targetKey } from '../../model/workspace.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useConnection } from '../../state/connection-store.ts';
import { useDirectory } from '../../state/directory-store.ts';
import { useModels } from '../../state/models-store.ts';
import { routeVideo, useShell } from '../../state/shell-store.ts';
import { useVideo } from '../../state/video-store.ts';
import { handToAgent } from './ai-tools-handoff.ts';
import { TRANSLATE_COPY as C } from './translate-copy.ts';

/**
 * 译文对照列表上的动作（产品设计 §5.10「逐句与过期译文」，原型 panel-translate.jsx 的统计条与 ⋯ 菜单）：一行的统计条
 * （左边句数与要处理的计数、右边一枚 AI 钮），一句的 ⋯ 菜单，以及两条重译的路——用模型 API（Runtime 的 `translate` 就地
 * 刷新）与交给 Agent（发到这部视频当前的会话）。两条路的说明一行写清差别：直接调哪只模型、按用量计费；在当前会话里做、用
 * Agent 订阅。网页宿主没有这些要调模型或会话的入口，只留过期标记与复制。
 */

const statbar = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexShrink: 0,
  paddingStart: 12,
  paddingEnd: 8,
  paddingY: 4,
  minHeight: 32,
  borderTopWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderBottomWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  font: 'ui-xs',
  color: 'gray-600',
});
const counts = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexGrow: 1,
  minWidth: 0,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
});
const warn = style({ color: 'orange-1000', fontWeight: 'medium' });
const fresh = style({ color: 'green-1000' });
/** 「N 术语不一致」：同别的计数一样的字，点开列出位置（原型 subtitle-tm.jsx `TmConflicts`）。 */
const termsButton = style({
  padding: 0,
  borderWidth: 0,
  backgroundColor: 'transparent',
  font: 'ui-xs',
  color: 'orange-1000',
  fontWeight: 'medium',
  cursor: 'pointer',
  textDecoration: { isHovered: 'underline' },
  borderRadius: 'sm',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
});
const termsPop = style({ display: 'flex', flexDirection: 'column', alignItems: 'start', gap: 8, width: 320, maxWidth: '[100%]' });
const termsLead = style({ font: 'ui-xs', color: 'gray-600' });
const termsList = style({ display: 'flex', flexDirection: 'column', gap: 4, margin: 0, padding: 0, listStyleType: 'none', maxHeight: 240, overflowY: 'auto', alignSelf: 'stretch' });
const termsRow = style({ display: 'flex', alignItems: 'baseline', gap: 4, minWidth: 0 });
const termsTime = style({ flexShrink: 0 });
const termsText = style({ flexGrow: 1, minWidth: 0, font: 'ui-xs', color: 'gray-800', overflowWrap: 'anywhere' });

/**
 * 直接重译用哪只文本模型：同翻译设置页的缺省（文本生成的默认值，不能用时第一只能用的；翻译要结构化输出）。
 * 能力还没读到、或一只能用的都没有时 `ref` 为 null，由 Runtime 用默认值或以「没有配置」拒绝（问题卡给去处）。
 */
export function useRetranslateModel(): { ref: { providerId: string; modelId: string } | null; name: string | null } {
  const view = useModels((s) => s.capabilities);
  return useMemo(() => {
    const options = view ? translateModelOptions(view) : [];
    const option = findOption(options, initialModelKey(options, null, view?.generateText.effective ?? null, withoutCaution));
    const ref = option?.usable ? parseModelKey(option.key) : null;
    return { ref: ref ? { providerId: ref.providerId, modelId: ref.modelId } : null, name: option?.usable ? optionName(option) : null };
  }, [view]);
}

/**
 * 交给 Agent 重译：发到这部视频当前的会话（Home 左侧那条，或 Space 里这个视频的悬浮会话最近发起的那条，且与视频同属一个
 * 项目或工作目录），没有就新开一条；挂上翻译的 skill，留在原地不切走（`stay`）。Agent 用不了时说清楚并带去设置。
 */
export function useAgentRetranslate(videoId: Id): (prompt: { language: string; scope?: { time: string | null; text: string } | null; count?: number }) => void {
  const runtime = useRuntime();
  const ref = useVideo((s) => s.video?.ref ?? null);
  const drivers = useConnection((s) => s.drivers);
  const checking = useConnection((s) => s.checking);
  const conversations = useDirectory((s) => s.conversations);
  const go = useShell((s) => s.go);
  const current = useShell((s) => {
    if (s.route.tab === 'home') return s.route.conversationId;
    const shown = routeVideo(s.route);
    return s.route.tab === 'space' && shown ? (s.videoChats[targetKey(shown)] ?? null) : null;
  });
  return (o) => {
    const guide = gateGuide(homeGate(drivers, checking));
    if (guide) {
      ToastQueue.neutral(guide.title, { timeout: 5000 });
      go({ tab: 'settings', section: 'agent' });
      return;
    }
    // 只认眼前这条（不退到项目里最近的那条）：不是当前会话就新开一条，免得发进一条用户没在看的旧会话。
    const here = currentConversation({ source: ref?.source ?? null, current, conversations: conversations.filter((c) => c.id === current) });
    const skill = TOOL_SKILL.stale;
    void handToAgent(runtime, {
      video: ref,
      session: here ? { id: here.id } : 'new',
      text: retranslatePrompt({ title: ref?.name ?? null, ...o }),
      attachments: [],
      skills: skill ? [{ id: skill }] : [],
      draftKey: `retranslate:${videoId}`,
      stay: true,
    });
  };
}

export interface StatbarProps {
  stats: PairStats;
  /** 整句的画面都剪掉了的句数（时间线上用到了这份转写时才算）。 */
  cut: number;
  /** 要重译的句数：过期的与还没有译文的。 */
  todo: number;
  /** 正在重译：句数（别处发起、没点名句子时 null）；没在重译时 undefined。 */
  refreshing: number | null | undefined;
  /** 网页宿主：只有计数，提示去 Agent 或 App 里重译。 */
  web: boolean;
  editable: boolean;
  modelName: string | null;
  onDirect(): void;
  onAgent(): void;
  onCut(): void;
  onTranslateTool(): void;
  /** 统计条上的「N 术语不一致」（没有时 null）。 */
  terms: ReactNode;
}

/** 统计条（原型 `.statbar--one`）：一行放下，左边句数与计数（全称在提示里），右边一枚 AI 钮收下所有要调模型或会话的动作。 */
export function TranslationStatbar(p: StatbarProps) {
  const { stats, cut, todo } = p;
  const ai = !p.web && p.editable;
  const busy = p.refreshing !== undefined;
  return (
    <div className={statbar}>
      <span className={counts} title={p.editable ? C.editHint : undefined}>
        {busy ? (
          <span className={warn} role="status">
            {C.refreshing(p.refreshing ?? null)}
          </span>
        ) : (
          <>
            <span className="bc-tabular">{C.stats(stats.sentences)}</span>
            {stats.untranslated ? (
              <span className={warn} title={C.untranslated(stats.untranslated)}>
                {C.untranslatedShort(stats.untranslated)}
              </span>
            ) : null}
            {stats.stale ? (
              <span className={warn} title={p.web ? `${C.stale(stats.stale)} · ${C.webHint}` : C.stale(stats.stale)}>
                {C.staleShort(stats.stale)}
              </span>
            ) : null}
            {cut ? (
              <span className={warn} title={C.cut(cut)}>
                {C.cutShort(cut)}
              </span>
            ) : null}
            {stats.gone ? (
              <span className={warn} title={C.gone(stats.gone)}>
                {C.goneShort(stats.gone)}
              </span>
            ) : null}
            {p.terms}
            {todo + cut + stats.gone ? null : <span className={fresh}>{C.allFresh}</span>}
          </>
        )}
      </span>
      {ai ? (
        <TooltipTrigger>
          <MenuTrigger align="end">
            <ActionButton isQuiet size="S" aria-label={C.aiMenu}>
              <AIMark />
            </ActionButton>
            <Menu
              disabledKeys={busy ? ['direct'] : []}
              onAction={(key) => {
                if (key === 'direct') p.onDirect();
                else if (key === 'agent') p.onAgent();
                else if (key === 'cut') p.onCut();
                else if (key === 'tool') p.onTranslateTool();
              }}>
              {todo || cut ? (
                <MenuSection>
                  {todo ? (
                    <MenuItem id="direct" textValue={C.directAll(todo)}>
                      <AIMark />
                      <Text slot="label">{C.directAll(todo)}</Text>
                      <Text slot="description">{C.viaModel(p.modelName)}</Text>
                    </MenuItem>
                  ) : null}
                  {todo ? (
                    <MenuItem id="agent" textValue={C.agentAll(todo)}>
                      <Chat />
                      <Text slot="label">{C.agentAll(todo)}</Text>
                      <Text slot="description">{C.viaAgent}</Text>
                    </MenuItem>
                  ) : null}
                  {cut ? (
                    <MenuItem id="cut" textValue={C.handleCut(cut)}>
                      <Clock />
                      <Text slot="label">{C.handleCut(cut)}</Text>
                      <Text slot="description">{C.handleCutSub}</Text>
                    </MenuItem>
                  ) : null}
                </MenuSection>
              ) : null}
              <MenuSection>
                <MenuItem id="tool" textValue={C.translateTool}>
                  <Translate />
                  <Text slot="label">{C.translateTool}</Text>
                  <Text slot="description">{C.translateToolSub}</Text>
                </MenuItem>
              </MenuSection>
            </Menu>
          </MenuTrigger>
          <Tooltip>{busy ? C.refreshing(p.refreshing ?? null) : C.aiMenu}</Tooltip>
        </TooltipTrigger>
      ) : null}
    </div>
  );
}

/** 术语不一致的一处（`termSpots` 加上这一句在序列上的时间）。 */
export interface TermSpotItem {
  key: string;
  /** 这一句在序列上的起点；画面剪掉了时 null。 */
  at: number | null;
  time: string | null;
  term: string;
  got: string;
  want: string;
}

/**
 * 统计条上的「N 术语不一致」（创作辅助集成设计 §2.6、§3.7；原型 subtitle-tm.jsx `TmConflicts`）：点开列出位置（点时间跳过去），
 * 「统一为术语表译法」是一笔普通编辑，Web 也有（不调模型）。只读的视频能看不能统一。
 */
export function TermMismatches({ spots, editable, onSeek, onUnify }: { spots: readonly TermSpotItem[]; editable: boolean; onSeek(at: number): void; onUnify(): void }) {
  const [open, setOpen] = useState(false);
  if (!spots.length) return null;
  return (
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <RACButton className={termsButton} aria-label={C.terms(spots.length)}>
        <span title={C.terms(spots.length)}>{C.termsShort(spots.length)}</span>
      </RACButton>
      <Popover placement="bottom start" aria-label={C.termsTitle}>
        <div className={termsPop}>
          <span className={termsLead}>{C.termsLead}</span>
          <ul className={termsList}>
            {spots.map((spot) => (
              <li key={`${spot.key}:${spot.term}`} className={termsRow}>
                <ActionButton
                  isQuiet
                  size="XS"
                  styles={termsTime}
                  isDisabled={spot.at === null}
                  aria-label={C.seekTip}
                  onPress={() => {
                    setOpen(false);
                    if (spot.at !== null) onSeek(spot.at);
                  }}>
                  <Text>{spot.time ?? '—'}</Text>
                </ActionButton>
                <span className={termsText}>
                  <b>{spot.term}</b>
                  {C.termsSpot(spot.got, spot.want)}
                </span>
              </li>
            ))}
          </ul>
          <Button
            size="S"
            variant="accent"
            isDisabled={!editable}
            onPress={() => {
              setOpen(false);
              onUnify();
            }}>
            {C.termsUnify}
          </Button>
        </div>
      </Popover>
    </DialogTrigger>
  );
}

/** 一句的 ⋯ 菜单里能做的（TranslationList 每次渲染换成最新的一份，卡经 ref 调）。 */
export interface UnitMenuActions {
  direct(row: PairRow): void;
  agent(row: PairRow): void;
  mark(row: PairRow, on: boolean): void;
}

/**
 * 一句的 ⋯ 菜单（原型 `moreFor`）：用模型 API 重译这一句、交给 Agent 重译这一句（只在桌面端），标为过期或去掉过期标记，
 * 复制译文。原句没了的只能复制；只读时只能复制。沿用的译文（翻译记忆，原型 subtitle-tm.jsx）第一项写作「改为重译」：
 * 同一次就地刷新，重译后的单元不再带 `reuse`，提示里的撤销连同沿用标记一起放回来。
 */
export function UnitMenu({
  row,
  index,
  text,
  ai,
  editable,
  busy,
  modelName,
  reused = null,
  actions,
}: {
  row: PairRow;
  index: number;
  text: string;
  /** 桌面端：能调模型与会话。 */
  ai: boolean;
  /** 这一行能改：视频可改、原句还在。 */
  editable: boolean;
  /** 这份译文正在重译：不再发一次。 */
  busy: boolean;
  modelName: string | null;
  /** 沿用的译文：来源视频的名字（找不到时空串）；不是沿用的为 null。 */
  reused?: string | null;
  actions: RefObject<UnitMenuActions>;
}) {
  const stale = isStale(row.state);
  const disabled = [...(busy ? ['direct'] : []), ...(text ? [] : ['copy'])];
  return (
    <ActionMenu
      aria-label={C.unitMenu(index + 1)}
      isQuiet
      size="XS"
      align="end"
      disabledKeys={disabled}
      onAction={(key) => {
        if (key === 'direct') actions.current.direct(row);
        else if (key === 'agent') actions.current.agent(row);
        else if (key === 'mark') actions.current.mark(row, !stale);
        else if (key === 'copy') void navigator.clipboard.writeText(text).then(() => ToastQueue.positive(C.copied, { timeout: 3000 }));
      }}>
      {editable && ai ? (
        <MenuItem id="direct" textValue={reused === null ? C.directOne : C.directReused}>
          <AIMark />
          <Text slot="label">{reused === null ? C.directOne : C.directReused}</Text>
          <Text slot="description">{reused === null ? C.viaModel(modelName) : `${C.directReusedSub(reused || null)} · ${C.viaModel(modelName)}`}</Text>
        </MenuItem>
      ) : null}
      {editable && ai ? (
        <MenuItem id="agent" textValue={C.agentOne}>
          <Chat />
          <Text slot="label">{C.agentOne}</Text>
          <Text slot="description">{C.viaAgent}</Text>
        </MenuItem>
      ) : null}
      {editable && row.unit ? (
        <MenuItem id="mark" textValue={stale ? C.clearStale : C.markStale}>
          {stale ? <Checkmark /> : <Clock />}
          <Text slot="label">{stale ? C.clearStale : C.markStale}</Text>
        </MenuItem>
      ) : null}
      <MenuItem id="copy" textValue={C.copyTranslation}>
        <Copy />
        <Text slot="label">{C.copyTranslation}</Text>
      </MenuItem>
    </ActionMenu>
  );
}
