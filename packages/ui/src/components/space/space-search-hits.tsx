import { useEffect, useRef, useState } from 'react';
import type { Id, SpaceEntry, SpaceSearchHit, SpaceSearchResult } from '@baocut/protocol';
import { Badge, Picker, PickerItem, ProgressCircle, ToastQueue } from '@react-spectrum/s2';
import Filmstrip from '@react-spectrum/s2/icons/Filmstrip';
import { Button as RACButton } from 'react-aria-components';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import {
  ANY_HIT,
  collectSpeakers,
  DOCUMENT_KIND_LABEL,
  exactSpeaker,
  groupHits,
  HIT_KIND_FILTERS,
  hitChip,
  hitTarget,
  hitWhere,
  planGroupRows,
  SEARCH_DEBOUNCE_MS,
  searchNote,
  searchRequest,
  seekSeconds,
  snippetParts,
  speakerOptions,
  type HitFilter,
  type HitGroup,
  type HitKindFilter,
} from '../../model/space-search.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useEditor } from '../../state/editor-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { useVideo } from '../../state/video-store.ts';
import { SPACE_COPY as COPY } from './space-copy.ts';

const section = style({ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 });
const head = style({ display: 'flex', alignItems: 'center', gap: 8, font: 'ui-sm', fontWeight: 'bold', color: 'gray-800' });
const count = style({ font: 'ui-sm', fontWeight: 'normal', color: 'gray-600' });
const note = style({ font: 'ui-xs', color: 'gray-600', margin: 0 });
const filters = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 });
const picker = style({ width: 140, maxWidth: 'full' });
const list = style({ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' });
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
const rowMeta = style({ font: 'ui-xs', color: 'gray-600' });
const snippet = style({ font: 'ui-sm', color: 'gray-800', overflowWrap: 'anywhere' });
const mark = style({ backgroundColor: 'yellow-400', color: 'gray-900', borderRadius: 'sm' });
const chip = style({ flexShrink: 0 });

type SearchState =
  | { status: 'loading'; query: string }
  | { status: 'done'; query: string; result: SpaceSearchResult }
  | { status: 'error'; query: string; error: string };

const ALL = 'all';
const speakerKey = (name: string) => `speaker:${name}`;

/**
 * 内容命中（架构设计 §5.11）：搜索框里有字时，同时查视频的内容索引（转录、字幕、译文、章节），列在条目列表上面。
 * 停下打字 300ms 再查；只用最后一次的结果。点一条打开那个视频，序列时间的命中跳到那一处。
 *
 * 结果按视频分组（设计稿 page-projects.jsx HitGroup）：组头打开视频、不挪播放头；每组先给十条，「再显示 N 条」再放十条。
 * 可按文档种类、说话人筛（合同 `kinds`、`speaker`）：说话人的选项来自这个词搜到过的命中；Runtime 按「名字里含有」找，
 * 这里再按整串对一遍。设计稿没有这两个筛选控件，样子照 Space 页现有的筛选 Picker。
 */
export function SpaceSearchHits({ query, projectId, entries }: { query: string; projectId: Id | 'none' | null; entries: readonly SpaceEntry[] }) {
  const runtime = useRuntime();
  const [state, setState] = useState<SearchState | null>(null);
  const [filter, setFilter] = useState<HitFilter>(ANY_HIT);
  // 这个词（与项目）搜到过的说话人；换词时重来。
  const [speakers, setSpeakers] = useState<{ key: string; names: string[] }>({ key: '', names: [] });
  // 每组放到第几条；换词、换筛选时重来。
  const [shown, setShown] = useState<{ key: string; counts: Record<string, number> }>({ key: '', counts: {} });
  const seq = useRef(0);
  const q = query.trim();
  const scopeKey = `${q}\n${projectId ?? ''}`;
  const resultKey = `${scopeKey}\n${filter.kind}\n${filter.speaker ?? ''}`;

  useEffect(() => {
    const id = ++seq.current;
    if (!q) {
      setState(null);
      return;
    }
    setState({ status: 'loading', query: q });
    const scope = `${q}\n${projectId ?? ''}`;
    const timer = setTimeout(() => {
      runtime
        .searchSpace(searchRequest(q, projectId, filter))
        .then((result) => {
          if (id !== seq.current) return;
          setState({ status: 'done', query: q, result });
          setSpeakers((s) => {
            const names = collectSpeakers(s.key === scope ? s.names : [], result.hits);
            return s.key === scope && names.length === s.names.length ? s : { key: scope, names };
          });
        })
        .catch((error: Error) => {
          if (id === seq.current) setState({ status: 'error', query: q, error: error.message });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [runtime, q, projectId, filter]);

  if (!state) return null;
  const hits = state.status === 'done' ? exactSpeaker(state.result.hits, filter.speaker) : [];
  const groups = groupHits(hits);
  const extra = state.status === 'done' ? searchNote(state.result) : null;
  const options = speakerOptions(speakers.key === scopeKey ? speakers.names : [], filter.speaker);
  const filtered = filter.kind !== 'all' || filter.speaker !== null;
  const counts = shown.key === resultKey ? shown.counts : {};
  const showMore = (g: HitGroup) =>
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
      {state.status === 'error' ? <p className={note}>{COPY.hitsError(state.error)}</p> : null}
      {state.status === 'done' && !hits.length ? <p className={note}>{filtered ? COPY.hitsNoneFiltered : COPY.hitsNone}</p> : null}
      {extra ? <p className={note}>{extra}</p> : null}
      {groups.length ? (
        <div className={list}>
          {groups.map((g) => {
            const plan = planGroupRows(g.hits, counts[g.videoId]);
            return (
              <section key={g.videoId} className={group} aria-label={g.videoName}>
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
                      <RACButton className={(s) => row(s)} onPress={() => openHit(hit, entries)}>
                        <Badge variant="neutral" fillStyle="subtle" size="S" styles={chip}>
                          {hitChip(hit)}
                        </Badge>
                        <span className={rowBody}>
                          <span className={rowMeta}>{hitWhere(hit)}</span>
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
                    </li>
                  ))}
                </ul>
                {plan.more ? (
                  <RACButton className={(s) => more(s)} onPress={() => showMore(g)}>
                    {COPY.hitsMore(plan.more)}
                  </RACButton>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

/** 点组头：打开视频，不挪播放头（设计稿：没有落点的不硬编一个）。 */
function openGroup(group: HitGroup, entries: readonly SpaceEntry[]): void {
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
