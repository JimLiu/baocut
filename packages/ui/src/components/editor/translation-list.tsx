import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { DocumentRecord, Id, Sequence } from '@baocut/protocol';
import {
  Button,
  Link,
  Picker,
  PickerItem,
  SegmentedControl,
  SegmentedControlItem,
  Text,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton } from 'react-aria-components';
import { languageName } from '../../model/caption-tracks.ts';
import { formatClock } from '../../model/format.ts';
import { projectSpeech, readSpeechWords } from '../../model/speech-cues.ts';
import { langName } from '../../model/tools-models.ts';
import { derivedFrom } from '../../model/translation-cues.ts';
import { estimateLines } from '../../model/virtual-rows.ts';
import {
  editableRow,
  isStale,
  pairRows,
  pairStats,
  readTranslation,
  speechSentences,
  unitText,
  type PairRow,
  type TranslationBody,
} from '../../model/translation-doc.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useEditor } from '../../state/editor-store.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { openAiTool } from './ai-tools-nav.ts';
import { useEditorActions } from './editor-context.tsx';
import { usePlaybackFollow } from './use-playback-follow.ts';
import { useDocumentBody } from './timeline-cues.tsx';
import { TRANSLATE_COPY as C } from './translate-copy.ts';
import { editTranslation, putOnScreen, type CompareMode } from './translate-run.ts';
import { useVirtualRows } from './use-virtual-rows.ts';

/** 对照条（原型 panel-subtitle.jsx `ListBar`、.sublist）。 */
const bar = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
  paddingX: 12,
  paddingY: 8,
  borderTopWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderBottomWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const barLabel = style({ flexShrink: 0, font: 'ui-xs', color: 'gray-600' });
const barPicker = style({ flexGrow: 1, minWidth: 96, maxWidth: 200 });

