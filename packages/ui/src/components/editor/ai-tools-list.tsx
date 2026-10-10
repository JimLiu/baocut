import { useMemo, type ComponentType } from 'react';
import type { AiToolKind, DocumentRecord, Id, Sequence } from '@baocut/protocol';
import { Badge, Button, Link } from '@react-spectrum/s2';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import Comment from '@react-spectrum/s2/icons/Comment';
import Cut from '@react-spectrum/s2/icons/Cut';
import Edit from '@react-spectrum/s2/icons/Edit';
import FileText from '@react-spectrum/s2/icons/FileText';
import Image from '@react-spectrum/s2/icons/Image';
import ListBulleted from '@react-spectrum/s2/icons/ListBulleted';
import Refresh from '@react-spectrum/s2/icons/Refresh';
import Settings from '@react-spectrum/s2/icons/Settings';
import TextIcon from '@react-spectrum/s2/icons/Text';
import TextParagraph from '@react-spectrum/s2/icons/TextParagraph';
import UserGroup from '@react-spectrum/s2/icons/UserGroup';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton } from 'react-aria-components';
import { AI_TOOL_GROUP_LABEL, AI_TOOLS, groupSub, laterNote, LIST_GROUPS, toolDraftKey, type AiToolId } from '../../model/ai-tools.ts';
import { chapterPieces } from '../../model/export-range.ts';
import { useConnection, defaultDriver } from '../../state/connection-store.ts';
import { useDirectory } from '../../state/directory-store.ts';
import { useEditor } from '../../state/editor-store.ts';
import { routeVideo, useShell } from '../../state/shell-store.ts';
import { useVideo } from '../../state/video-store.ts';
import { useGateFix } from '../start/gate-card.tsx';
import { AI_TOOLS_COPY as C } from './ai-tools-copy.ts';
import { openAiTool, useAiToolAgentRuns } from './ai-tools-nav.ts';
import { ELEMENTS_COPY as EL } from './elements-copy.ts';
import { gateGuide, homeGate, type GateGuide } from '../../model/home-brief.ts';
import { PanelHead } from './panel-head.tsx';
import { useShallow } from 'zustand/react/shallow';
import { useSpeakersRun } from './speakers-run.ts';
import { useAiToolRun } from './ai-tool-run.ts';
import { aiToolJobFacts, aiToolRowState, EDITORIAL_PROPOSAL_KIND, pendingCutCount, type AiToolRowState } from '../../model/ai-tool-row-state.ts';
import { agoLabel } from '../../model/format.ts';
import { isStale, pairRows, readTranslation, speechSentences } from '../../model/translation-doc.ts';
import { useJobs } from '../../state/jobs-store.ts';
import { useNow } from '../use-now.ts';
import { useDocumentBodies } from './use-document-body.ts';

const body = style({ flexGrow: 1, minHeight: 0, overflowY: 'auto', paddingX: 12, paddingTop: 12, paddingBottom: 16 });
/** 顶上那张卡与列表的行（原型 .atagent、.drill.ail__row）：左图标、两行字、右边状态与箭头，整行可点。 */
const tile = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  width: 'full',
  boxSizing: 'border-box',
  paddingX: 12,
  paddingY: 8,
  borderRadius: 'lg',
  borderWidth: 0,
  textAlign: 'start',
  font: 'ui-sm',
  color: { default: 'gray-800', isDisabled: 'gray-400' },
  backgroundColor: { default: 'transparent', isHovered: 'gray-100', isPressed: 'gray-200', isDisabled: 'transparent' },
  cursor: { default: 'pointer', isDisabled: 'default' },
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineWidth: 2,
  outlineColor: 'focus-ring',
  transition: 'default',
});
const agentTile = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  width: 'full',
  boxSizing: 'border-box',
  padding: 12,
  borderRadius: 'lg',
  borderWidth: 0,
  textAlign: 'start',
  font: 'ui-sm',
  color: 'gray-800',
  backgroundColor: { default: 'gray-75', isHovered: 'gray-100', isPressed: 'gray-200' },
  cursor: 'pointer',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineWidth: 2,
  outlineColor: 'focus-ring',
  transition: 'default',
});
const setupCard = style({ display: 'flex', alignItems: 'start', gap: 12, padding: 12, borderRadius: 'lg', backgroundColor: 'gray-75', font: 'ui-sm' });
const text = style({ display: 'flex', flexDirection: 'column', gap: '[2px]', flexGrow: 1, minWidth: 0, lineHeight: '[1.4]' });
const name = style({ font: 'ui', fontWeight: 'bold', color: 'inherit' });
const sub = style({ font: 'ui-xs', color: 'gray-600' });
const iconBox = style({ display: 'flex', flexShrink: 0, color: 'gray-700' });
/** 状态 chip（原型 .ail__st，`Chip` 即 S2 Badge subtle）：不被两行字挤窄。 */
const stateChip = style({ flexShrink: 0 });
const chev = style({ display: 'flex', flexShrink: 0, color: 'gray-500' });
/** 没有文稿时的说明卡（原型 .aicard.ail__empty）。 */
const emptyCard = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'start',
  gap: 8,
  marginTop: 12,
  padding: 12,
  borderRadius: 'lg',
  backgroundColor: 'gray-75',
  font: 'ui-sm',
  color: 'gray-800',
  lineHeight: '[1.5]',
});
const secHead = style({ marginTop: 20, marginBottom: 4, marginX: 12, font: 'detail', fontWeight: 'bold', color: 'gray-700' });
const groupNote = style({ marginTop: 0, marginBottom: 4, marginX: 12, font: 'ui-xs', color: 'gray-600' });
const footnote = style({ marginTop: 16, marginX: 12, marginBottom: 0, font: 'ui-xs', color: 'gray-600', lineHeight: '[1.5]' });

