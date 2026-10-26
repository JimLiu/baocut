import type { CaptionItem, CaptionPresentation, CaptionSceneAdjust, CaptionSceneStyleBody, CaptionSceneSummary, DocumentRecord, EditOperation, Id } from '@baocut/protocol';
import { captionSceneSummary } from '@baocut/editor-wasm';
import { EditLabel } from '@baocut/protocol/messages/ui';
import { ActionButton, Button, ToastQueue, ToggleButton } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { useCallback, useMemo } from 'react';
import { placedCues } from '../../model/caption-cues.ts';
import {
  KEYWORD_TAG,
  MAX_FONT_SCALE,
  MIN_FONT_SCALE,
  cueWords,
  isAdjusted,
  seedAfter,
  seedIndex,
  setWordTag,
  taggedWords,
  withAdjust,
  withColor,
  withFont,
  withPlacement,
  withScale,
  withSeed,
} from '../../model/caption-scene-style.ts';
import type { CaptionChip } from '../../model/caption-tracks.ts';
import { readCaptions } from '../../render/captions.ts';
import { useEditor } from '../../state/editor-store.ts';
import { CAPTION_SCENE_COPY as T } from './caption-scene-copy.ts';
import { previewSceneStyle, saveSceneStyle } from './caption-style-edit.ts';
import { useEditorActions } from './editor-context.tsx';
import { FontField } from './font-field.tsx';
import { ColorField, Note, PRow, Sec, SecHead, ValueRow } from './inspector-controls.tsx';
import type { ItemPageProps } from './inspector-sections.tsx';
import { SUBTITLE_COPY as C } from './subtitle-copy.ts';
import { useDocumentBody } from './use-document-body.ts';

const PLACES = ['y', 'x', 'width'] as const;
type Place = (typeof PLACES)[number];
/** 摘要给不出现值时（没有画布换算像素）滑杆的起点（原型 panel-subadjust.jsx 的 `base`）。 */
const PLACE_BASE: Record<Place, number> = { y: 86, x: 50, width: 80 };

const colorRow = style({ display: 'flex', alignItems: 'center', gap: 8, flexGrow: 1, minWidth: 0 });
const quiet = style({ font: 'ui-xs', color: 'gray-600' });
const listText = style({ font: 'ui-sm', color: 'gray-800', flexGrow: 1, minWidth: 0 });
const words = style({ display: 'flex', flexWrap: 'wrap', gap: 4 });
const seedRow = style({ display: 'flex', alignItems: 'center', gap: 8 });
const footer = style({ display: 'flex', alignItems: 'center', gap: 8, minHeight: 32, paddingTop: 8 });
const footerText = style({ font: 'ui-sm', color: 'gray-800', flexGrow: 1, minWidth: 0 });
const strong = style({ fontWeight: 'bold' });

/** `#RRGGBB` 目标保留原色的透明度（视频格式规范 §5.6），取色框按实际画出来的颜色显示。 */
const shownColor = (value: string, to: string | undefined) => (to ? (to.length === 7 ? `${to}${value.slice(7)}` : to) : value);
/** 取色框不透明时写六位；调整层里一律写八位，不透明就是不透明，不跟着原色的透明度。 */
const fullColor = (color: string) => (color.length === 7 ? `${color}FF` : color);

/**
 * 模板样式的调整页（字幕编辑器重设计 §9.3；原型 panel-subadjust.jsx）：字幕用的是一整份场景（`caption-scene-style`）时，
 * 字幕属性页换成这一页。能调什么全看核心的场景摘要（`captionSceneSummary`），这里不读场景：颜色、字体、大小与位置写进
 * 这份样式的 `adjust`（场景本身不动，「还原」就是去掉它）；关键词与「换一版」写进这一层字幕的实例数据（`presentation`）。
 * 模板调整不记进新字幕选项（§11）。
 */
