import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_AGENT_MODE, RpcError, type AgentMode, type DriverInfo, type Id, type VideoRef } from '@baocut/protocol';
import { ActionButton, Link, Picker, PickerItem, Radio, RadioGroup, Text, ToastQueue } from '@react-spectrum/s2';
import Code from '@react-spectrum/s2/icons/Code';
import InfoCircle from '@react-spectrum/s2/icons/InfoCircle';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { AGENT_PICKER, SKILL_COPY } from '../../copy.ts';
import { applyAgentChange, draftSelection, harnessLabel, type AgentChange, type AgentChoice } from '../../model/agent-choice.ts';
import { handoffHint, sessionOptions, TOOL_SKILL, toolDraftKey, type AgentToolId, type AiToolId, type SessionOption } from '../../model/ai-tools.ts';
import { currentConversation, messageCount } from '../../model/ai-tools-handoff.ts';
import { gateGuide, homeGate, type GateGuide } from '../../model/home-brief.ts';
import { targetKey } from '../../model/workspace.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { defaultDriver, useConnection } from '../../state/connection-store.ts';
import { useDirectory } from '../../state/directory-store.ts';
import type { AiToolRunner } from '../../state/ai-tool-runner-store.ts';
import { useSetting } from '../../state/settings-store.ts';
import { routeVideo, useShell } from '../../state/shell-store.ts';
import { useTimeline } from '../../state/timeline-store.ts';
import { useVideo } from '../../state/video-store.ts';
import { Composer } from '../composer.tsx';
import { ComposerToken, composerTokenList } from '../composer-token.tsx';
import { S } from '../shell-copy.ts';
import { useSkillsLoader } from '../use-skills.ts';
import { AgentGateLine } from './agent-gate-line.tsx';
import { contextItems, contextLine, directBlocked, directCta, directHint, type DirectContext } from './ai-tool-direct.ts';
import { attachAiToolSkill, detachAiToolSkill, restoreAiToolPrompt, setAiToolPrompt, useAiToolPrompts, useAiToolSkills } from './ai-tool-run.ts';
import { AI_TOOLS_COPY as C } from './ai-tools-copy.ts';
import { handToAgent, type Handoff } from './ai-tools-handoff.ts';

const row = style({ display: 'flex', alignItems: 'start', gap: 8 });
const rowLabel = style({ flexShrink: 0, width: 56, paddingTop: 4, font: 'ui-sm', color: 'gray-700' });
const rowBody = style({ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0 });
const hint = style({ margin: 0, font: 'ui-xs', color: 'gray-600', lineHeight: '[1.5]' });
const field = style({ width: 'full' });
const box = style({ display: 'flex', flexDirection: 'column', marginTop: 16 });
const boxHead = style({ display: 'flex', alignItems: 'center', gap: 8, minHeight: 24, marginBottom: 4 });
const boxTitle = style({ flexGrow: 1, font: 'detail', fontWeight: 'bold', color: 'gray-700' });
const notice = style({ display: 'flex', alignItems: 'start', gap: '[6px]', marginTop: 8, font: 'ui-xs', color: 'gray-700', lineHeight: '[1.5]' });
const noticeIcon = iconStyle({ size: 'S' });

/** 这个视频交给 Agent 时用到的一切：发到哪条会话、用哪个 Agent · 模型 · 强度与访问模式（参数页的「用」「会话」两行与提示词框共用一份）。 */
export interface ToolHandoff {
  ref: VideoRef | null;
  /** 没有可用的 Agent 时的指引（「用」一行与列表页顶上的卡）。 */
  guide: GateGuide | null;
  options: SessionOption[];
  /** 选中的那一项；视频不在任何项目或会话里时 null。 */
  session: SessionOption | null;
  setSession(key: SessionOption['key']): void;
  driver: DriverInfo | null;
  driverId: DriverInfo['id'] | null;
  model: string | null;
  effort: string | null;
  lockedTo: DriverInfo['id'] | null;
  onAgentChange(change: AgentChange): void;
  accessMode: AgentMode;
  onAccessModeChange(mode: AgentMode): void;
  /** 新会话：这页上选过的访问模式与 Agent · 模型 · 强度。 */
  create: { accessMode?: AgentMode; driverId?: DriverInfo['id']; model?: string | null; effort?: string | null };
}