const TOOL_ICON: Partial<Record<AiToolId, ComponentType>> = {
  polish: Edit,
  chapters: ListBulleted,
  speakers: UserGroup,
  retranscribe: Refresh,
  cleanup: Cut,
  summary: FileText,
  blog: TextParagraph,
  title: TextIcon,
  desc: TextParagraph,
  cover: Image,
};

const STALE_LISTED = AI_TOOLS.some((t) => t.id === 'stale' && LIST_GROUPS.includes(t.group));

type RowTone = 'informative' | 'notice' | 'neutral';
/** 色调同原型的 Chip：在跑 accent → informative，过期与要人看的 notice，其余（含原型的 info）neutral。 */
const ROW_TONE: Record<AiToolRowState['kind'], RowTone> = {
  running: 'informative',
  result: 'notice',
  review: 'notice',
  pending: 'neutral',
  stale: 'notice',
  chapters: 'neutral',
  last: 'neutral',
  undone: 'neutral',
};

function rowText(state: AiToolRowState, now: number): string {
  switch (state.kind) {
    case 'running':
      return state.percent === null ? C.stateRunning : C.statePercent(state.percent);
    case 'result':
      return C.stateResult;
    case 'review':
      return C.stateReview;
    case 'pending':
      return C.statePending(state.count);
    case 'stale':
      return C.stateStale(state.count);
    case 'chapters':
      return C.stateChapters(state.count);
    case 'last':
      return C.stateLast(agoLabel(state.at, now));
    case 'undone':
      return C.undone;
  }
}

/** 过期的译文句子（`enabled` 为假时不取正文）：时间线上每份译文对着它译自的那份转写逐句配对（同字幕面板与配音页的判断）。读不出来时 0，不去猜。 */
function useStaleSentences(documents: Record<Id, DocumentRecord>, enabled: boolean): number {
  const translations = useMemo(
    () =>
      enabled
        ? Object.values(documents).filter((d) => d.kind === 'translation' && d.sourceDocumentId && documents[d.sourceDocumentId]?.kind === 'speech')
        : [],
    [documents, enabled],
  );
  const speeches = useMemo(() => [...new Set(translations.map((t) => t.sourceDocumentId!))].map((id) => documents[id]!), [translations, documents]);
  const speechBodies = useDocumentBodies(speeches);
  const translationBodies = useDocumentBodies(translations);
  return useMemo(() => {
    const sentencesOf = new Map(speeches.map((s, i) => [s.id, speechBodies[i] === undefined ? null : speechSentences(speechBodies[i])]));
    let n = 0;
    translations.forEach((t, i) => {
      const sentences = sentencesOf.get(t.sourceDocumentId!);
      const parsed = readTranslation(translationBodies[i]);
      if (sentences && parsed) n += pairRows(sentences, parsed).filter((r) => r.unit && isStale(r.state)).length;
    });
    return n;
  }, [speeches, speechBodies, translations, translationBodies]);
}

