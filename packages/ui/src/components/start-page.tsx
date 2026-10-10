import { useRef, useState } from 'react';
import { DEFAULT_AGENT_MODE, type Id } from '@baocut/protocol';
import { ToastQueue } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { S } from './shell-copy.ts';
import { HOME_COPY } from '../copy.ts';
import { applyAgentChange, draftSelection } from '../model/agent-choice.ts';
import { sendFailureMessage } from '../model/agent-skills.ts';
import {
  addMaterials,
  canStartHome,
  EMPTY_HOME_BRIEF,
  gateGuide,
  homeBrief,
  homeGate,
  MAX_HOME_MATERIALS,
  pickTemplate,
  type HomeBriefState,
} from '../model/home-brief.ts';
import { starterTarget, type HomeStarter } from '../model/home-starters.ts';
import { templateOf, type HomeTemplate } from '../model/home-templates.ts';
import { slotLabels } from '../model/prompt-slots.ts';
import { recentVideos, videoTargetOf } from '../model/space.ts';
import { workspaceKey } from '../model/workspace.ts';
import { setDefaultAccessMode } from '../runtime/agent-commands.ts';
import { useRuntime } from '../runtime/context.tsx';
import { templatePrompt } from '../runtime/template-commands.ts';
import { defaultDriver, useConnection } from '../state/connection-store.ts';
import { useDirectory, useProject } from '../state/directory-store.ts';
import { useDraftImages } from '../state/draft-images-store.ts';
import { useDraftSkillIds, useDraftSkills } from '../state/draft-skills-store.ts';
import { useSetting } from '../state/settings-store.ts';
import { useHomeMemory } from '../state/home-memory-store.ts';
import { useHomeTemplates } from '../state/home-templates-store.ts';
import { useTemplateCatalog } from '../state/template-catalog-store.ts';
import { useShell } from '../state/shell-store.ts';
import { useSkills } from '../state/skills-store.ts';
import { useSpace } from '../state/space-store.ts';
import { useStartBrief, useStartBriefOf } from '../state/start-brief-store.ts';
import { useVideo } from '../state/video-store.ts';
import { Composer } from './composer.tsx';
import { LegacyImportBanner } from './legacy-import/legacy-import-task.tsx';
import { createBlankVideo } from './start/blank-video.ts';
import { BriefTokens } from './start/brief-tokens.tsx';
import { GateCard } from './start/gate-card.tsx';
import { HomeStarters } from './start/home-starters.tsx';
import { HomeTemplateShelf } from './start/home-template-shelf.tsx';
import { startDraftKey } from './start/open-home.ts';
import { ProjectPicker } from './start/project-picker.tsx';
import { SlotHint } from './start/slot-hint.tsx';
import { useTemplateCatalogLoader } from './start/use-templates.ts';
import { useEditorReference } from './use-editor-reference.ts';
import { focusPromptEnd } from './use-prompt-value.ts';
import { useNarrow } from './use-narrow.ts';

// 标题和输入框是这一页唯一的主角：一栏最宽 760，内容不满一屏时整块在视口里居中（上下 auto），模板网格超出一屏时照常滚动。
const page = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, overflowY: 'auto' });
const column = style({
  width: 'full',
  maxWidth: 760,
  marginX: 'auto',
  marginY: 'auto',
  paddingX: { default: 24, isNarrow: 12 },
  paddingTop: 32,
  paddingBottom: 48,
  boxSizing: 'border-box',
});
const title = style({
  margin: 0,
  marginBottom: 24,
  fontSize: '[28px]',
  fontWeight: 'bold',
  lineHeight: '[1.3]',
  color: 'gray-900',
  textAlign: 'center',
});

/** 「PDF 或文档」能选的文件（原型 `MaterialPlus` 的 accept）。 */

/**
 * 新会话的起始页（产品设计 §3.2.1，原型 page-new.jsx 的 Home）：一句标题、居中的输入框（带素材）、
 * 项目行、Agent 用不了时的指引卡，下面是「快捷开始」一行（点一下把一句提示词放进输入框，行尾新建空白视频）和模板网格。
 * 没有表单，工具从左侧导航进。第一句话发出时才真正建会话，侧栏里点十次「新建会话」不会长出十条空会话。
 */