const statbar = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  columnGap: 8,
  rowGap: 2,
  flexShrink: 0,
  paddingX: 12,
  paddingY: 4,
  borderTopWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderBottomWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  font: 'ui-xs',
  color: 'gray-600',
});
const warn = style({ color: 'orange-1000', fontWeight: 'medium' });
const fresh = style({ color: 'green-1000' });
const tail = style({ marginStart: 'auto', color: 'gray-500' });
const later = style({ flexBasis: 'full', color: 'gray-600', lineHeight: '[1.5]' });
const place = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
  paddingX: 12,
  paddingY: 8,
  backgroundColor: 'blue-100',
  font: 'ui-xs',
  color: 'blue-1000',
});
const placeText = style({ flexGrow: 1, minWidth: 0 });
const colhead = style({
  display: 'grid',
  gridTemplateColumns: { default: '1fr 1fr', isSingle: '1fr' },
  gap: 8,
  flexShrink: 0,
  paddingX: 12,
  paddingTop: 8,
  font: 'ui-xs',
  fontWeight: 'bold',
  color: 'gray-600',
});
const list = style({ flexGrow: 1, minHeight: 0, overflowY: 'auto', paddingX: 12, paddingBottom: 12 });
/** 虚拟列表的一行：行与行之间不能有外边距，卡间距（第一张离顶也是）是这一层的上内边距 8px。 */
const pairRow = style({ paddingTop: 8 });
/** 一对（原型 panel-translate.jsx `PlainCard`）：上面原文、下面译文；正在播的蓝底，正在改的蓝框。 */
const card = style({
  position: 'relative',
  overflow: 'hidden',
  paddingY: '[9px]',
  paddingStart: '[12px]',
  paddingEnd: '[10px]',
  borderRadius: 'lg',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: { default: 'gray-200', isOn: 'blue-400', isEditing: 'blue-800' },
  backgroundColor: { default: 'gray-25', isOn: 'blue-100', isGone: 'gray-75' },
});
const accent = style({
  position: 'absolute',
  top: 0,
  bottom: 0,
  insetStart: 0,
  width: '[3px]',
  backgroundColor: { default: 'gray-300', isOn: 'blue-800', isEditing: 'blue-800', isStale: 'orange-700', isGone: 'gray-400' },
});
const cardHead = style({ display: 'flex', alignItems: 'center', gap: '[6px]', marginBottom: '[5px]', minHeight: 20 });
const number = style({ fontSize: '[10px]', color: 'gray-500', minWidth: 16 });
const time = style({
  padding: 0,
  borderWidth: 0,
  backgroundColor: 'transparent',
  font: 'ui-xs',
  color: { default: 'gray-500', isMissing: 'gray-400' },
  cursor: { default: 'pointer', isMissing: 'default' },
  textDecoration: { isHovered: 'underline' },
  borderRadius: 'sm',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
});
const chip = style({
  flexShrink: 0,
  paddingX: '[6px]',
  borderRadius: 'sm',
  fontSize: '[10px]',
  fontWeight: 'medium',
  lineHeight: '[16px]',
  backgroundColor: { default: 'orange-200', tone: { muted: 'gray-200', info: 'blue-200' } },
  color: { default: 'orange-1100', tone: { muted: 'gray-800', info: 'blue-1100' } },
});
const original = style({ display: 'block', font: 'body-sm', lineHeight: '[1.6]', color: { default: 'gray-600', isGone: 'gray-500' }, whiteSpace: 'pre-wrap', overflowWrap: 'break-word' });
const translated = style({
  display: 'block',
  marginTop: 4,
  font: 'body-sm',
  lineHeight: '[1.6]',
  color: { default: 'gray-900', isEmpty: 'gray-500', isGone: 'gray-500' },
  fontStyle: { default: 'normal', isEmpty: 'italic' },
  whiteSpace: 'pre-wrap',
  overflowWrap: 'break-word',
  cursor: { default: 'text', isGone: 'default' },
  borderRadius: 'sm',
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
});
const editor = style({
  display: 'block',
  boxSizing: 'border-box',
  width: 'full',
  marginTop: 4,
  padding: 0,
  borderWidth: 0,
  outlineStyle: 'none',
  resize: 'none',
  overflow: 'hidden',
  backgroundColor: 'transparent',
  font: 'body-sm',
  lineHeight: '[1.6]',
  color: 'gray-900',
});
const muted = style({ font: 'ui-sm', color: 'gray-600', paddingY: 24, paddingX: 12, textAlign: 'center' });
/**
 * 一行的估计高（量到之前顶着）：上内边距 8 + 卡的边框 2 + 上下内边距 18 + 卡头 20 + 卡头下 5；原文与译文每行 22.4（14px × 1.6），
 * 译文上面再空 4；文字比列表内容窄 24（边框 2、左右内边距 12 与 10）。
 */
const ROW_BASE = 53;
const TEXT_SIZE = 14;
const TEXT_LINE = 22.4;
const CARD_INSET = 24;

/** 对照条里一门译文的名字：语言名；同一门语言有几份（译自不同的转写）时带上文档名。 */
function optionLabel(record: DocumentRecord, all: readonly DocumentRecord[]): string {
  const name = record.language ? languageName(record.language) : record.name;
  const twins = record.language ? all.filter((d) => d.language === record.language).length : 1;
  return twins > 1 ? `${name} · ${record.name}` : name;
}

/**
 * 对照条（原型 panel-subtitle.jsx `ListBar`）：列表只看原文、原文 ＋ 译文还是只看译文，对照哪一门译文。一门译文都没有时
 * 后两档进不去：由调用方说清楚去哪开（不静默弹回）。
 */