/** 剪辑提案里还没定的建议（找可剪的口写的，视频格式规范 §6.2）。 */
function usePendingCuts(documents: Record<Id, DocumentRecord>): number {
  const proposals = useMemo(() => Object.values(documents).filter((d) => d.kind === EDITORIAL_PROPOSAL_KIND), [documents]);
  const bodies = useDocumentBodies(proposals);
  return useMemo(() => pendingCutCount(proposals.map((record, i) => ({ record, body: bodies[i] })), documents), [proposals, bodies, documents]);
}

/**
 * 一行右边的状态（原型 panel-aitools-list.jsx `rowState`，判断见 `aiToolRowState`）：在跑的（直接调模型的任务、识别说话人、留在原地
 * 交给 Agent 而那条会话还在跑的）、
 * 要人看的结果、找可剪的口留下的建议、过期的译文、时间线上的章节、上次跑完的时间或已撤销。只报编辑器手里有的事实。
 */
function useRowStates(videoId: Id, sequence: Sequence, documents: Record<Id, DocumentRecord>): Partial<Record<AiToolId, { text: string; tone: RowTone }>> {
  const chapters = useMemo(() => chapterPieces(sequence).length, [sequence]);
  const pendingCuts = usePendingCuts(documents);
  // 刷新过期译文这一行在列表里时才去取转写与译文的正文（它所在的翻译组还在各自面板里，见 `LIST_GROUPS`）。
  const staleSentences = useStaleSentences(documents, STALE_LISTED);
  const speakersRunning = useSpeakersRun((s) => !!s.runs[videoId] || !!s.installs[videoId]);
  const speakersPending = useSpeakersRun((s) => !!s.proposals[videoId]);
  // 直接调模型的任务（键「视频 · 工具」）：从这里提交、还没拿到任务号的；出了结果还没看完的；撤销过的。
  const prefix = `${videoId}:`;
  const submitting = useAiToolRun(useShallow((s) => Object.values(s.runs).filter((r) => r.videoId === videoId).map((r) => r.tool)));
  // 撤销过的收据不算没看完：那一行写「已撤销」。
  const unread = useAiToolRun(
    useShallow((s) =>
      [...Object.keys(s.results), ...Object.entries(s.receipts).filter(([, r]) => !r.undone).map(([k]) => k)]
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length)),
    ),
  );
  const undoneJobs = useAiToolRun((s) => s.undoneJobs);
  // 任务镜像里这个视频的 `ai-tool` 任务：别处（CLI、另一个窗口）提交的也在。
  const jobs = useJobs((s) => s.jobs);
  const jobFacts = useMemo(() => aiToolJobFacts(jobs, videoId), [jobs, videoId]);
  // 找可剪的口与刷新过期译文交给 Agent 后留在原地：那条会话还有任务在跑（排着队的也算）。
  const agentRuns = useAiToolAgentRuns((s) => s.runs);
  const conversations = useDirectory((s) => s.conversations);
  const agentBusy = (tool: AiToolId) => {
    const run = agentRuns[toolDraftKey(videoId, tool)];
    const active = run ? (conversations.find((c) => c.id === run.conversationId)?.activeTaskId ?? null) : null;
    return !!active && (run?.taskId === null || run?.taskId === active);
  };
  const now = useNow(30_000);
  const states: Partial<Record<AiToolId, { text: string; tone: RowTone }>> = {};
  for (const t of AI_TOOLS) {
    const job = jobFacts[t.id];
    const running =
      job?.running ??
      (submitting.includes(t.id as AiToolKind) || (t.id === 'speakers' && speakersRunning) || agentBusy(t.id) ? { percent: null } : null);
    const state = aiToolRowState(t.id, {
      running,
      result: unread.includes(t.id),
      review: t.id === 'speakers' && speakersPending,
      pendingCuts,
      staleSentences,
      chapters,
      last: job?.last ? { at: job.last.at, undone: !!undoneJobs[job.last.jobId] } : null,
    });
    if (state) states[t.id] = { text: rowText(state, now), tone: ROW_TONE[state.kind] };
  }
  return states;
}