export function CaptionScenePage({
  item,
  sequence,
  documents,
  canChange,
  record,
  body,
  chip,
}: ItemPageProps<CaptionItem> & {
  documents: Record<Id, DocumentRecord>;
  record: DocumentRecord;
  /** 叠上草稿的正文。 */
  body: CaptionSceneStyleBody;
  chip: CaptionChip | undefined;
}) {
  const { apply, undo } = useEditorActions();
  const summary = useMemo((): CaptionSceneSummary | null => {
    try {
      return captionSceneSummary(body, sequence.canvas);
    } catch {
      return null;
    }
  }, [body, sequence.canvas]);
  const disabled = !canChange || !!chip?.locked;
  const adjust = body.adjust ?? null;
  const label = EditLabel.editSubtitleStyle();

  const live = (next: CaptionSceneAdjust | null) => previewSceneStyle(record, withAdjust(body, next));
  const commit = (next: CaptionSceneAdjust | null) => void saveSceneStyle(apply, record, withAdjust(body, next), label);
  const restore = () =>
    void saveSceneStyle(apply, record, withAdjust(body, null), label).then((receipt) => {
      if (!receipt) return;
      ToastQueue.positive(T.restored, {
        timeout: 5000,
        actionLabel: C.undo,
        onAction: () => void undo({ transaction: receipt.transactionId }),
        shouldCloseOnAction: true,
      });
    });

  /** 实例数据写给这一层字幕的每个实例，各按自己的 `presentation` 算（别的实例参数不被这一件的覆盖）。 */
  const layerItems = useMemo(() => {
    const ids = new Set(chip?.itemIds ?? [item.id]);
    return sequence.items.filter((it): it is CaptionItem => it.type === 'caption' && ids.has(it.id));
  }, [chip, item.id, sequence.items]);
  const present = (next: (presentation: CaptionPresentation | undefined) => CaptionPresentation | null) => {
    const operations = layerItems.map(
      (it): EditOperation => ({ type: 'setCaptionPresentation', sequenceId: sequence.id, itemId: it.id, presentation: next(it.presentation) }),
    );
    if (operations.length) void apply(operations, label);
  };

  if (!summary)
    return (
      <>
        <SecHead first>{T.heading}</SecHead>
        <Note>{T.unavailable}</Note>
      </>
    );

  const adjusted = isAdjusted(body);
  const scale = adjust?.fontScale ?? 1;
  const keyword = summary.wordTags.includes(KEYWORD_TAG);

  return (
    <>
      <SecHead first aside={record.name}>
        {T.heading}
      </SecHead>
      <Note>{T.note}</Note>

      {summary.adjustable.colors && summary.colors.length ? (
        <>
          <SecHead aside={T.colorsAside}>{T.colors}</SecHead>
          <Sec>
            {summary.colors.map((c) => {
              const uses = c.uses.map((use) => T.uses[use] ?? use).join(T.listSeparator);
              return (
                <PRow key={c.value} label={uses}>
                  <div className={colorRow}>
                    <ColorField
                      label={T.colorAria(uses)}
                      value={shownColor(c.value, c.to)}
                      fallback={c.value}
                      isDisabled={disabled}
                      onLive={(color) => live(withColor(adjust, c.value, fullColor(color)))}
                      onCommit={(color) => commit(withColor(adjust, c.value, fullColor(color)))}
                    />
                    {c.animated ? <span className={quiet}>{T.animated}</span> : null}
                  </div>
                </PRow>
              );
            })}
          </Sec>
        </>
      ) : null}

      {summary.adjustable.fonts && summary.fonts.length ? (
        <>
          <SecHead aside={T.fontsAside}>{T.fonts}</SecHead>
          <Sec>
            {summary.fonts.map((f, i) => (
              <div key={f.key}>
                <FontField
                  label={T.fontRow(i + 1)}
                  value={f.to?.family ?? f.family}
                  isDisabled={disabled}
                  onChange={(family) => commit(withFont(adjust, f.key, family === f.family ? null : { family }))}
                />
                {f.to && f.tunedSpacing ? <Note>{T.tunedSpacing}</Note> : null}
              </div>
            ))}
          </Sec>
        </>
      ) : null}

      {summary.adjustable.fontScale ? (
        <>
          <SecHead aside={T.sizeAside}>{T.size}</SecHead>
          <Sec>
            <ValueRow
              label={T.fontScale}
              value={Math.round(scale * 100)}
              min={MIN_FONT_SCALE * 100}
              max={MAX_FONT_SCALE * 100}
              unit="%"
              isDisabled={disabled}
              onLive={(v) => live(withScale(adjust, v / 100))}
              onCommit={(v) => commit(withScale(adjust, v / 100))}
            />
          </Sec>
        </>
      ) : null}

      <SecHead aside={T.positionAside}>{T.position}</SecHead>
      <Sec>
        {PLACES.map((key) =>
          summary.adjustable.placement.includes(key) ? (
            <ValueRow
              key={key}
              label={T.places[key]}
              value={Math.round((summary.placement[key] ?? adjust?.placement?.[key] ?? PLACE_BASE[key] / 100) * 100)}
              min={key === 'width' ? 10 : 0}
              max={100}
              unit="%"
              isDisabled={disabled}
              onLive={(v) => live(withPlacement(adjust, key, v / 100))}
              onCommit={(v) => commit(withPlacement(adjust, key, v / 100))}
            />
          ) : (
            <PRow key={key} label={T.places[key]}>
              <span className={quiet}>{T.computed}</span>
            </PRow>
          ),
        )}
      </Sec>

      {keyword ? (
        <KeywordSection
          item={item}
          sequence={sequence}
          documents={documents}
          isDisabled={disabled}
          onToggle={(wordId, on) => present((p) => setWordTag(p, wordId, on))}
        />
      ) : null}

      {summary.seeded ? (
        <>
          <SecHead aside={T.variantAside}>{T.variant}</SecHead>
          <Sec>
            <div className={seedRow}>
              <Button
                variant="secondary"
                size="S"
                isDisabled={disabled}
                onPress={() => {
                  const seed = seedAfter(item.presentation);
                  present((p) => withSeed(p, seed));
                }}>
                {T.nextVariant}
              </Button>
              <span className={quiet}>{T.variantN(seedIndex(item.presentation) + 1)}</span>
            </div>
          </Sec>
        </>
      ) : null}

      <SecHead aside={T.makeupAside}>{T.makeup}</SecHead>
      <Sec>
        <PRow label={T.layers}>
          <span className={listText}>{[...new Set(summary.layers.map((l) => T.layerKinds[l.kind] ?? l.kind))].join(T.listSeparator) || '—'}</span>
        </PRow>
        <PRow label={T.tiers}>
          <span className={listText}>{summary.tiers.map((t) => T.tierKinds[t] ?? t).join(T.listSeparator) || '—'}</span>
        </PRow>
        <PRow label={T.wordTiming}>
          <span className={listText}>{summary.needsWordTiming ? T.needed : T.notNeeded}</span>
        </PRow>
      </Sec>

      <div className={footer}>
        <span className={footerText}>{adjusted ? <span className={strong}>{T.adjusted}</span> : T.asTemplate}</span>
        {adjusted ? (
          <ActionButton isQuiet size="S" isDisabled={disabled} onPress={restore}>
            {T.restore}
          </ActionButton>
        ) : null}
      </div>
    </>
  );
}