export function CompareBar({
  mode,
  translations,
  compared,
  onMode,
  onPick,
}: {
  mode: CompareMode;
  translations: readonly DocumentRecord[];
  compared: DocumentRecord | null;
  onMode(mode: CompareMode): void;
  onPick(documentId: Id): void;
}) {
  return (
    <div className={bar}>
      <span className={barLabel}>{C.list}</span>
      <SegmentedControl aria-label={C.list} selectedKey={mode} onSelectionChange={(key) => onMode(key as CompareMode)}>
        <SegmentedControlItem id="src">{C.modes.src}</SegmentedControlItem>
        <SegmentedControlItem id="bi">{C.modes.bi}</SegmentedControlItem>
        <SegmentedControlItem id="trans">{C.modes.trans}</SegmentedControlItem>
      </SegmentedControl>
      {mode === 'src' || !compared ? null : (
        <Picker
          aria-label={C.compareLanguage}
          size="S"
          styles={barPicker}
          selectedKey={compared.id}
          onSelectionChange={(key) => key !== null && onPick(String(key))}>
          {translations.map((d) => (
            <PickerItem key={d.id} id={d.id} textValue={optionLabel(d, translations)}>
              <Text slot="label">{optionLabel(d, translations)}</Text>
              {d.language ? <Text slot="description">{langName(d.language)}</Text> : null}
            </PickerItem>
          ))}
        </Picker>
      )}
    </div>
  );
}

/** 文档的正文；新版本还在取时先用上一版。 */
/**
 * 按取回来的正文对象记下的派生（正文取回来之后不再改，改了是新对象）：从「只看原文」切回对照时列表重挂，不必把几千句
 * 再交给 WASM 拆一遍。
 */
const derived = new WeakMap<object, Map<string, unknown>>();
function derive<T>(body: unknown, name: string, compute: (body: unknown) => T): T {
  if (typeof body !== 'object' || body === null) return compute(body);
  let entry = derived.get(body);
  if (!entry) derived.set(body, (entry = new Map()));
  if (!entry.has(name)) entry.set(name, compute(body));
  return entry.get(name) as T;
}

function useLoaded(record: DocumentRecord | undefined): unknown {
  const body = useDocumentBody(record);
  const last = useRef<{ id: Id | undefined; body: unknown }>({ id: undefined, body: undefined });
  if (body !== undefined) last.current = { id: record?.id, body };
  return body ?? (last.current.id === record?.id ? last.current.body : undefined);
}

/**
 * 原文 ＋ 译文的对照列表（原型 panel-translate.jsx `EditView`，`only: 'trans'` 时只看译文）：逐句配对、标出过期、未翻译与
 * 原句已删的；单击译文就地改写（失焦提交、Esc 放弃），一笔事务连同画面上从它生成的字幕一起改，一次撤销。
 * 有过期的译文时指一条路：工具页的「刷新过期译文」交给 Agent 只重译这几句（网页宿主没有工具页，只说可以直接改）。
 */
