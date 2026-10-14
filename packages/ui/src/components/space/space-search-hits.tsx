import { useEffect, useRef, useState } from 'react';
import type { Id, SpaceEntry, SpaceSearchHit, SpaceSearchResult, SpaceSearchV2Result } from '@baocut/protocol';
import { ActionButton, Badge, Checkbox, Picker, PickerItem, ProgressCircle, SegmentedControl, SegmentedControlItem, Text, ToastQueue } from '@react-spectrum/s2';
import MagicWand from '@react-spectrum/s2/icons/MagicWand';
import Filmstrip from '@react-spectrum/s2/icons/Filmstrip';
import { Button as RACButton } from 'react-aria-components';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { aiTool } from '../../model/ai-tools.ts';
import { mergeDraft } from '../../model/ai-tools-handoff.ts';
import { formatClock } from '../../model/format.ts';
import { videoTargetOf } from '../../model/space.ts';
import {
  ANY_HIT,
  canWriteFromHit,
  collectSpeakers,
  DOCUMENT_KIND_LABEL,
  exactSpeaker,
  groupHits,
  HIT_KIND_FILTERS,
  hitChip,
  hitTarget,
  hitVideoEntry,
  hitWhere,
  hitWords,
  matchedByKind,
  planGroupRows,
  foldWeakHits,
  SEARCH_DEBOUNCE_MS,
  searchNote,
  searchRequest,
  searchV2Request,
  seekSeconds,
  semanticHitRows,
  snippetParts,
  speakerOptions,
  type HitFilter,
  type HitGroup,
  type HitKindFilter,
  type SemanticHitRow,
  type SpaceSearchMode,
} from '../../model/space-search.ts';
import { coverageLine } from '../../model/semantic-status.ts';
import { useRuntime } from '../../runtime/context.tsx';
import type { RuntimeSession } from '../../runtime/session.ts';
import { useDraftSkills } from '../../state/draft-skills-store.ts';
import { useEditor } from '../../state/editor-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { useVideo } from '../../state/video-store.ts';
import { openAiTool, setPanelLanding } from '../editor/ai-tools-nav.ts';
import { SemanticNote } from '../semantic-note.tsx';
import { HitPreview, MomentThumb, momentOf, momentPending, useGroupMoments } from './space-hit-moment.tsx';
import { openHome, startDraftKey } from '../start/open-home.ts';
import { useStartBrief } from '../../state/start-brief-store.ts';
import { OUTPUT_COPY } from '../tools/tools-copy.ts';
import { SPACE_COPY as COPY } from './space-copy.ts';

