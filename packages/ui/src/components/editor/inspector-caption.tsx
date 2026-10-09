import type { CaptionItem, DocumentRecord, Id } from '@baocut/protocol';
import { ActionButton, Button, Switch } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { useState } from 'react';
import { editLine, followRatio, followShared, lineOverrides, lineSize, lineView } from '../../model/caption-lines.ts';
import { asObject, num, type Json, type LineKind } from '../../render/text-style.ts';
import { useVideo } from '../../state/video-store.ts';
import { openCaptionStyles } from './caption-open.ts';
import { previewCaptionStyle, saveCaptionStyle } from './caption-style-edit.ts';
import { useEditorActions } from './editor-context.tsx';
import { Note, PRow, Sec, SecHead, Seg, ValueRow } from './inspector-controls.tsx';
import { DeleteItem, TimeSection, type ItemPageProps } from './inspector-sections.tsx';
import { TextStyleEditor } from './inspector-text-style.tsx';
import { CAPTION_STYLE_COPY as S } from './subtitle-copy.ts';
import { useCaptionStyle } from './use-caption-style.ts';
import { INSPECTOR_COPY as IC } from './inspector-copy.ts';

const ORDERS = [
  {
    key: 'trans',
    get label() {
      return IC.orderTranslationFirst;
    },
  },
  {
    key: 'orig',
    get label() {
      return IC.orderOriginalFirst;
    },
  },
] as const;
const LINES = [
  {
    key: 'original',
    get label() {
      return S.original;
    },
  },
  {
    key: 'translation',
    get label() {
      return S.translation;
    },
  },
] as const;
type Anchor = (typeof S.anchors)[number]['key'];

/** 页顶「更换样式」（原型 panel-subprops.jsx 的 .mact）。 */
const actions = style({ display: 'flex', flexWrap: 'wrap', gap: '[6px]', paddingTop: 4 });
/** 一句说明加一颗退回钮（原型 .subscope__s）。 */
const noteRow = style({ display: 'flex', alignItems: 'center', gap: 8, minHeight: 24 });
const noteText = style({ flexGrow: 1, minWidth: 0 });

const fixed = (value: number, digits: number) => String(+value.toFixed(digits));

/**
 * 字幕属性：改的是字幕样式文档（`caption-style`），用同一份样式的字幕一起变。字幕还没有样式文档时，第一次修改新建一份，
 * 让序列里还没有样式、能改的字幕都用它（锁住的实例与锁住轨道上的跳过，引擎会拒绝）。拖动中的值叠给预览（见 video-editor
 * 的 DraftDocuments），松手写入文档的新版本。
 *
 * 原文与译文共用这份样式才叠成双语两行（预览按样式文档分组），所以双语时顶上给「原文 | 译文」：文字样式写进那一行的
 * `origStyle` / `transStyle` 覆盖，位置、双语次序与显示时机是两行共用的根样式（见 model/caption-lines.ts）。
 */