/**
 * 参数页「交给智能体」的状态（产品设计 §5.10）：「会话」缺省新会话，这个视频有说过话的会话时多一项「接着」，写明已有几条消息；
 * 新会话的 Agent 与访问模式是这页上自己的选择（同悬浮会话的草稿，但不持久化），接着一条会话时就是那条会话的，改了直接改那条会话。
 */
export function useToolHandoff(): ToolHandoff {
  const runtime = useRuntime();
  const ref = useVideo((s) => s.video?.ref ?? null);
  const source = ref?.source ?? null;
  const drivers = useConnection((s) => s.drivers);
  const checking = useConnection((s) => s.checking);
  const guide = gateGuide(homeGate(drivers, checking));
  const conversations = useDirectory((s) => s.conversations);
  // 「当前」：Home 左侧的会话，或 Space 里这个视频的悬浮会话最近发起的那条。
  const current = useShell((s) => {
    if (s.route.tab === 'home') return s.route.conversationId;
    const shown = routeVideo(s.route);
    return s.route.tab === 'space' && shown ? (s.videoChats[targetKey(shown)] ?? null) : null;
  });
  const candidate = useMemo(() => currentConversation({ source, current, conversations }), [source, current, conversations]);
  const candidateId = candidate?.id ?? null;
  // 消息数要读会话的时间线：盯着它（引用计数，会话页也在盯时共用一份）。
  useEffect(() => (candidateId ? runtime.watchConversation(candidateId) : undefined), [runtime, candidateId]);
  const items = useTimeline((s) => (candidateId ? s.byConversationId[candidateId]?.items : undefined));
  const messages = items ? messageCount(items) : null;
  const locked = !!items?.some((i) => i.kind === 'task');
  const { options, fallback } = sessionOptions({
    canCreate: !!source?.projectId,
    current: candidate ? { id: candidate.id, title: candidate.title, messages } : null,
  });
  const [picked, setPicked] = useState<SessionOption['key'] | null>(null);
  const session = options.find((o) => o.key === picked) ?? options.find((o) => o.key === fallback) ?? null;
  const onCurrent = session?.key === 'current' && candidate ? candidate : null;

  // 新会话：这页上的选择；没选过的跟设置里的默认。
  const [choice, setChoice] = useState<AgentChoice | undefined>(undefined);
  const [mode, setMode] = useState<AgentMode | null>(null);
  const defaultMode = useSetting('agent.defaultAccessMode') ?? DEFAULT_AGENT_MODE;
  const fresh =
    choice?.driverId && checking.includes(choice.driverId)
      ? null
      : (drivers?.find((d) => d.id === choice?.driverId) ?? defaultDriver(drivers, checking));
  const freshSelection = draftSelection(fresh, choice);

  const driver = onCurrent ? (drivers?.find((d) => d.id === onCurrent.driverId) ?? null) : fresh;
  const update = (id: Id, patch: Parameters<typeof runtime.updateConversation>[1], failed: (message: string) => string) =>
    void runtime.updateConversation(id, patch).catch((error: Error) => {
      const message = error instanceof RpcError && error.code === 'conflict' ? AGENT_PICKER.locked : failed(error.message);
      ToastQueue.negative(message, { timeout: 5000 });
    });
  return {
    ref,
    guide,
    options,
    session,
    setSession: setPicked,
    driver,
    driverId: onCurrent ? onCurrent.driverId : (fresh?.id ?? choice?.driverId ?? null),
    model: onCurrent ? onCurrent.model : freshSelection.model,
    effort: onCurrent ? onCurrent.effort : freshSelection.effort,
    lockedTo: onCurrent && locked ? onCurrent.driverId : null,
    onAgentChange: (change) =>
      onCurrent ? update(onCurrent.id, change, S.conversationView.switchFailed) : setChoice((c) => applyAgentChange(c, fresh?.id ?? null, change)),
    accessMode: onCurrent ? (onCurrent.accessMode ?? defaultMode) : (mode ?? defaultMode),
    onAccessModeChange: (next) => (onCurrent ? update(onCurrent.id, { accessMode: next }, S.conversationView.accessModeFailed) : setMode(next)),
    create: {
      ...(mode ? { accessMode: mode } : {}),
      ...(choice?.driverId ? { driverId: choice.driverId } : {}),
      ...(choice && 'model' in choice ? { model: choice.model ?? null } : {}),
      ...(choice && 'effort' in choice ? { effort: choice.effort ?? null } : {}),
    },
  };
}