/** 顶上那张卡：Agent 能用时一句话交给它（新开一条会话，这个视频作为上下文）；不能用时换成配置引导（产品设计 §5.10）。 */
function AgentCard({ guide }: { guide: GateGuide | null }) {
  const source = useVideo((s) => s.video?.ref?.source ?? null);
  const drivers = useConnection((s) => s.drivers);
  const checking = useConnection((s) => s.checking);
  const driver = defaultDriver(drivers, checking);
  if (guide) return <SetupCard guide={guide} />;
  const inProject = !!source?.projectId;
  const open = () => {
    const shell = useShell.getState();
    const target = routeVideo(shell.route);
    // 项目里的视频：项目的新会话起始页，视频作为功能区的标签留在右边；不属于项目的：它所在的那条会话（新会话看不到它的目录）。
    const from = inProject ? { conversationId: null, projectId: source!.projectId } : { conversationId: source?.conversationId ?? null, projectId: null };
    if (target) shell.openPane({ kind: 'video', target }, from);
    else shell.go({ tab: 'home', ...from });
    useShell.getState().revealConversation();
  };
  return (
    <RACButton className={(state) => agentTile(state)} onPress={open}>
      <span className={iconBox}>
        <Comment />
      </span>
      <span className={text}>
        <span className={name}>{C.agentCardTitle}</span>
        <span className={sub}>{inProject ? C.agentCardNew(driver?.name ?? C.agentCardSomeAgent) : C.agentCardOutside}</span>
      </span>
      <span className={chev}>
        <ChevronRight />
      </span>
    </RACButton>
  );
}

function SetupCard({ guide }: { guide: GateGuide }) {
  const { busy, fix } = useGateFix(guide);
  return (
    <div className={setupCard} role="status">
      <span className={iconBox}>
        <Settings />
      </span>
      <span className={text}>
        <span className={name}>{guide.title}</span>
        <span className={sub}>{guide.body}</span>
        <Link variant="secondary" onPress={() => !busy && void fix()}>
          {guide.action}
        </Link>
      </span>
    </div>
  );
}

/**
 * AI 工具 Tab 的列表页（原型 panel-aitools-list.jsx，产品设计 §5.10「分批」）：顶上一张交给 Agent 的卡；没有文稿时加一张说明卡、
 * 工具行置灰；下面按组列第一批的三组工具，每行一句说明与这个视频上的状态；脚注说清还在各自面板里的工具。
 */
export function AiToolsList({ videoId, sequence, documents }: { videoId: Id; sequence: Sequence; documents: Record<Id, DocumentRecord> }) {
  const drivers = useConnection((s) => s.drivers);
  const checking = useConnection((s) => s.checking);
  const guide = gateGuide(homeGate(drivers, checking));
  const hasTranscript = Object.values(documents).some((d) => d.kind === 'speech');
  const states = useRowStates(videoId, sequence, documents);
  return (
    <>
      <PanelHead title={EL.tabAiTools} />
      <div className={`${body} bc-scroll`}>
        <AgentCard guide={guide} />
        {hasTranscript ? null : (
          <div className={emptyCard}>
            <span className={name}>{C.noTranscriptTitle}</span>
            <span>{C.noTranscriptBody}</span>
            <Button size="S" variant="accent" onPress={() => useEditor.getState().showPanel('transcript')}>
              {C.goTranscribe}
            </Button>
          </div>
        )}
        {LIST_GROUPS.map((group) => (
          <section key={group} aria-label={AI_TOOL_GROUP_LABEL[group]}>
            <h3 className={secHead}>{AI_TOOL_GROUP_LABEL[group]}</h3>
            {groupSub(group) ? <p className={groupNote}>{groupSub(group)}</p> : null}
            {AI_TOOLS.filter((t) => t.group === group).map((t) => {
              const Icon = TOOL_ICON[t.id] ?? Edit;
              const state = states[t.id];
              return (
                <RACButton key={t.id} className={(s) => tile(s)} isDisabled={!hasTranscript} onPress={() => openAiTool(videoId, t.id)}>
                  <span className={iconBox}>
                    <Icon />
                  </span>
                  <span className={text}>
                    <span className={name}>{t.name}</span>
                    <span className={sub}>{t.desc}</span>
                  </span>
                  {state ? (
                    <Badge size="S" variant={state.tone} fillStyle="subtle" styles={stateChip}>
                      {state.text}
                    </Badge>
                  ) : null}
                  <span className={chev}>
                    <ChevronRight />
                  </span>
                </RACButton>
              );
            })}
          </section>
        ))}
        <p className={footnote}>{laterNote()}</p>
      </div>
    </>
  );
}