/**
 * 关键词：播放头所在那一句的词，点一下加上或去掉「关键词」词标签（按转写里的词 ID，视频格式规范 §3.8）。
 * 怎么强调由模板决定；不自动挑词。句子没有逐词信息（译文、导入的字幕）时说明标不了。
 */
function KeywordSection({
  item,
  sequence,
  documents,
  isDisabled,
  onToggle,
}: Pick<ItemPageProps<CaptionItem>, 'item' | 'sequence'> & {
  documents: Record<Id, DocumentRecord>;
  isDisabled: boolean;
  onToggle(wordId: string, on: boolean): void;
}) {
  const captionRecord = documents[item.documentId];
  const captionBody = useDocumentBody(captionRecord);
  const speechRecord = captionRecord?.sourceDocumentId ? documents[captionRecord.sourceDocumentId] : undefined;
  const speechBody = useDocumentBody(speechRecord?.kind === 'speech' ? speechRecord : undefined);
  const placed = useMemo(() => {
    const track = readCaptions(captionBody);
    return track ? placedCues(item, sequence, track) : [];
  }, [captionBody, item, sequence]);
  // 只在换句时重画（播放中每帧都动的是播放头）。
  const cueId = useEditor(
    useCallback((s: { playhead: number }) => placed.find((cue) => s.playhead >= cue.start && s.playhead < cue.end)?.cueId ?? null, [placed]),
  );
  const list = useMemo(() => (cueId ? cueWords(captionBody, speechBody, cueId) : null), [captionBody, speechBody, cueId]);
  const marked = taggedWords(item.presentation);

  return (
    <>
      <SecHead aside={T.keywordsAside}>{T.keywords}</SecHead>
      <Sec>
        {!cueId ? (
          <Note>{T.noCue}</Note>
        ) : !list?.length ? (
          <Note>{T.noWords}</Note>
        ) : (
          <div className={words} role="group" aria-label={T.keywordsAria}>
            {list.map((word) => (
              <ToggleButton key={word.id} size="S" isSelected={marked.has(word.id)} isDisabled={isDisabled} onChange={(on) => onToggle(word.id, on)}>
                {word.text}
              </ToggleButton>
            ))}
          </div>
        )}
        <Note>{T.keywordsNote}</Note>
      </Sec>
    </>
  );
}