/**
 * 参数页的「用」一行：交给 Agent（写着家 · 模型，与提示词框底栏的 chip 是同一份），或直接调模型（写着哪只文本模型）。
 * 直接调模型做不了的工具那一项置灰、下面写原因；交给 Agent 而没有可用的 Agent 时给去处。
 */
export function AgentUseRow({
  handoff,
  tool,
  runner = 'agent',
  onRunner,
  modelName = null,
}: {
  handoff: ToolHandoff;
  tool: AgentToolId;
  runner?: AiToolRunner;
  onRunner?(runner: AiToolRunner): void;
  modelName?: string | null;
}) {
  const blocked = directBlocked(tool);
  return (
    <div className={row}>
      <span className={rowLabel}>{C.who}</span>
      <div className={rowBody}>
        <RadioGroup aria-label={C.who} size="S" value={runner} onChange={(value) => onRunner?.(value as AiToolRunner)}>
          <Radio value="agent">
            {C.whoAgent} · {harnessLabel(handoff.driver, handoff.model)}
          </Radio>
          <Radio value="model" isDisabled={!!blocked || !onRunner}>
            {runner === 'model' && modelName ? `${C.whoModel} · ${modelName}` : C.whoModel}
          </Radio>
        </RadioGroup>
        {blocked ? <p className={hint}>{blocked}</p> : null}
        {runner === 'model' && tool === 'polish' ? <p className={hint}>{C.modelPolishNote}</p> : null}
        {runner === 'agent' && handoff.guide ? <AgentGateLine guide={handoff.guide} /> : null}
      </div>
    </div>
  );
}

/** 「会话」一行：新会话（缺省）或接着这个视频当前的会话，每项下面一句说清代价。 */
export function SessionRow({ handoff }: { handoff: ToolHandoff }) {
  if (!handoff.session) return null;
  return (
    <div className={row}>
      <span className={rowLabel}>{C.session}</span>
      <div className={rowBody}>
        <Picker
          aria-label={C.session}
          size="S"
          styles={field}
          selectedKey={handoff.session.key}
          onSelectionChange={(key) => key && handoff.setSession(key as SessionOption['key'])}>
          {handoff.options.map((o) => (
            <PickerItem key={o.key} id={o.key} textValue={o.label}>
              <Text slot="label">{o.label}</Text>
              <Text slot="description">{o.sub}</Text>
            </PickerItem>
          ))}
        </Picker>
      </div>
    </div>
  );
}

/** 直接调模型时提示词框要的东西（工具页持有模型与运行，见 ai-tools-agent-page.tsx）。 */
export interface DirectPrompt {
  context: Omit<DirectContext, 'attachments' | 'skills'>;
  model: { name: string | null; local: boolean; ready: boolean };
  /** 底栏右边的文本模型选择。 */
  picker: ReactNode;
  /** 选中的模型不能用时框下的门卡。 */
  gate: ReactNode;
  /** 模型不能用时按下主按钮：说清差什么、把门卡带到眼前；不灰掉按钮。 */
  onNotReady(): void;
  onStart(prompt: string, attachments: Id[], skills: string[]): Promise<boolean>;
}