export function CaptionPage(props: ItemPageProps<CaptionItem> & { documents: Record<Id, DocumentRecord> }) {
  const { item, sequence, documents, canChange } = props;
  const { apply } = useEditorActions();
  const videoId = useVideo((s) => s.video?.videoId ?? null);
  // 这份样式管哪几种行：画面上用它的字幕；还没有样式时是画面上同样没有样式、第一次修改会一起挂上的那些。
  const { record, body, root, chip, own, sharing, paired } = useCaptionStyle(item, sequence, documents);
  const [picked, setPicked] = useState<{ itemId: Id; kind: LineKind } | null>(null);
  const kind: LineKind = paired && picked?.itemId === item.id ? picked.kind : own;

  const preview = (next: Json) => {
    if (body !== undefined) previewCaptionStyle(record, body, next);
  };
  const save = (next: Json, singleLine?: LineKind) => {
    if (body !== undefined) saveCaptionStyle(apply, { sequence, record, body, before: root, style: next, label: IC.editCaptionStyle }, singleLine);
  };

  if (body === undefined)
    return (
      <>
        <Note>{IC.loadingCaptionStyle}</Note>
        <Tail {...props} />
      </>
    );
  if (!root)
    return (
      <>
        <SecHead first>{IC.style}</SecHead>
        <Note>{IC.captionSchema(String(asObject(body).schema ?? IC.noSchema))}</Note>
        <Tail {...props} />
      </>
    );

  const disabled = !canChange;
  // 根样式上的补丁（位置、双语、显示）；文字样式按这一行落进覆盖或根样式。
  const live = (patch: Json) => preview({ ...root, ...patch });
  const commit = (patch: Json) => save({ ...root, ...patch });
  const liveLine = (patch: Json) => preview(editLine(root, patch, kind, paired, paired));
  const commitLine = (patch: Json) => save(editLine(root, patch, kind, paired, paired), paired ? undefined : kind);

  const y = num(root.y, 86);
  const anchor: Anchor = root.verticalAlign === 'top' || root.verticalAlign === 'bottom' ? root.verticalAlign : 'center';
  const place = y <= 20 ? 'top' : y >= 80 ? 'bottom' : 'middle';
  const timing = asObject(root.displayTiming);
  const lineName = kind === 'translation' ? S.translation : S.original;
  const overrides = paired ? lineOverrides(root, kind) : 0;
  const size = lineSize(root, kind, paired);
  const source = sharing.find((c) => c.kind === 'original') ?? (own === 'original' ? chip : undefined);
  const revertRatio = (
    <ActionButton isQuiet size="S" isDisabled={disabled} onPress={() => save(followRatio(root, kind))}>
      {S.followRatio}
    </ActionButton>
  );
  const sizeNote = !paired ? null : size.explicit ? (
    <div className={noteRow}>
      <div className={noteText}>
        <Note>{kind === 'translation' ? S.ratioOwn(fixed(size.size, 1)) : S.originalOwn(fixed(size.size, 1))}</Note>
      </div>
      {revertRatio}
    </div>
  ) : kind === 'translation' ? (
    <Note>
      {S.ratio(fixed(size.root, 1), fixed(size.bi, 3), fixed(size.orig, 1), source?.name ?? S.original, fixed(size.size, 1), fixed(size.k, 2))}
    </Note>
  ) : (
    <Note>{S.originalChain}</Note>
  );

  return (
    <>
      {videoId && chip ? (
        <div className={actions}>
          <Button
            variant="secondary"
            size="S"
            onPress={() => openCaptionStyles(chip.key)}>
            {S.open}
          </Button>
        </div>
      ) : null}
      <SecHead first aside={record ? record.name : IC.defaultStyle}>
        {IC.textStyle}
      </SecHead>
      <Sec>
        {paired ? (
          <>
            <PRow label={S.lineSwitch}>
              <Seg<LineKind> label={S.lineSwitch} value={kind} options={LINES} onChange={(next) => setPicked({ itemId: item.id, kind: next })} />
            </PRow>
            <div className={noteRow}>
              <div className={noteText}>
                <Note>{overrides ? S.lineOwn(lineName, overrides) : S.lineShared(lineName)}</Note>
              </div>
              {overrides ? (
                <ActionButton isQuiet size="S" isDisabled={disabled} onPress={() => save(followShared(root, kind))}>
                  {S.followShared}
                </ActionButton>
              ) : null}
            </div>
          </>
        ) : null}
        <TextStyleEditor
          style={lineView(root, kind, paired)}
          isDisabled={disabled}
          onLive={liveLine}
          onCommit={commitLine}
          caption
          sizeNote={sizeNote}
        />
      </Sec>
      <SecHead>{IC.position}</SecHead>
      <Sec>
        <PRow label={S.place}>
          <Seg
            label={S.place}
            value={place}
            options={S.places}
            isDisabled={disabled}
            onChange={(key) => {
              const next = S.places.find((p) => p.key === key)!;
              commit({ y: next.y, verticalAlign: next.valign });
            }}
          />
        </PRow>
        <ValueRow
          label={S.fromTop}
          value={y}
          min={0}
          max={100}
          unit="%"
          isDisabled={disabled}
          onLive={(v) => live({ y: v })}
          onCommit={(v) => commit({ y: v })}
        />
        <PRow label={S.anchor}>
          <Seg label={S.anchor} value={anchor} options={S.anchors} isDisabled={disabled} onChange={(verticalAlign) => commit({ verticalAlign })} />
        </PRow>
        <Note>{S.anchorHint[anchor]}</Note>
        <ValueRow
          label={IC.horizontalPos}
          value={num(root.x, 50)}
          min={0}
          max={100}
          unit="%"
          isDisabled={disabled}
          onLive={(v) => live({ x: v })}
          onCommit={(v) => commit({ x: v })}
        />
        <ValueRow
          label={IC.widthLabel}
          value={num(root.width, 80)}
          min={30}
          max={100}
          unit="%"
          isDisabled={disabled}
          onLive={(v) => live({ width: v })}
          onCommit={(v) => commit({ width: v })}
        />
      </Sec>
      {paired ? (
        <>
          <SecHead>{IC.bilingual}</SecHead>
          <Sec>
            <PRow label={IC.order}>
              <Seg
                label={IC.bilingualOrder}
                value={root.order === 'orig' ? 'orig' : 'trans'}
                options={ORDERS}
                isDisabled={disabled}
                onChange={(order) => commit({ order })}
              />
            </PRow>
            <ValueRow
              label={IC.lineGap}
              value={num(root.gap, 6)}
              min={0}
              max={40}
              isDisabled={disabled}
              onLive={(gap) => live({ gap })}
              onCommit={(gap) => commit({ gap })}
            />
          </Sec>
        </>
      ) : null}
      <SecHead aside={IC.displayAside}>{IC.display}</SecHead>
      <Sec>
        <ValueRow
          label={IC.lead}
          value={num(timing.leadIn, 0.5)}
          min={0}
          max={2}
          step={0.1}
          digits={1}
          unit={IC.seconds}
          isDisabled={disabled}
          onLive={(leadIn) => live({ displayTiming: { ...timing, leadIn } })}
          onCommit={(leadIn) => commit({ displayTiming: { ...timing, leadIn } })}
        />
        <ValueRow
          label={IC.lag}
          value={num(timing.tail, 1)}
          min={0}
          max={3}
          step={0.1}
          digits={1}
          unit={IC.seconds}
          isDisabled={disabled}
          onLive={(tail) => live({ displayTiming: { ...timing, tail } })}
          onCommit={(tail) => commit({ displayTiming: { ...timing, tail } })}
        />
        <PRow label={IC.punctuation}>
          <Switch size="S" isSelected={root.punct !== false} isDisabled={disabled} onChange={(punct) => commit({ punct })}>
            {IC.punctToSpace}
          </Switch>
        </PRow>
        <Note>{S.remembered}</Note>
      </Sec>
      <Tail {...props} />
    </>
  );
}

function Tail(props: ItemPageProps<CaptionItem>) {
  return (
    <>
      <TimeSection {...props} />
      <DeleteItem {...props} />
    </>
  );
}