const section = style({ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 });
const head = style({ display: 'flex', alignItems: 'center', gap: 8, font: 'ui-sm', fontWeight: 'bold', color: 'gray-800' });
const count = style({ font: 'ui-sm', fontWeight: 'normal', color: 'gray-600' });
const note = style({ font: 'ui-xs', color: 'gray-600', margin: 0 });
const filters = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 });
const picker = style({ width: 140, maxWidth: 'full' });
const list = style({ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 480, overflowY: 'auto' });
const group = style({ display: 'flex', flexDirection: 'column', gap: 2 });
const rows = style({ display: 'flex', flexDirection: 'column', gap: 2, margin: 0, padding: 0, listStyleType: 'none' });
const groupHead = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: 'full',
  paddingX: 8,
  paddingY: 4,
  borderWidth: 0,
  borderRadius: 'default',
  textAlign: 'start',
  font: 'ui-sm',
  fontWeight: 'bold',
  color: 'gray-900',
  backgroundColor: { default: 'transparent', isHovered: 'gray-100', isFocusVisible: 'gray-100' },
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  cursor: 'default',
});
const groupTitle = style({ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const row = style({
  display: 'flex',
  alignItems: 'start',
  gap: 8,
  width: 'full',
  paddingStart: 32,
  paddingEnd: 8,
  paddingY: 4,
  borderWidth: 0,
  borderRadius: 'default',
  textAlign: 'start',
  font: 'ui-sm',
  color: 'gray-800',
  backgroundColor: { default: 'transparent', isHovered: 'gray-100', isFocusVisible: 'gray-100' },
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  cursor: 'default',
});
const more = style({
  alignSelf: 'start',
  marginStart: 24,
  paddingX: 8,
  paddingY: 4,
  borderWidth: 0,
  borderRadius: 'default',
  font: 'ui-xs',
  color: 'accent',
  backgroundColor: { default: 'transparent', isHovered: 'gray-100', isFocusVisible: 'gray-100' },
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  cursor: 'default',
});
const rowIcon = style({ display: 'flex', flexShrink: 0, color: 'gray-600' });
const rowBody = style({ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 });
const rowMeta = style({ display: 'flex', alignItems: 'center', gap: 8, font: 'ui-xs', color: 'gray-600' });
const rowWhy = style({ font: 'ui-xs', color: 'gray-700' });
const snippet = style({ font: 'ui-sm', color: 'gray-800', overflowWrap: 'anywhere' });
const mark = style({ backgroundColor: 'yellow-400', color: 'gray-900', borderRadius: 'sm' });
const chip = style({ flexShrink: 0 });
const acts = style({ display: 'flex', flexWrap: 'wrap', gap: 4, paddingStart: 32 });
const ask = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 4 });
const channelBox = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 12 });

type SearchState =
  | { status: 'loading'; query: string }
  | { status: 'done'; query: string; mode: 'lexical'; result: SpaceSearchResult }
  | { status: 'done'; query: string; mode: 'hybrid'; result: SpaceSearchV2Result; rows: SemanticHitRow[] }
  | { status: 'error'; query: string; error: string };

type Hit = SpaceSearchHit | SemanticHitRow;
const isSemantic = (hit: Hit): hit is SemanticHitRow => 'hitId' in hit;

const ALL = 'all';
const speakerKey = (name: string) => `speaker:${name}`;

/**
 * 内容命中（架构设计 §5.11）：搜索框里有字时，同时查视频的内容索引（转录、字幕、译文、章节），列在条目列表上面。
 * 停下打字 300ms 再查；只用最后一次的结果。点一条打开那个视频，序列时间的命中跳到那一处。
 *
 * 结果按视频分组（设计稿 page-projects.jsx HitGroup）：组头打开视频、不挪播放头；每组先给十条，「再显示 N 条」再放十条。
 * 可按文档种类、说话人筛（合同 `kinds`、`speaker`）：说话人的选项来自这个词搜到过的命中；Runtime 按「名字里含有」找，
 * 这里再按整串对一遍。设计稿没有这两个筛选控件，样子照 Space 页现有的筛选 Picker。
 *
 * 方式（创作辅助集成设计 §2.4、§2.11；设计稿 space-search.jsx）：「综合」（缺省）走 `space.searchV2`，按意思与字面两路找；
 * 「精确文字」是原来的 `space.search`。综合搜索的命中写明怎么找到的（不给分数）、剪掉了的写「已从时间线剪掉」；顶上一行按通道写
 * 完整性，没装模型退回字面或索引在更新时各入口那一句（`SemanticNote`）。画面与声音这一版没有索引，勾选框置灰并写明。
 */