/**
 * 参数页的提示词框与主按钮（原型 tool-prompt.jsx，产品设计 §5.10 第 3、4 段）：预填模板（没改过就跟着范围与勾选项变，
 * 改过才出「恢复默认」），默认挂着这个工具的内置 skill（标着「这个工具的做法」，摘掉后框下一行说明并给加回），
 * 「+ › 使用 Skill」再挂别的（接在后面，已经挂着的不重复，加回内置的也接在后面，同原型 `addSkill`），每个可以单独摘掉；
 * 底栏是访问模式与「家 · 模型」（与「用」一行同一份）。按下就按「会话」行交出去，挂着的 skill 按顺序一起发（`conversations.send`
 * 的 `skills`），`onDone` 回列表；给了 `onHandedOff` 的（找可剪的口、刷新过期译文）不切到会话，交给它在原地画进度。
 * 「用」选了直接调模型（`direct`）时：底栏换成文本模型的选择，框下写挂着的 skill 作系统提示词、发给模型的上下文，主按钮写
 * 这个工具的动作，下面一行说调哪只模型、结果去哪、花不花钱；按下去由工具页提交 `ai-tool` 流程，留在原地看进度与结果。
 */
export function AiToolPrompt({
  videoId,
  tool,
  template,
  handoff,
  isDisabled,
  onDone,
  onHandedOff,
  direct,
}: {
  videoId: Id;
  tool: AiToolId;
  template: string;
  handoff: ToolHandoff;
  isDisabled?: boolean;
  onDone(): void;
  /** 留在原地（`agentStaysOnPage`）：交出去后不切到会话、不回列表，由工具页画进度卡。话没发出去（放进了会话的输入框）时照常 `onDone`。 */
  onHandedOff?(handoff: Handoff): void;
  /** 「用」选了直接调模型：底栏换成文本模型的选择，框下多两行（skill 作系统提示词、发给模型的），按下去走 `ai-tool` 流程。 */
  direct?: DirectPrompt | null;
}) {
  const runtime = useRuntime();
  const draftKey = toolDraftKey(videoId, tool);
  // 改过的提示词不放组件状态：运行态、结果与收据页会换掉这个框，回列表也会，「完成」或回来时还要在（ai-tool-run.ts）。
  const edited = useAiToolPrompts((s) => s.prompts[draftKey]);
  const builtin = TOOL_SKILL[tool] ?? null;
  // 挂着的 skill 同理：摘掉的内置 skill、后挂上的都要在「完成」或回来时还在；没存过就是这个工具的内置 skill。
  const defaultSkills = useMemo(() => (builtin ? [builtin] : []), [builtin]);
  const skillIds = useAiToolSkills((s) => s.skills[draftKey]) ?? defaultSkills;
  const attachSkill = (id: string) => attachAiToolSkill(draftKey, id, defaultSkills);
  const catalog = useSkillsLoader();
  const nameOf = (id: string) => catalog.skills.find((s) => s.id === id)?.name ?? id;
  const session = handoff.session;
  const text = edited ?? template;

  const tokens = skillIds.length ? (
    <div className={composerTokenList}>
      {skillIds.map((id) => (
        <ComposerToken
          key={id}
          icon={<Code />}
          label={SKILL_COPY.token(nameOf(id))}
          {...(id === builtin ? { note: C.skillNote } : {})}
          removeLabel={SKILL_COPY.remove(nameOf(id))}
          onRemove={() => detachAiToolSkill(draftKey, id, defaultSkills)}
        />
      ))}
    </div>
  ) : null;
  const noSkill = builtin && !skillIds.includes(builtin) ? (
    <p className={notice}>
      <InfoCircle styles={noticeIcon} />
      <span>
        {C.noSkill}{' '}
        <Link variant="secondary" onPress={() => attachSkill(builtin)}>
          {C.addSkillBack}
        </Link>
      </span>
    </p>
  ) : null;
  // 直接调模型：挂着 skill 时说清它们怎么发；再一行写发给模型的上下文（附件数由输入框给）。
  const skillsNotice =
    direct && skillIds.length ? (
      <p className={notice}>
        <InfoCircle styles={noticeIcon} />
        <span>{C.skillsAsSystem}</span>
      </p>
    ) : null;
  const contextNotice = direct
    ? ({ count, images }: { count: number; images: number }) => (
        <p className={notice}>
          <InfoCircle styles={noticeIcon} />
          <span>
            {contextLine(contextItems({ ...direct.context, attachments: count, skills: skillIds.map(nameOf) }))}
            {images ? C.contextImages(images) : ''}
          </span>
        </p>
      )
    : undefined;

  return (
    <div className={box}>
      <div className={boxHead}>
        <span className={boxTitle}>{direct ? C.modelPromptLabel : C.promptLabel}</span>
        {edited !== undefined ? (
          <ActionButton isQuiet size="XS" onPress={() => restoreAiToolPrompt(draftKey)}>
            {C.restoreDefault}
          </ActionButton>
        ) : null}
      </div>
      <Composer
        draftKey={draftKey}
        // 直接调模型不经过 Agent：不按 Agent 的状态拦发送，也不出 Agent 选择。
        driverId={direct ? null : handoff.driverId}
        model={handoff.model}
        effort={handoff.effort}
        lockedTo={handoff.lockedTo}
        onAgentChange={handoff.onAgentChange}
        accessMode={handoff.accessMode}
        onAccessModeChange={handoff.onAccessModeChange}
        busy={false}
        placeholder={C.promptPlaceholder}
        mentionScope={{ projectId: handoff.ref?.source?.projectId ?? null, conversationId: handoff.ref?.source?.conversationId ?? null }}
        onSend={async () => false}
        tool={
          direct
            ? {
                text,
                onText: (next) => setAiToolPrompt(draftKey, next, template),
                tokens,
                onSkill: attachSkill,
                notice: (
                  <>
                    {noSkill}
                    {skillsNotice}
                    {direct.gate}
                  </>
                ),
                picker: direct.picker,
                context: contextNotice,
                cta: directCta(direct.context.tool),
                hint: directHint({ tool: direct.context.tool, model: direct.model.name, local: direct.model.local }),
                isDisabled: isDisabled || !handoff.ref,
                onStart: async (message, attachments) => {
                  if (!direct.model.ready) {
                    direct.onNotReady();
                    return false;
                  }
                  return direct.onStart(
                    message,
                    attachments.map((a) => a.id),
                    skillIds,
                  );
                },
              }
            : {
                text,
                onText: (next) => setAiToolPrompt(draftKey, next, template),
                tokens,
                onSkill: attachSkill,
                notice: noSkill,
                cta: C.cta,
                hint: handoffHint(session?.key ?? 'new'),
                isDisabled: isDisabled || !session || !!handoff.guide || !handoff.ref,
                onStart: (message, attachments) =>
                  handToAgent(runtime, {
                    video: handoff.ref,
                    session: session?.key === 'current' && session.conversationId ? { id: session.conversationId } : 'new',
                    text: message,
                    attachments,
                    skills: skillIds.map((id) => ({ id })),
                    create: handoff.create,
                    draftKey,
                    stay: !!onHandedOff,
                  }).then((result) => {
                    if (result && onHandedOff && !result.drafted) onHandedOff(result);
                    else if (result) onDone();
                    return !!result;
                  }),
              }
        }
      />
    </div>
  );
}