export function StartPage({ projectId: routeProjectId }: { projectId: string | null }) {
  const runtime = useRuntime();
  const projects = useDirectory((s) => s.projects);
  const pickable = projects.filter((p) => !p.archived).sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
  // 旁边的编辑器开着项目里的视频时，新会话建在那个项目里，智能体才能读写这个视频（§1.5）。
  const videoProjectId = useVideo((s) => s.video?.ref?.source.projectId ?? null);
  // 路由没带项目时用托盘上次选的（记在这台电脑上，还在、没归档才算；产品设计 §3.2.1），否则不用项目。
  const lastProject = useHomeMemory((s) => s.project);
  const remembered = lastProject && pickable.some((p) => p.id === lastProject) ? lastProject : null;
  const projectId = routeProjectId ?? videoProjectId ?? remembered;
  const project = useProject(projectId);
  // 「转录并翻译」上次填的目标语言：快捷开始沿用它，没有时那句话留待填项。
  const lastTarget = useHomeMemory((s) => s.target);
  const go = useShell((s) => s.go);
  const draftKey = startDraftKey(routeProjectId);
  // 新会话的访问模式：草稿上选过的，否则设置里的默认（`agent.defaultAccessMode`，记着上次在这里选的）。
  const draftMode = useShell((s) => s.draftAccessModes[draftKey]);
  const defaultMode = useSetting('agent.defaultAccessMode');
  const accessMode = draftMode ?? defaultMode ?? DEFAULT_AGENT_MODE;
  // Agent · 模型 · 强度：草稿上选过的，否则默认 Agent 和它在偏好里的默认模型与强度。
  const choice = useShell((s) => s.draftAgents[draftKey]);
  const drivers = useConnection((s) => s.drivers);
  const checking = useConnection((s) => s.checking);
  // 草稿上选的 Agent 还在首次探测时显示「正在检测」，不退回默认的那个（发送时照旧带草稿上的选择）。
  const driver =
    choice?.driverId && checking.includes(choice.driverId)
      ? null
      : (drivers?.find((d) => d.id === choice?.driverId) ?? defaultDriver(drivers, checking));
  const driverId = driver?.id ?? null;
  const { model, effort } = draftSelection(driver, choice);
  const editor = useEditorReference({ conversationId: null, projectId });
  const brief = useStartBriefOf(draftKey);
  // 输入框里还没填的待填项（模板包规范 §5.5）：框下面的提示行列出它们。
  const slots = slotLabels(useShell((s) => s.drafts[draftKey] ?? ''));
  // 每加一，输入框选中下一处待填项（Composer `start.selectSlot`）。
  const [slotTick, setSlotTick] = useState(0);
  // 模板目录：起始页挂上时取一次（弹窗打开、重新连上时也会再取）。
  const catalog = useTemplateCatalogLoader();
  const template = templateOf(catalog.templates, brief.template);
  const shelf = useHomeTemplates((s) => s.recent);
  // 「+ › 使用 Skill」点选的那几个：标记和模板排在一行（列表由输入框取）。
  const skillIds = useDraftSkillIds(draftKey);
  const skillCatalog = useSkills((s) => s.skills);
  const pickedSkills = skillIds.map((id) => ({ id, name: skillCatalog.find((k) => k.id === id)?.name ?? id }));
  // 「+ › 最近的视频」：还能选的项目里最近活动的视频。
  const spaceEntries = useSpace((s) => s.entries);
  const recent = recentVideos(
    spaceEntries,
    pickable.map((p) => p.id),
  );
  // 还在检测 Agent 时不下结论，不闪指引卡。
  const gate = homeGate(drivers, checking);
  const guide = gateGuide(gate);
  // 量外层页面而不是那一栏：栏的左右留白随窄不窄变，量它会来回翻转。
  const pageRef = useRef<HTMLDivElement>(null);
  const narrow = useNarrow(pageRef, 760);

  const patch = (next: Partial<HomeBriefState>) => useStartBrief.getState().patch(draftKey, next);
  const currentBrief = () => useStartBrief.getState().briefs[draftKey] ?? EMPTY_HOME_BRIEF;

  // 弹窗关上时 S2 会把焦点还给打开它的按钮：等它还完再把焦点放回输入框（同输入框自己的 refocus）。
  // 草稿里有待填项时选中第一处（规范 §5.5），否则光标放到末尾。
  const focusComposer = () =>
    window.setTimeout(() => {
      if (slotLabels(useShell.getState().drafts[draftKey] ?? '').length) setSlotTick((n) => n + 1);
      else focusPromptEnd(document.querySelector(`[data-composer="${CSS.escape(draftKey)}"]`));
    }, 400);

  // 往输入框里填一句提示词（快捷开始、作品示例、场景模板共用；原型 page-new.jsx `fillPrompt`）：框里原来有字时直接替换，不先问，给一次撤销；
  // 填完焦点回到输入框（有待填项时选中第一处，否则光标在末尾）。`undo` 是撤销时除了文字还要还原的东西。
  const fillPrompt = (next: string, undo?: () => void) => {
    const shell = useShell.getState();
    const before = shell.drafts[draftKey] ?? '';
    shell.setDraft(draftKey, next);
    focusComposer();
    if (!before.trim() || before === next) return;
    ToastQueue.neutral(HOME_COPY.promptPlaced, {
      timeout: 6000,
      actionLabel: HOME_COPY.undo,
      shouldCloseOnAction: true,
      onAction: () => {
        useShell.getState().setDraft(draftKey, before);
        undo?.();
        focusComposer();
      },
    });
  };

  // 场景模板（模板包规范 §5.2、§5.5；原型 page-new.jsx `pickScene`）：挂在输入框上，记进模板网格
  // （最近用过的在前），并把 brief 填进输入框（带待填项，换选另一个模板就换掉文字）；已经挂着的再选一次不重填。
  // 摘掉模板（再点一次同一张卡、点标记的 ×）只摘模板，不动文字。撤销把文字与模板一起还原（同 applyExample）。
  const pickScene = (picked: HomeTemplate | null) => {
    const before = currentBrief();
    if (picked) useHomeTemplates.getState().pick(picked.id, useTemplateCatalog.getState().templates);
    patch(pickTemplate(before, picked));
    if (!picked?.brief || picked.id === before.template) return;
    fillPrompt(picked.brief, () => patch({ template: before.template }));
  };

  // 快捷开始：只换输入框里的字，模板与素材都不动；不发送。
  const applyStarter = (starter: HomeStarter) => fillPrompt(starter.prompt);

  // 作品示例（规范 §5.1；原型 page-new.jsx `applyExample`）：提示词全文替换输入框里的话（之后就是用户自己的话），摘掉挂着的场景模板。
  // 撤销把文字与模板一起还原。
  const applyExample = async (example: HomeTemplate) => {
    let text: string;
    try {
      text = await templatePrompt(runtime, example.id, example.version, example.language);
    } catch (error) {
      ToastQueue.negative(HOME_COPY.templatePromptFailed((error as Error).message), { timeout: 5000 });
      return;
    }
    const before = currentBrief();
    patch({ template: null });
    useHomeTemplates.getState().pick(example.id, useTemplateCatalog.getState().templates);
    fillPrompt(text, () => patch({ template: before.template }));
  };

  // 新建空白视频（原型 `createBlank`）：16:9，建在这一页的项目里（没选项目时先建一个：没有会话，视频没有别处可放）。
  const createBlank = () => void createBlankVideo(runtime, projectId, '16:9');

  // 选文件是异步的：并进去时按 store 里最新的那份算，不用渲染时的快照。
  const addPaths = (paths: readonly string[]) => {
    if (!paths.length) return;
    const current = useStartBrief.getState().briefs[draftKey] ?? EMPTY_HOME_BRIEF;
    const { list, rejected } = addMaterials(current.materials, paths);
    patch({ materials: list });
    if (rejected) ToastQueue.neutral(HOME_COPY.materialsFull(MAX_HOME_MATERIALS, rejected), { timeout: 5000 });
  };

  // 换项目：起始页按项目重新挂载，输入框的话、附图、点选的 skill、模板与素材、访问模式与 Agent 选择一起搬过去；
  // 编辑器开着的话，功能区的标签也跟到那个项目的起始页。
  const moveDraft = (id: Id | null) => {
    const to = startDraftKey(id);
    const shell = useShell.getState();
    const text = shell.drafts[draftKey];
    if (text) {
      shell.setDraft(to, text);
      shell.setDraft(draftKey, '');
    }
    useDraftImages.getState().move(draftKey, to);
    useDraftSkills.getState().move(draftKey, to);
    useStartBrief.getState().move(draftKey, to);
    const mode = shell.draftAccessModes[draftKey];
    if (mode) {
      shell.setDraftAccessMode(to, mode);
      shell.setDraftAccessMode(draftKey, null);
    }
    const agent = shell.draftAgents[draftKey];
    if (agent) {
      shell.setDraftAgent(to, agent);
      shell.setDraftAgent(draftKey, null);
    }
    const { route } = useShell.getState();
    if (route.tab === 'home') shell.carryWorkspace(workspaceKey(route.conversationId, route.projectId), workspaceKey(null, id));
  };

  // 托盘上选的项目（null = 不用项目）记下来，下次进起始页还是它；别处带着项目来（侧栏「在这里新建会话」等）不记。
  const switchProject = (id: Id | null) => {
    useHomeMemory.getState().setProject(id);
    if (id === routeProjectId) return;
    const { route } = useShell.getState();
    const pane = route.tab === 'home' ? route.pane : undefined;
    moveDraft(id);
    go({ tab: 'home', conversationId: null, projectId: id, ...(pane ? { pane } : {}) });
  };

  // 「+ › 最近的视频」（原型 page-new.jsx `pickRecent`）：起始页换到那个视频的项目，并在功能区打开它——会话建在那个项目里，
  // 输入框上方出现这个视频的引用标签，智能体就能读写它。这句话只对一条视频说：已经挂着的视频或音频素材让出位置，给一次撤销。
  const pickRecent = (entryId: string) => {
    const entry = useSpace.getState().entries.find((e) => e.id === entryId);
    const to = entry?.source.projectId;
    if (!entry || !to) return;
    const materials = currentBrief().materials;
    const media = materials.filter((m) => m.kind === 'media');
    if (to !== routeProjectId) moveDraft(to);
    const toKey = startDraftKey(to);
    if (media.length) useStartBrief.getState().patch(toKey, { materials: materials.filter((m) => m.kind !== 'media') });
    useShell.getState().openVideo(videoTargetOf(entry), { conversationId: null, projectId: to });
    if (!media.length) return;
    ToastQueue.neutral(HOME_COPY.recentReplaced(entry.name, S.list(media.map((m) => m.name))), {
      timeout: 6000,
      actionLabel: HOME_COPY.undo,
      shouldCloseOnAction: true,
      onAction: () => {
        const now = useStartBrief.getState().briefs[toKey] ?? EMPTY_HOME_BRIEF;
        const restored = addMaterials(
          now.materials,
          media.map((m) => m.path),
        ).list;
        useStartBrief.getState().patch(toKey, { materials: restored });
      },
    });
  };

  return (
    <div ref={pageRef} className={page}>
      <div className={column({ isNarrow: narrow })}>
        {/* 旧版项目导入在跑 / 留了没导入的（只在桌面端有导入）。 */}
        <LegacyImportBanner />
        <h1 className={title}>{HOME_COPY.title}</h1>
        <Composer
          draftKey={draftKey}
          driverId={driverId}
          model={model}
          effort={effort}
          lockedTo={null}
          onAgentChange={(change) => useShell.getState().setDraftAgent(draftKey, applyAgentChange(choice, driverId, change))}
          accessMode={accessMode}
          onAccessModeChange={(mode) => useShell.getState().setDraftAccessMode(draftKey, mode)}
          busy={false}
          autoFocus
          reference={editor.reference}
          placeholder={brief.template ? HOME_COPY.templatePlaceholder : HOME_COPY.placeholder}
          mentionScope={{ projectId, conversationId: null }}
          start={{
            tokens: (
              <BriefTokens
                skills={pickedSkills}
                onRemoveSkill={(id) => useDraftSkills.getState().remove(draftKey, id)}
                template={template}
                materials={brief.materials}
                onRemoveTemplate={() => pickScene(null)}
                onRemoveMaterial={(path) => patch({ materials: brief.materials.filter((m) => m.path !== path) })}
              />
            ),
            ready: gate === null || gate.ok,
            selectSlot: slotTick,
            // 只选了模板、没写一句话不能发；附了图片或素材可以（Agent 用不了时输入框自己挡住）。
            canSendEmpty: (images) => canStartHome({ text: '', images, materials: brief.materials.length, gate: null }).ok,
            onPaths: addPaths,
            recent: {
              items: recent.map((entry) => ({
                id: entry.id,
                label: entry.name,
                description: projects.find((p) => p.id === entry.source.projectId)?.name ?? entry.relPath,
              })),
              onPick: pickRecent,
            },
          }}
          onSend={async (raw, attachments, skills) => {
            // 素材在发出去时写进这条消息（原型 `AgentHero` 的 brief），没填的待填项写成「[label]」（规范 §5.5，homeBrief）；挂着的场景模板与点选的 skill 只传标识，
            // 简报引导、模板正文与 SKILL.md 由 Runtime 拼给智能体（模板包规范 §5.2、产品设计 §6.9），
            // 会话里的消息另带「模板：标题」「Skill：名称」的标记。
            const sceneRef = brief.template
              ? { id: brief.template, ...(template ? { version: template.version, language: template.language } : {}) }
              : undefined;
            // 「转录并翻译」填的目标语言记下来，下次点这条快捷开始直接沿用（认不出那句话就不记）。
            const target = starterTarget(raw);
            if (target) useHomeMemory.getState().setTarget(target);
            const text = homeBrief(raw, {
              images: attachments.length,
              materials: brief.materials.map((m) => m.path),
            });
            let conversationId: string | null = null;
            try {
              // 只传草稿上选过的；没选的由 Runtime 按偏好给（默认 Agent、它的默认模型与强度）。
              // 没选过的不传，会话跟着设置走；选过的同时记成新会话的默认（原型「全局种子」）。
              const conversation = await runtime.createConversation(projectId, {
                ...(draftMode ? { accessMode: draftMode } : {}),
                ...(choice?.driverId ? { driverId: choice.driverId } : {}),
                ...(choice && 'model' in choice ? { model: choice.model ?? null } : {}),
                ...(choice && 'effort' in choice ? { effort: choice.effort ?? null } : {}),
              });
              conversationId = conversation.id;
              if (draftMode && draftMode !== defaultMode) void setDefaultAccessMode(runtime, draftMode).catch(() => {});
              useShell.getState().setDraftAccessMode(draftKey, null);
              useShell.getState().setDraftAgent(draftKey, null);
              useStartBrief.getState().clear(draftKey);
              const context = await editor.capture();
              // 编辑器开着的话保持打开：会话换成刚建的这个。
              const { route } = useShell.getState();
              const pane = route.tab === 'home' ? route.pane : undefined;
              if (route.tab === 'home') useShell.getState().carryWorkspace(workspaceKey(route.conversationId, route.projectId), conversation.id);
              go({ tab: 'home', conversationId: conversation.id, projectId: null, ...(pane ? { pane } : {}) });
              await runtime.send(
                conversation.id,
                text,
                context,
                attachments.map((a) => a.id),
                sceneRef,
                skills,
              );
              editor.reset();
              return true;
            } catch (error) {
              ToastQueue.negative(sendFailureMessage(error), { timeout: 5000 });
              // 会话已经建好：把整段话（含设置与素材）、图片与点选的 skill 放回那个会话的输入框，不吞掉用户的输入。
              // 场景模板挂不到会话的输入框上（那里没有模板），这一次的模板随之丢掉。
              if (conversationId) {
                useShell.getState().setDraft(conversationId, text);
                useDraftImages.getState().move(draftKey, conversationId);
                useDraftSkills.getState().move(draftKey, conversationId);
                return true;
              }
              // 会话没建成：输入框放回原话，模板、设置与素材还留在起始页上。
              return false;
            }
          }}
        />
        <ProjectPicker
          project={project ?? null}
          projects={pickable}
          noneDisabled={!!videoProjectId}
          onSelect={switchProject}
        />
        <SlotHint labels={gate === null || gate.ok ? slots : []} onNext={() => setSlotTick((n) => n + 1)} />
        {guide ? <GateCard guide={guide} /> : null}
        <HomeStarters target={lastTarget} narrow={narrow} onPick={applyStarter} onBlank={createBlank} />
        <HomeTemplateShelf
          catalog={catalog.templates}
          scene={brief.template}
          shelf={shelf}
          narrow={narrow}
          onScene={pickScene}
          onExample={(example) => void applyExample(example)}
        />
      </div>
    </div>
  );
}