export function SpaceSearchHits({ query, projectId, entries }: { query: string; projectId: Id | 'none' | null; entries: readonly SpaceEntry[] }) {
  const runtime = useRuntime();
  const web = runtime.host.platform === 'web';
  const [state, setState] = useState<SearchState | null>(null);
  const [mode, setMode] = useState<SpaceSearchMode>('hybrid');
  const [filter, setFilter] = useState<HitFilter>(ANY_HIT);
  // 这个词（与项目）搜到过的说话人；换词时重来。
  const [speakers, setSpeakers] = useState<{ key: string; names: string[] }>({ key: '', names: [] });
  // 每组放到第几条；换词、换筛选时重来。
  const [shown, setShown] = useState<{ key: string; counts: Record<string, number> }>({ key: '', counts: {} });
  // 勉强相关的点开了没有；换词、换筛选时收回去。
  const [weakOpen, setWeakOpen] = useState('');
  const seq = useRef(0);
  const q = query.trim();
  const scopeKey = `${q}\n${projectId ?? ''}`;
  const resultKey = `${scopeKey}\n${mode}\n${filter.kind}\n${filter.speaker ?? ''}`;

  useEffect(() => {
    const id = ++seq.current;
    if (!q) {
      setState(null);
      return;
    }
    setState({ status: 'loading', query: q });
    const scope = `${q}\n${projectId ?? ''}`;
    const timer = setTimeout(() => {
      const search: Promise<SearchState & { status: 'done' }> =
        mode === 'lexical'
          ? runtime.searchSpace(searchRequest(q, projectId, filter)).then((result) => ({ status: 'done', query: q, mode, result }))
          : runtime.client
              .request('space.searchV2', searchV2Request(q, projectId, filter))
              .then((result) => ({ status: 'done', query: q, mode: 'hybrid', result, rows: semanticHitRows(result.hits) }));
      search
        .then((done) => {
          if (id !== seq.current) return;
          setState(done);
          const found: readonly Hit[] = done.mode === 'lexical' ? done.result.hits : done.rows;
          setSpeakers((s) => {
            const names = collectSpeakers(s.key === scope ? s.names : [], found);
            return s.key === scope && names.length === s.names.length ? s : { key: scope, names };
          });
        })
        .catch((error: Error) => {
          if (id === seq.current) setState({ status: 'error', query: q, error: error.message });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [runtime, q, projectId, filter, mode]);

  if (!state) return null;
  const found: readonly Hit[] = state.status !== 'done' ? [] : state.mode === 'lexical' ? state.result.hits : state.rows;
  const matched = exactSpeaker(found, filter.speaker);
  const fold = foldWeakHits(matched);
  const hits = weakOpen === resultKey ? matched : fold.shown;
  const groups = groupHits<Hit>(hits);
  const extra =
    state.status !== 'done'
      ? null
      : state.mode === 'lexical'
        ? searchNote(state.result)
        : searchNote({ complete: true, pendingVideos: 0, truncated: state.result.truncated, hits: state.rows });
  const semantic = state.status === 'done' && state.mode === 'hybrid' ? state.result : null;
  const options = speakerOptions(speakers.key === scopeKey ? speakers.names : [], filter.speaker);
  const filtered = filter.kind !== 'all' || filter.speaker !== null;
  const counts = shown.key === resultKey ? shown.counts : {};
  const showMore = (g: HitGroup<Hit>) =>
    setShown((s) => {
      const before = s.key === resultKey ? s.counts : {};
      return { key: resultKey, counts: { ...before, [g.videoId]: planGroupRows(g.hits, before[g.videoId]).next } };
    });
  const kindLabel = (kind: HitKindFilter) => (kind === 'all' ? COPY.hitKindAll : DOCUMENT_KIND_LABEL[kind]);

  return (
    <section className={section} aria-label={COPY.hitsTitle}>
      <div className={head}>
        <span>{COPY.hitsTitle}</span>
        {state.status === 'loading' ? (
          <ProgressCircle isIndeterminate size="S" aria-label={COPY.hitsSearching} />
        ) : state.status === 'done' ? (
          <span className={count}>{COPY.hitsGrouped(hits.length, groups.length)}</span>
        ) : null}
      </div>
      <div className={filters}>
        <SegmentedControl
          aria-label={COPY.searchMode}
          selectedKey={mode}
          onSelectionChange={(key) => setMode(key === 'lexical' ? 'lexical' : 'hybrid')}>
          <SegmentedControlItem id="hybrid">{COPY.modeHybrid}</SegmentedControlItem>
          <SegmentedControlItem id="lexical">{COPY.modeLexical}</SegmentedControlItem>
        </SegmentedControl>
        <div className={channelBox} role="group" aria-label={COPY.channelsLabel}>
          <Checkbox size="S" isDisabled isSelected>
            {COPY.channelSpeech}
          </Checkbox>
          <Checkbox size="S" isDisabled isSelected={false}>
            {COPY.channelVisual}
          </Checkbox>
          <Checkbox size="S" isDisabled isSelected={false}>
            {COPY.channelAudio}
          </Checkbox>
        </div>
        <Picker
          aria-label={COPY.hitKind}
          size="S"
          styles={picker}
          value={filter.kind}
          onChange={(key) => key !== null && setFilter((f) => ({ ...f, kind: String(key) as HitKindFilter }))}>
          {HIT_KIND_FILTERS.map((kind) => (
            <PickerItem key={kind} id={kind} textValue={kindLabel(kind)}>
              {kindLabel(kind)}
            </PickerItem>
          ))}
        </Picker>
        <Picker
          aria-label={COPY.hitSpeaker}
          size="S"
          styles={picker}
          isDisabled={!options.length}
          value={filter.speaker === null ? ALL : speakerKey(filter.speaker)}
          onChange={(key) => key !== null && setFilter((f) => ({ ...f, speaker: options.find((name) => speakerKey(name) === key) ?? null }))}>
          {[ALL, ...options.map(speakerKey)].map((key, i) => (
            <PickerItem key={key} id={key} textValue={i === 0 ? COPY.hitSpeakerAll : options[i - 1]}>
              {i === 0 ? COPY.hitSpeakerAll : options[i - 1]}
            </PickerItem>
          ))}
        </Picker>
        {state.status === 'done' && hits.length && !options.length ? <span className={note}>{COPY.hitSpeakerNone}</span> : null}
      </div>
      {mode === 'hybrid' ? (
        <p className={note}>{semantic ? `${coverageLine(semantic.coverage)} · ${COPY.channelsLater}` : COPY.channelsLater}</p>
      ) : null}
      {mode === 'hybrid' ? <SemanticNote entry="search" reason={semantic?.degraded?.reason ?? null} /> : null}
      {state.status === 'error' ? <p className={note}>{COPY.hitsError(state.error)}</p> : null}
      {state.status === 'done' && !hits.length ? (
        <p className={note}>{filtered ? COPY.hitsNoneFiltered : semantic && semantic.effectiveMode !== 'lexical' ? COPY.hitsNoneSemantic : COPY.hitsNone}</p>
      ) : null}
      {extra ? <p className={note}>{extra}</p> : null}
      {state.status === 'done' && hits.length ? (
        <div className={ask}>
          <ActionButton size="S" onPress={() => askAcrossVideos(q, projectId)}>
            <MagicWand />
            <Text>{COPY.hitAsk}</Text>
          </ActionButton>
          <span className={note}>{COPY.hitAskHint}</span>
        </div>
      ) : null}
      {groups.length ? (
        <div className={list}>
          {groups.map((g) => (
            <HitGroupView
              key={g.videoId}
              group={g}
              rows={planGroupRows(g.hits, counts[g.videoId])}
              entries={entries}
              query={q}
              web={web}
              runtime={runtime}
              onMore={() => showMore(g)}
            />
          ))}
        </div>
      ) : null}
      {fold.folded.length ? (
        <RACButton
          className={(s) => more(s)}
          aria-expanded={weakOpen === resultKey}
          onPress={() => setWeakOpen((open) => (open === resultKey ? '' : resultKey))}>
          {weakOpen === resultKey ? COPY.hitsWeakHide : COPY.hitsWeakShow(fold.folded.length)}
        </RACButton>
      ) : null}
    </section>
  );
}

/**
 * 一个视频的命中（设计稿 space-search.jsx `ResultCard`）：每行左边是那一刻的那一帧，写在哪、为什么命中（原句里说到了哪些词，
 * 或只是意思相近），点一行打开预览框就地播那一刻，「在时间线打开」才去打开视频。
 */
function HitGroupView({
  group: g,
  rows: plan,
  entries,
  query,
  web,
  runtime,
  onMore,
}: {
  group: HitGroup<Hit>;
  rows: ReturnType<typeof planGroupRows<Hit>>;
  entries: readonly SpaceEntry[];
  query: string;
  web: boolean;
  runtime: RuntimeSession;
  onMore: () => void;
}) {
  const entry = hitVideoEntry(g.hits[0]!, entries);
  const moments = useGroupMoments(runtime, entry?.id ?? null, plan.rows);
  const [preview, setPreview] = useState<Hit | null>(null);
  return (
    <section className={group} aria-label={g.videoName}>
      <RACButton className={(s) => groupHead(s)} onPress={() => openGroup(g, entries)}>
        <span className={rowIcon}>
          <Filmstrip />
        </span>
        <span className={groupTitle}>{g.videoName}</span>
        <span className={count}>{COPY.hitsCount(g.hits.length)}</span>
      </RACButton>
      <ul className={rows}>
        {plan.rows.map((hit, index) => (
          <li key={`${hit.documentId ?? 'chapter'}:${hit.time.start}:${index}`}>
            <RACButton className={(s) => row(s)} onPress={() => setPreview(hit)}>
              <MomentThumb moment={momentOf(moments, hit)} pending={momentPending(moments, hit)} />
              <span className={rowBody}>
                <span className={rowMeta}>
                  <Badge variant="neutral" fillStyle="subtle" size="S" styles={chip}>
                    {hitChip(hit)}
                  </Badge>
                  <span>{hitWhere(hit)}</span>
                </span>
                <span className={rowWhy}>{whyLine(hit)}</span>
                <span className={snippet}>
                  {snippetParts(hit.snippet, hit.highlights).map((part, i) =>
                    part.hit ? (
                      <mark key={i} className={mark}>
                        {part.text}
                      </mark>
                    ) : (
                      <span key={i}>{part.text}</span>
                    ),
                  )}
                </span>
              </span>
            </RACButton>
            <HitActions hit={hit} entries={entries} query={query} web={web} runtime={runtime} />
          </li>
        ))}
      </ul>
      {plan.more ? (
        <RACButton className={(s) => more(s)} onPress={onMore}>
          {COPY.hitsMore(plan.more)}
        </RACButton>
      ) : null}
      <HitPreview
        runtime={runtime}
        entryId={entry?.id ?? null}
        hit={preview}
        moment={preview ? momentOf(moments, preview) : null}
        revision={moments?.revision ?? null}
        where={preview ? hitWhere(preview) : ''}
        why={preview ? whyLine(preview) : ''}
        onOpen={() => preview && (isSemantic(preview) ? void openSemanticHit(runtime, preview, entries) : openHit(preview, entries))}
        onClose={() => setPreview(null)}
      />
    </section>
  );
}

/**
 * 命中行下面的两样（创作辅助集成设计 §2.1，设计稿 space-search.jsx `ResultCard`）：「交给 Agent」把这一句作为引用带进会话
 * （`space.continueInConversation` 带上视频条目，预填一句可改写的话，不自动发送）；「用于写作」打开这部视频的写博客，范围落在
 * 「按主题」、主题就是搜的这句话（写作按主题挑材料时用同一个索引，挑出的就是这里命中的这几段及前后句）。
 */
function HitActions({ hit, entries, query, web, runtime }: { hit: Hit; entries: readonly SpaceEntry[]; query: string; web: boolean; runtime: RuntimeSession }) {
  const entry = hitVideoEntry(hit, entries);
  const write = canWriteFromHit(hit, web) && !!entry;
  if (!entry) return null;
  return (
    <div className={acts}>
      <ActionButton isQuiet size="XS" onPress={() => handOverHit(runtime, hit, entry)}>
        {OUTPUT_COPY.handover}
      </ActionButton>
      {write ? (
        <ActionButton isQuiet size="XS" onPress={() => writeFromHit(hit, entry, query)}>
          {COPY.hitWrite}
        </ActionButton>
      ) : null}
    </div>
  );
}

/**
 * 「回答这个问题」（创作辅助集成设计 §2.9；原型 space-search.jsx `Answer`）：Space 里不调模型，把问题交给新会话，挂上内置 skill
 * `cross-video-qa`，由智能体检索、回答并附可点的出处（回答里的视频时间链接）。按 Space 当前筛到的项目开会话、话里写明只在这个项目里找（skill 才知道要限定项目），没筛项目时是无项目会话；
 * 只放进输入框（接在已有的话后面），由用户发出。
 *
 * 无项目会话的智能体本来只看会话自己的视频（架构设计 §4.8），所以没筛项目时给新会话挂上只读检索范围（`Conversation.spaceReadScope`）：
 * 「全部项目」是全部视频，「不属于项目」是不属于项目的视频。输入框上方写明，可以摘掉。
 */
export function askAcrossVideos(question: string, projectId: Id | 'none' | null): void {
  const project = projectId && projectId !== 'none' ? projectId : null;
  const key = startDraftKey(project);
  const shell = useShell.getState();
  shell.setDraft(key, mergeDraft(shell.drafts[key], COPY.hitAskDraft(question, project !== null)));
  useDraftSkills.getState().add(key, CROSS_VIDEO_QA_SKILL);
  useStartBrief.getState().patch(key, { readScope: project ? null : projectId === 'none' ? 'unfiled' : 'all' });
  openHome(project);
}

/** 跨视频问答的内置 skill（仓库根 `skills/baocut/built-in-skills/cross-video-qa/`）。 */
const CROSS_VIDEO_QA_SKILL = 'cross-video-qa';

function handOverHit(runtime: RuntimeSession, hit: Hit, entry: SpaceEntry): void {
  runtime
    .continueSpaceEntry(entry.id)
    .then(({ conversation, created }) => {
      const shell = useShell.getState();
      shell.setDraft(conversation.id, mergeDraft(shell.drafts[conversation.id], COPY.hitHandoverDraft(hit.videoName, formatClock(hit.time.start), hit.snippet)));
      shell.go({ tab: 'home', conversationId: conversation.id, projectId: null });
      ToastQueue.positive(OUTPUT_COPY.handedOver(created, entry.name, conversation.title || OUTPUT_COPY.untitled), { timeout: 6000 });
    })
    .catch((e: Error) => ToastQueue.negative(OUTPUT_COPY.handoverFailed(e.message), { timeout: 6000 }));
}

function writeFromHit(hit: Hit, entry: SpaceEntry, query: string): void {
  openAiTool(hit.videoId, 'blog', { topic: query });
  setPanelLanding(hit.videoId, 'aitools');
  useShell.getState().openVideo(videoTargetOf(entry));
  ToastQueue.info(COPY.hitWriting(aiTool('blog').name, query), { timeout: 5000 });
}

/**
 * 为什么命中（设计稿 model-space-search.js `why`）：「讲话内容 · 说到了「剪辑」「节奏」」；两路都对上时再写意思也对得上；只按意思
 * 找到的照写原句里没有这些字，勉强相关的另写。不给分数，不编造概念名。不在列表里写「已剪掉」：素材时间的命中也可能只是没有
 * 时间线（或译文对不上时间），是不是真剪掉了要打开时按当前版本解析才知道（`openSemanticHit`）。
 */
function whyLine(hit: Hit): string {
  // 章节标题不是讲出来的话：不挂「讲话内容」，也不写「说到了」，只说对上的是字面还是意思（类型已经在徽标上）。
  const spoken = hit.documentKind !== 'chapter';
  const words = spoken ? hitWords(hit) : [];
  const kind = isSemantic(hit) ? matchedByKind(hit.matchedBy) : 'lexical';
  const why =
    isSemantic(hit) && hit.weak
      ? COPY.byWeak
      : kind === 'semantic' || !words.length
        ? { both: COPY.byBoth, lexical: COPY.byLexical, semantic: COPY.bySemantic }[kind]
        : kind === 'both'
          ? COPY.whySaidMeaning(words)
          : COPY.whySaid(words);
  return spoken ? [COPY.channelSpeech, why].join(' · ') : why;
}

/** 点组头：打开视频，不挪播放头（设计稿：没有落点的不硬编一个）。 */
function openGroup(group: HitGroup<Hit>, entries: readonly SpaceEntry[]): void {
  const target = hitTarget(group.hits[0]!, entries);
  if (!target) {
    ToastQueue.neutral(COPY.hitUnopenable, { timeout: 5000 });
    return;
  }
  useShell.getState().openVideo(target);
}

/**
 * 打开命中所在的视频。序列时间的命中先把编辑器的播放头放到那一秒（编辑器换到这个视频时不再归零，按它定位），
 * 视频打开后版本和建索引时不同就说一声；源时间的命中只打开视频，如实说位置要自己找。
 */
function openHit(hit: SpaceSearchHit, entries: readonly SpaceEntry[]): void {
  const target = hitTarget(hit, entries);
  if (!target) {
    ToastQueue.neutral(COPY.hitUnopenable, { timeout: 5000 });
    return;
  }
  const at = seekSeconds(hit);
  if (at !== null) {
    const editor = useEditor.getState();
    editor.attach(hit.videoId);
    editor.setPlayhead(at);
  }
  useShell.getState().openVideo(target);
  if (at === null) {
    ToastQueue.neutral(COPY.hitSourceClock, { timeout: 5000 });
    return;
  }
  // 打开后对一下版本：建索引之后改过的，位置可能有偏差。等不到就算了。
  const check = () => {
    const video = useVideo.getState().video;
    if (video?.videoId !== hit.videoId || video.status !== 'ready' || !video.state) return false;
    if (video.state.video.revision !== hit.indexedRevision) ToastQueue.neutral(COPY.hitStale, { timeout: 5000 });
    return true;
  };
  if (check()) return;
  const stop = useVideo.subscribe(() => {
    if (check()) cleanup();
  });
  const timer = setTimeout(() => cleanup(), 15_000);
  function cleanup() {
    stop();
    clearTimeout(timer);
  }
}

/**
 * 打开综合搜索的命中：还在时间线上、索引就是当前版本的直接跳到那一秒；否则先按当前版本重新解析（`space.resolveSearchHit`），
 * 解析到时间线上的那一段就跳过去，剪掉了或不在了的只打开视频并说一句。
 */
async function openSemanticHit(runtime: RuntimeSession, hit: SemanticHitRow, entries: readonly SpaceEntry[]): Promise<void> {
  const target = hitTarget(hit, entries);
  if (!target) {
    ToastQueue.neutral(COPY.hitUnopenable, { timeout: 5000 });
    return;
  }
  let at = hit.inTimeline && !hit.needsResolve ? seekSeconds(hit) : null;
  let notice: string | null = null;
  if (at === null) {
    try {
      const resolved = await runtime.client.request('space.resolveSearchHit', { hitId: hit.hitId });
      const span = resolved.spans.find((s) => s.clock === 'sequence');
      if (resolved.status === 'resolved' && span) at = span.startSec;
      else notice = resolved.status === 'gone' ? COPY.hitGone : COPY.hitNotInTimeline;
    } catch {
      notice = hit.inTimeline ? COPY.hitStale : COPY.hitNotInTimeline;
      at = hit.inTimeline ? seekSeconds(hit) : null;
    }
  }
  if (at !== null) {
    const editor = useEditor.getState();
    editor.attach(hit.videoId);
    editor.setPlayhead(at);
  }
  useShell.getState().openVideo(target);
  if (notice) ToastQueue.neutral(notice, { timeout: 5000 });
}