export function TranslationList({
  videoId,
  sequence,
  documents,
  record,
  only,
}: {
  videoId: Id;
  sequence: Sequence;
  documents: Record<Id, DocumentRecord>;
  /** `translation` 文档。 */
  record: DocumentRecord;
  only: 'trans' | null;
}) {
  const { seek } = useEditorActions();
  const editable = useVideo((s) => canEdit(s.video));
  const web = useRuntime().host.platform === 'web';
  const loaded = useLoaded(record);
  // 刚改完、新版本还没取回来的译文：接着的改动在它上面做。
  const [local, setLocal] = useState<{ base: unknown; body: TranslationBody } | null>(null);
  useEffect(() => {
    if (local && local.base !== loaded) setLocal(null);
  }, [local, loaded]);
  const translation = useMemo(
    () => (local && local.base === loaded ? local.body : derive(loaded, 'translation', readTranslation)),
    [local, loaded],
  );

  const speechId = record.sourceDocumentId ?? translation?.sourceBasis.speechRef.id ?? null;
  const speechRecord = speechId ? documents[speechId] : undefined;
  const speechBody = useLoaded(speechRecord);
  const words = useMemo(
    () => (speechBody === undefined ? null : derive(speechBody, 'words', (body) => readSpeechWords(body))),
    [speechBody],
  );
  // 句子与指纹经 editor-wasm 同步求出（WASM 随 bundle 内联，第一次调用时同步实例化）：按正文算一次。
  const ready = useMemo(() => (speechBody === undefined ? null : derive(speechBody, 'sentences', speechSentences)), [speechBody]);

  const rows = useMemo(() => (translation && ready ? pairRows(ready, translation) : []), [translation, ready]);
  const stats = useMemo(() => pairStats(rows), [rows]);

  /** 每一句在序列上第一次出现的区间（素材时钟的词经实例投过去；剪掉的没有）。 */
  const spans = useMemo(() => {
    const map = new Map<Id, { start: number; end: number }>();
    const assetId = speechRecord?.sourceAssetId;
    if (!words || !assetId || !ready) return map;
    const placed = projectSpeech(sequence, assetId, words.words);
    const sentenceOf = new Map<Id, Id>();
    for (const s of ready) for (const w of s.wordIds) sentenceOf.set(w, s.id);
    for (const word of placed) {
      const id = sentenceOf.get(word.id);
      if (!id) continue;
      const span = map.get(id);
      if (!span) map.set(id, { start: word.start, end: word.end });
      else if (word.start >= span.start && word.start - span.end < 1) span.end = Math.max(span.end, word.end);
    }
    return map;
  }, [words, speechRecord?.sourceAssetId, ready, sequence]);

  const activeId = useEditor(
    useCallback(
      (s: { playhead: number }) => {
        for (const [id, span] of spans) if (s.playhead >= span.start && s.playhead < span.end) return id;
        return null;
      },
      [spans],
    ),
  );
  const playing = useEditor((s) => s.playing);
  const listRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<string | null>(null);

  // 虚拟列表：只挂视口前后一屏的卡，外加正在改的那一张（编辑框卸掉会丢掉没提交的字、打断输入法组字）。
  const keys = useMemo(() => rows.map((r) => r.key), [rows]);
  const sentenceIndex = useMemo(() => new Map(rows.flatMap((r, index) => (r.sentence ? [[r.sentence.id, index] as const] : []))), [rows]);
  const estimate = useCallback(
    (index: number, width: number) => {
      const r = rows[index];
      if (!r) return ROW_BASE + TEXT_LINE;
      const text = width - CARD_INSET;
      const source = only === 'trans' || !r.sentence ? 0 : estimateLines(r.sentence.text, text, TEXT_SIZE);
      return ROW_BASE + TEXT_LINE * source + 4 + TEXT_LINE * estimateLines(r.unit ? unitText(r.unit) : '', text, TEXT_SIZE);
    },
    [rows, only],
  );
  const virtual = useVirtualRows({ scrollRef: listRef, keys, estimate, pinned: [editing], measureKey: `${record.id}:${only ?? 'both'}` });
  const { scrollToIndex } = virtual;
  // 播放跟随的开关（产品设计 §5.7）：手动滚开就停，本面板里跳播、重新开始播放时恢复。对照与只看译文之间切换算换了画面，
  // 也恢复（与原文 ↔ 对照之间切换时列表重新装上一致）。
  const follow = usePlaybackFollow(listRef);
  useEffect(() => follow.resume(), [only]); // eslint-disable-line react-hooks/exhaustive-deps
  // 播放时跟着正在播的那句，滚到看得见为止（只在换句、开始播放、退出编辑、切换视图时滚一次）。
  useEffect(() => {
    if (!playing || !activeId || editing || follow.off.current) return;
    const index = sentenceIndex.get(activeId);
    if (index !== undefined) void scrollToIndex(index, { align: 'nearest' });
  }, [activeId, playing, editing, only]); // eslint-disable-line react-hooks/exhaustive-deps
  /** 本面板里的跳播（点时间、点卡片）：恢复跟随。 */
  const seekHere = (at: number) => {
    follow.resume();
    seek(at);
  };

  // 卡上的动作：卡是 memo 的，拿这个不变的 ref 调最新的处理函数，播放时只重画进出「正在播」的两张。
  const actions = useRef<PairActions>(null!);

  const [placing, setPlacing] = useState(false);
  const placed = Object.values(documents).some((d) => derivedFrom(d, record.id));

  if (loaded === undefined) return <div className={muted}>{C.reading}</div>;
  if (!translation) return <div className={muted}>{C.unreadable}</div>;
  if (!speechRecord) return <div className={muted}>{C.speechMissing}</div>;
  if (!ready || !words) return <div className={muted}>{speechBody === undefined ? C.reading : C.unreadable}</div>;

  const language = translation.language || record.language || '';
  const sourceLanguage = speechRecord.language ? langName(speechRecord.language) : C.source;
  const commit = async (row: PairRow, text: string) => {
    setEditing(null);
    const before = row.unit ? unitText(row.unit) : '';
    if (text.trim() === before) return;
    const next = await editTranslation({ videoId, record, body: translation, sentences: ready, row, text, speech: words, documents });
    if (next) setLocal({ base: loaded, body: next });
  };
  actions.current = {
    seek: seekHere,
    begin: (row) => {
      const at = row.sentence ? spans.get(row.sentence.id)?.start : undefined;
      if (!playing && at !== undefined) seekHere(at);
      setEditing(row.key);
    },
    commit: (row, text) => void commit(row, text),
    cancel: () => setEditing(null),
  };

  return (
    <>
      {placed ? null : (
        <div className={place}>
          <span className={placeText}>{C.notPlaced}</span>
          <Button
            size="S"
            variant="accent"
            isDisabled={!editable}
            isPending={placing}
            onPress={() => {
              setPlacing(true);
              void putOnScreen(videoId, record.id).finally(() => setPlacing(false));
            }}>
            {C.place}
          </Button>
        </div>
      )}
      <div className={statbar}>
        <span>{C.stats(stats.sentences)}</span>
        {stats.untranslated ? <span className={warn}>{C.untranslated(stats.untranslated)}</span> : null}
        {stats.stale ? <span className={warn}>{C.stale(stats.stale)}</span> : null}
        {stats.gone ? <span className={warn}>{C.gone(stats.gone)}</span> : null}
        {stats.untranslated || stats.stale || stats.gone ? null : <span className={fresh}>{C.allFresh}</span>}
        {editable ? <span className={tail} title={C.editHint}>{C.editTail}</span> : null}
        {stats.stale ? (
          web ? (
            <span className={later}>{C.refreshHintWeb}</span>
          ) : (
            <span className={later}>
              {C.refreshHint}
              <Link onPress={() => openAiTool(videoId, 'stale', { language: language ? languageName(language) : null })}>{C.refreshOpen}</Link>
            </span>
          )
        ) : null}
      </div>
      <div className={colhead({ isSingle: only === 'trans' })}>
        {only === 'trans' ? null : <span>{C.original(sourceLanguage)}</span>}
        <span>{C.translation(language ? languageName(language) : C.unnamed)}</span>
      </div>
      <div ref={listRef} className={`${list} bc-scroll`} {...virtual.containerProps}>
        {rows.length ? null : <div className={muted}>{C.noRows}</div>}
        {virtual.segments.map((segment, n) => {
          if ('gap' in segment) return <div key={`gap:${n}`} aria-hidden style={{ height: segment.gap }} />;
          const index = segment.index;
          const row = rows[index]!;
          return (
            <div
              key={row.key}
              ref={virtual.measureRef(row.key)}
              className={pairRow}
              role="listitem"
              aria-setsize={rows.length}
              aria-posinset={index + 1}>
              <PairCard
                row={row}
                index={index}
                only={only}
                at={row.sentence ? (spans.get(row.sentence.id)?.start ?? null) : null}
                on={!!row.sentence && row.sentence.id === activeId}
                editing={editing === row.key}
                editable={editable && editableRow(row)}
                actions={actions}
              />
            </div>
          );
        })}
      </div>
    </>
  );
}

function stateChip(row: PairRow): { text: string; tone?: 'muted' | 'info'; tip?: string } | null {
  if (row.state === 'sentence-gone') return { text: C.chipGone, tone: 'muted', tip: C.goneTip };
  if (isStale(row.state)) return { text: C.chipStale };
  if (row.state === 'untranslated' || row.state === 'empty') return { text: C.chipUntranslated, tone: 'info' };
  return null;
}

/** 卡上的动作（TranslationList 每次渲染换成最新的一份，卡经 ref 调）。 */
interface PairActions {
  seek(at: number): void;
  begin(row: PairRow): void;
  commit(row: PairRow, text: string): void;
  cancel(): void;
}

const PairCard = memo(function PairCard({
  row,
  index,
  only,
  at,
  on,
  editing,
  editable,
  actions,
}: {
  row: PairRow;
  index: number;
  only: 'trans' | null;
  /** 这一句在序列上第一次出现的时刻；剪掉了（或原句已删）时 null。 */
  at: number | null;
  on: boolean;
  editing: boolean;
  editable: boolean;
  actions: RefObject<PairActions>;
}) {
  const gone = row.state === 'sentence-gone';
  const stale = isStale(row.state);
  const text = row.unit ? unitText(row.unit) : '';
  const flag = stateChip(row);
  const onSeek = (at: number) => actions.current.seek(at);
  const onBegin = () => actions.current.begin(row);
  return (
    <div className={card({ isOn: on, isEditing: editing, isGone: gone })} data-sentence={row.sentence?.id}>
      <span className={accent({ isOn: on, isEditing: editing, isStale: stale, isGone: gone })} aria-hidden />
      <div className={cardHead}>
        <span className={`${number} bc-tabular`}>{index + 1}</span>
        {gone ? null : (
          <TooltipTrigger>
            <RACButton
              className={({ isHovered, isFocusVisible }) =>
                `${time({ isMissing: at === null, isHovered: isHovered && at !== null, isFocusVisible })} bc-tabular`
              }
              onPress={() => at !== null && onSeek(at)}>
              {at === null ? '—' : formatClock(at, { tenths: true })}
            </RACButton>
            <Tooltip>{at === null ? C.cutTip : C.seekTip}</Tooltip>
          </TooltipTrigger>
        )}
        {flag ? (
          flag.tip ? (
            <TooltipTrigger>
              <RACButton className={chip({ tone: flag.tone })}>{flag.text}</RACButton>
              <Tooltip>{flag.tip}</Tooltip>
            </TooltipTrigger>
          ) : (
            <span className={chip({ tone: flag.tone })}>{flag.text}</span>
          )
        ) : null}
      </div>
      {only === 'trans' || !row.sentence ? null : <span className={original({ isGone: gone })}>{row.sentence.text}</span>}
      {editing ? (
        <UnitEditor initial={text} onCommit={(value) => actions.current.commit(row, value)} onCancel={() => actions.current.cancel()} />
      ) : (
        <span
          className={translated({ isEmpty: !text, isGone: gone })}
          role={editable ? 'button' : undefined}
          tabIndex={editable ? 0 : undefined}
          aria-label={editable ? C.editLabel(index + 1) : undefined}
          onClick={() => {
            if (!editable) return at !== null && onSeek(at);
            const selection = window.getSelection();
            if (selection && !selection.isCollapsed) return;
            onBegin();
          }}
          onKeyDown={(event) => {
            if (editable && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault();
              onBegin();
            }
          }}>
          {text || (editable ? C.emptyPlaceholder : '—')}
        </span>
      )}
    </div>
  );
});

/** 改一句译文：失焦或 Enter 提交，Esc 放弃，Shift+Enter 换行；输入法组字时的 Enter 不算。 */
function UnitEditor({ initial, onCommit, onCancel }: { initial: string; onCommit(text: string): void; onCancel(): void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const handled = useRef(false);
  const fit = () => {
    const element = ref.current;
    if (!element) return;
    element.style.height = '0px';
    element.style.height = `${element.scrollHeight}px`;
  };
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
    fit();
  }, []);
  const finish = (action: () => void) => {
    handled.current = true;
    action();
  };
  return (
    <textarea
      ref={ref}
      className={editor}
      aria-label={C.editing}
      defaultValue={initial}
      rows={1}
      onInput={fit}
      onBlur={(event) => {
        if (!handled.current) onCommit(event.currentTarget.value);
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(onCancel);
        } else if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          const value = event.currentTarget.value;
          finish(() => onCommit(value));
        }
      }}
    />
  );
}
