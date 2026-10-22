import { useCaptionPreferences } from '../../state/caption-preferences-store.ts';
import { useMemo, useState, type ReactNode } from 'react';
import type { DocumentRecord, EditOperation, Id, Sequence, TransactionReceipt } from '@baocut/protocol';
import { EditLabel } from '@baocut/protocol/messages/ui';
import { AlertDialog, DialogContainer, Picker, PickerItem, ProgressCircle, ToastQueue, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import Close from '@react-spectrum/s2/icons/Close';
import Lock from '@react-spectrum/s2/icons/Lock';
import VisibilityOff from '@react-spectrum/s2/icons/VisibilityOff';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton, Focusable } from 'react-aria-components';
import { currentPreset } from '../../model/caption-presets.ts';
import {
  captionGroups,
  captionKindLabel,
  dropOperations,
  flipTargets,
  groupOf,
  onScreen,
  putBackOperations,
  segmentAt,
  segmentSource,
  startOf,
  type CaptionChip,
  type CaptionGroup,
} from '../../model/caption-tracks.ts';
import { formatClock } from '../../model/format.ts';
import { unbuiltOriginals } from '../../model/translation-cues.ts';
import { DEFAULT_CAPTION_STYLE, captionStyleRoot, patchCaptionStyle } from '../../model/property-values.ts';
import type { LineKind } from '../../render/text-style.ts';
import { useEditor } from '../../state/editor-store.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { openGallery } from './caption-gallery.tsx';
import { CaptionThumb } from './caption-thumb.tsx';
import { draftedBody } from './draft-documents.ts';
import { useEditorActions } from './editor-context.tsx';
import { CAPTION_STYLE_COPY as S, SUBTITLE_COPY as C } from './subtitle-copy.ts';
import { useDocumentBodies, useDocumentBody } from './use-document-body.ts';
import { TRANSLATE_COPY as T } from './translate-copy.ts';
import { generateFromSpeech, useSubtitleRun } from './transcribe-run.ts';

const home = style({
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 0,
  gap: 8,
  paddingX: 12,
  paddingY: 8,
  borderTopWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderBottomWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
/** 样式入口卡（原型 .substyle-entry）：左边一块按当下涂装画的缩略图（原型 `SubThumb` fz 10），右边是样式名与提示。 */
const entry = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: 'full',
  minWidth: 0,
  boxSizing: 'border-box',
  padding: 8,
  textAlign: 'start',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: { default: 'gray-300', isHovered: 'blue-800' },
  borderRadius: 'lg',
  backgroundColor: { default: 'gray-50', isHovered: 'blue-100' },
  color: 'gray-900',
  cursor: 'pointer',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  transition: 'default',
});
const entryPreview = style({ flexShrink: 0, width: 88, height: 48, borderRadius: 'default', overflow: 'hidden' });
const entryCopy = style({ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0 });
const entryName = style({ font: 'ui-sm', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const entryHint = style({ font: 'ui-xs', color: 'blue-900' });
const entryChevron = style({ display: 'flex', flexShrink: 0, '--iconPrimary': { type: 'fill', value: 'gray-600' } });
const strip = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '[6px]' });
const stripLabel = style({ flexShrink: 0, font: 'ui-xs', color: 'gray-600' });
/** 一枚 chip（原型 .subtrk）：名字与 × 各是一颗钮，外层是 span（钮里不能套钮）。 */
const chip = style({
  display: 'inline-flex',
  alignItems: 'center',
  flexShrink: 0,
  height: 24,
  borderRadius: 'default',
  overflow: 'hidden',
  backgroundColor: { default: 'gray-100', isOn: 'blue-200' },
  font: 'ui-sm',
  color: { default: 'gray-700', isOn: 'blue-1000', isOff: 'gray-500' },
  fontWeight: 'medium',
  whiteSpace: 'nowrap',
});
const chipPart = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 24,
  paddingX: 8,
  borderWidth: 0,
  backgroundColor: { default: 'transparent', isHovered: { default: 'gray-200', isOn: 'blue-300' } },
  font: 'ui-sm',
  color: 'inherit',
  fontWeight: 'medium',
  cursor: 'pointer',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: -2,
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const chipClose = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 24,
  marginStart: -4,
  padding: 0,
  borderWidth: 0,
  backgroundColor: { default: 'transparent', isHovered: { default: 'gray-200', isOn: 'blue-300' } },
  color: { default: 'gray-500', isHovered: 'gray-800' },
  cursor: 'pointer',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: -2,
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
/** 几段并成一组时名字后面的段数。 */
const chipCount = style({ font: 'ui-xs', color: { default: 'gray-600', isOn: 'blue-900' }, fontWeight: 'normal' });
/** 选中的组有几段时，轨条下面那一行：列表校对哪一段。 */
const segmentRow = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });
const segmentPicker = style({ flexGrow: 1, minWidth: 0 });
/** 虚线的幽灵 chip（原型 .subtrk--ghost）：拿下的放回、翻译成…。 */
const ghost = style({
  display: 'inline-flex',
  alignItems: 'center',
  flexShrink: 0,
  gap: 4,
  height: 24,
  boxSizing: 'border-box',
  paddingStart: '[6px]',
  paddingEnd: 8,
  borderRadius: 'default',
  borderWidth: 1,
  borderStyle: 'dashed',
  borderColor: { default: 'gray-400', isHovered: 'blue-800', isDisabled: 'gray-300' },
  backgroundColor: { default: 'transparent', isHovered: 'blue-100', isDisabled: 'transparent' },
  font: 'ui-sm',
  color: { default: 'gray-600', isHovered: 'blue-1000', isDisabled: 'gray-400' },
  fontWeight: 'medium',
  whiteSpace: 'nowrap',
  cursor: { default: 'pointer', isDisabled: 'default' },
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
/** 「倒转 ⇅」（原型 .stlink）。 */
const link = style({
  flexShrink: 0,
  padding: 0,
  borderWidth: 0,
  backgroundColor: 'transparent',
  font: 'ui-xs',
  fontWeight: 'medium',
  color: { default: 'blue-1000', isDisabled: 'gray-400' },
  textDecoration: { default: 'none', isHovered: 'underline', isDisabled: 'none' },
  cursor: { default: 'pointer', isDisabled: 'default' },
  borderRadius: 'sm',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
});
/** 正在翻的那门（原型 model-sublist.js 的「翻译中」候选）：还没落轨，只是一枚带进度的 chip。 */
const runningChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  flexShrink: 0,
  gap: '[6px]',
  height: 24,
  paddingX: 8,
  borderRadius: 'default',
  backgroundColor: 'blue-100',
  font: 'ui-sm',
  color: 'blue-1000',
  fontWeight: 'medium',
  whiteSpace: 'nowrap',
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
});

/** 还不能用的入口：看得见、聚焦得到、悬停说原因，按了不动（S2 的禁用按钮不出提示）。 */
function SoftDisabled({ className, tip, children }: { className: string; tip: string; children: ReactNode }) {
  return (
    <TooltipTrigger delay={300}>
      <Focusable>
        <span role="button" tabIndex={0} aria-disabled="true" className={className}>
          {children}
        </span>
      </Focusable>
      <Tooltip>{tip}</Tooltip>
    </TooltipTrigger>
  );
}

/**
 * 字幕 Tab 主页顶上那一块（原型 panel-substrip.jsx `SubStyleEntry` + `SubTrackStrip`，拿下 / 放回的规矩见 subtrack.jsx）：
 * 样式入口卡与「画面上」的字幕轨条。轨条是这一页唯一的「编辑哪一份字幕」选择器。
 */
export function SubtitleStrip({
  sequence,
  documents,
  chips,
  selected,
  onSelect,
  onTranslate,
  running,
  noCard,
}: {
  sequence: Sequence;
  documents: Record<Id, DocumentRecord>;
  chips: CaptionChip[];
  /** 当下的编辑对象（chip 的 key）。 */
  selected: string | null;
  onSelect(key: string): void;
  /** 「＋ 翻译成…」：推进翻译设置页；不给时不画。 */
  onTranslate?: () => void;
  /** 正在翻的那门：语言名、百分比（Runtime 没报总数时 null）、正在做的那一步。 */
  running?: { label: string; percent: number | null; step: string } | null;
  /** 画廊页头下面那一条：只要轨条，不要入口卡与「更换样式」。 */
  noCard?: boolean;
}) {
  const { apply, undo } = useEditorActions();
  const editable = useVideo((s) => canEdit(s.video));
  const [ask, setAsk] = useState<{ group: CaptionGroup; count: number; operations: EditOperation[] } | null>(null);
  // 轨条按组画：同是原文（或译文）、同一门语言的几份并成一枚，纪录片一段素材一份字幕时不至于碎成几十枚。
  const groups = useMemo(() => captionGroups(sequence, chips, documents), [sequence, chips, documents]);
  const showing = onScreen(groups);
  const shelved = groups.filter((g) => g.state === 'shelved');
  const visible = groups.filter((g) => g.state === 'on').length;
  const current = chips.find((c) => c.key === selected) ?? onScreen(chips)[0] ?? null;
  const currentGroup = groupOf(groups, current?.key);
  const segments = currentGroup ? onScreen(currentGroup.segments) : [];
  const styleRecord = current?.styleDocumentId ? documents[current.styleDocumentId] : undefined;
  const videoId = useVideo((s) => s.video?.videoId ?? null);
  // 翻译时只显示了译文、原文还没做成字幕层：虚线「原文」chip，点了用转写建一层，与译文共用样式叠成双语（product-design §5.9「字幕属性」）。
  const unbuilt = useMemo(() => unbuiltOriginals(chips, documents), [chips, documents]);
  const building = useSubtitleRun((s) => !!videoId && !!s.runs[videoId]);

  // 入口卡的缩略图与名字：当下这条用的样式，画它管的几行（共用这份样式、在画面上的）。
  const styleLoaded = useDocumentBody(styleRecord);
  const draft = useEditor((s) => s.documentDraft);
  const styleBody = styleRecord ? draftedBody(draft, styleRecord.id, styleRecord.currentRevision, styleLoaded) : DEFAULT_CAPTION_STYLE;
  const styleRoot = styleBody === undefined ? null : captionStyleRoot(styleBody);
  const sharing = new Set(
    onScreen(chips).filter((c) => (current?.styleDocumentId ? c.styleDocumentId === current.styleDocumentId : c.key === current?.key)).map((c) => c.kind),
  );
  const styleKinds = (['original', 'translation'] as const).filter((kind): kind is LineKind => sharing.has(kind));
  const styleName = (styleRoot && currentPreset(styleRoot, styleKinds)?.name) ?? styleRecord?.name ?? C.defaultStyle;

  // 倒转：原文与译文共用的那几份样式文档（每段素材一对时有几份），以第一份的次序为准一起改。
  const flipRecords = flipTargets(chips).flatMap((id) => (documents[id] ? [documents[id]] : []));
  const flipBodies = useDocumentBodies(flipRecords);
  const flipBody = flipBodies[0];
  const flipRoot = flipBody === undefined ? null : captionStyleRoot(flipBody);
  const flipReady = !!flipRoot && flipBodies.every((body) => body !== undefined);

  /** 提示里的全名：一段的组用文档名，几段的组用组名。 */
  const nameOf = (group: CaptionGroup) => (group.segments.length === 1 ? group.segments[0]!.name : group.label);
  /** 一段在时间线上开始的秒数。 */
  const segmentStart = (segment: CaptionChip) => {
    const from = startOf(segment, sequence);
    return Number.isFinite(from) ? (from * sequence.fps.den) / sequence.fps.num : 0;
  };
  const toastUndo = (message: string, receipt: TransactionReceipt) =>
    ToastQueue.positive(message, {
      timeout: 5000,
      actionLabel: C.undo,
      onAction: () => void undo({ transaction: receipt.transactionId }),
      shouldCloseOnAction: true,
    });

  const drop = async (target: CaptionGroup) => {
    const result = dropOperations(sequence, groups, target);
    if ('refused' in result) {
      ToastQueue.neutral(C.dropLast, { timeout: 4000 });
      return;
    }
    const receipt = await apply(result.operations, EditLabel.dropSubtitle());
    if (receipt) toastUndo(C.dropped(nameOf(target)), receipt);
  };
  const land = async (operations: EditOperation[], message: string) => {
    const receipt = await apply(operations, EditLabel.landSubtitle());
    if (receipt) toastUndo(message, receipt);
  };
  const putBack = (target: CaptionGroup) => {
    const result = putBackOperations(sequence, groups, target);
    if (result.confirm) setAsk({ group: target, count: result.confirm, operations: result.operations });
    else void land(result.operations, C.putBack(nameOf(target)));
  };
  /** 点一组：之前选的那段还在组里就留着，否则校对盖住播放头的那段。 */
  const pick = (group: CaptionGroup) => {
    const { playhead } = useEditor.getState();
    onSelect(segmentAt(group, sequence, Math.round((playhead * sequence.fps.num) / sequence.fps.den), selected).key);
  };
  const flip = async () => {
    if (!flipReady || !flipRoot) return;
    const translationFirst = (flipRoot.order ?? 'trans') === 'trans';
    const order = translationFirst ? 'orig' : 'trans';
    const operations = flipRecords.map(
      (record, i): EditOperation => ({ type: 'putDocument', documentId: record.id, kind: record.kind, body: patchCaptionStyle(flipBodies[i], { order }) }),
    );
    const receipt = await apply(operations, EditLabel.flipSubtitle());
    if (receipt) {
      const first = operations[0];
      if (first?.type === 'putDocument') useCaptionPreferences.getState().remember(flipRoot, captionStyleRoot(first.body)!);
      toastUndo(C.flipped(!translationFirst), receipt);
    }
  };
  /** 入口卡：打开当前字幕轨的样式列表，卡上的铅笔才进入属性页。 */
  const openStyle = () => {
    if (videoId) openGallery(videoId, true);
  };

  return (
    <div className={home}>
      {current && !noCard ? (
        <RACButton className={({ isHovered, isFocusVisible }) => entry({ isHovered, isFocusVisible })} aria-label={C.styleEntryLabel} onPress={openStyle}>
          {styleRoot ? (
            <span className={entryPreview}>
              <CaptionThumb root={styleRoot} kinds={styleKinds} px={10} />
            </span>
          ) : null}
          <span className={entryCopy}>
            <span className={entryName}>{styleName}</span>
            <span className={entryHint}>{C.styleEntry(visible)}</span>
          </span>
          <span className={entryChevron}>
            <ChevronRight />
          </span>
        </RACButton>
      ) : null}
      <div className={strip}>
        <span className={stripLabel}>{C.onScreen}</span>
        {showing.map((g) => {
          const isOn = g.key === currentGroup?.key;
          const isOff = g.state === 'off';
          const count = onScreen(g.segments).length;
          return (
            <span key={g.key} className={chip({ isOn, isOff })}>
              <TooltipTrigger delay={500}>
                <RACButton
                  className={({ isHovered, isFocusVisible }) => chipPart({ isHovered, isFocusVisible, isOn })}
                  aria-pressed={isOn}
                  aria-label={count > 1 ? `${g.label} · ${count}` : undefined}
                  onPress={() => pick(g)}>
                  {isOff ? <VisibilityOff /> : g.locked ? <Lock /> : null}
                  {g.label}
                  {count > 1 ? <span className={chipCount({ isOn })}>{count}</span> : null}
                </RACButton>
                <Tooltip>{isOff ? C.chipOff : g.locked ? C.chipLocked : count > 1 ? C.groupPick(count) : C.chipPick}</Tooltip>
              </TooltipTrigger>
              {/* 只剩一组时不给 ×（设计稿 `last`）；有一段锁住的拿不下来。 */}
              {showing.length < 2 || g.locked ? null : (
                <TooltipTrigger delay={500}>
                  <RACButton
                    className={({ isHovered, isFocusVisible }) => chipClose({ isHovered, isFocusVisible, isOn })}
                    aria-label={C.drop(nameOf(g))}
                    isDisabled={!editable}
                    onPress={() => void drop(g)}>
                    <Close />
                  </RACButton>
                  <Tooltip>{C.dropTip}</Tooltip>
                </TooltipTrigger>
              )}
            </span>
          );
        })}
        {shelved.map((g) => (
          <TooltipTrigger key={g.key} delay={500}>
            <RACButton
              className={({ isHovered, isFocusVisible, isDisabled }) => ghost({ isHovered, isFocusVisible, isDisabled })}
              isDisabled={!editable || g.locked}
              onPress={() => putBack(g)}>
              <Add />
              {g.label}
            </RACButton>
            <Tooltip>{g.locked ? C.chipLocked : C.putBackTip(nameOf(g), showing.length >= 2)}</Tooltip>
          </TooltipTrigger>
        ))}
        {unbuilt.map((u) => (
          <TooltipTrigger key={u.speechDocumentId} delay={500}>
            <RACButton
              className={({ isHovered, isFocusVisible, isDisabled }) => ghost({ isHovered, isFocusVisible, isDisabled })}
              isDisabled={!editable || !videoId || building}
              onPress={() => {
                // 字幕文档按素材名起名，与「生成字幕」一致；素材不在快照里时退回转写的名字。
                const asset = useVideo.getState().video?.state?.video.assets[u.assetId];
                if (videoId) void generateFromSpeech(videoId, { id: u.assetId, name: asset?.name ?? u.name }, u.speechDocumentId);
              }}>
              <Add />
              {unbuilt.length > 1 ? `${captionKindLabel('original')} · ${u.name}` : captionKindLabel('original')}
            </RACButton>
            <Tooltip>{C.buildOriginalTip(groupOf(groups, u.translation.key)?.label ?? u.translation.label)}</Tooltip>
          </TooltipTrigger>
        ))}
        {running ? (
          <TooltipTrigger delay={300}>
            <Focusable>
              <span role="status" tabIndex={0} className={runningChip}>
                <ProgressCircle
                  size="S"
                  aria-label={C.translatingLabel(running.label)}
                  isIndeterminate={running.percent === null}
                  {...(running.percent === null ? {} : { value: running.percent })}
                />
                {running.percent === null ? running.label : `${running.label} ${running.percent}%`}
              </span>
            </Focusable>
            <Tooltip>{T.chipTip(running.step)}</Tooltip>
          </TooltipTrigger>
        ) : null}
        {onTranslate ? (
          <TooltipTrigger delay={500}>
            <RACButton className={({ isHovered, isFocusVisible }) => ghost({ isHovered, isFocusVisible })} onPress={onTranslate}>
              <Add />
              {C.translate}
            </RACButton>
            <Tooltip>{C.translateTip}</Tooltip>
          </TooltipTrigger>
        ) : null}
        {showing.length >= 2 ? (
          flipReady && editable ? (
            <TooltipTrigger delay={500}>
              <RACButton className={({ isHovered, isFocusVisible }) => link({ isHovered, isFocusVisible })} onPress={() => void flip()}>
                {C.flip}
              </RACButton>
              <Tooltip>{C.flipTip}</Tooltip>
            </TooltipTrigger>
          ) : (
            <SoftDisabled className={link({ isDisabled: true })} tip={C.flipOff}>
              {C.flip}
            </SoftDisabled>
          )
        ) : null}
        {current && !noCard && videoId ? (
          <TooltipTrigger delay={500}>
            <RACButton className={({ isHovered, isFocusVisible }) => link({ isHovered, isFocusVisible })} onPress={() => openGallery(videoId, true)}>
              {S.open}
            </RACButton>
            <Tooltip>{S.openTip}</Tooltip>
          </TooltipTrigger>
        ) : null}
      </div>
      {currentGroup && current && segments.length > 1 ? (
        <div className={segmentRow}>
          <span className={stripLabel}>{C.segment}</span>
          <Picker
            aria-label={C.segmentPick}
            size="S"
            styles={segmentPicker}
            selectedKey={current.key}
            onSelectionChange={(key) => key !== null && onSelect(String(key))}>
            {segments.map((c) => {
              const text = `${formatClock(segmentStart(c))} · ${segmentSource(c, documents)}`;
              return (
                <PickerItem key={c.key} id={c.key} textValue={text}>
                  {text}
                </PickerItem>
              );
            })}
          </Picker>
        </div>
      ) : null}
      <DialogContainer onDismiss={() => setAsk(null)}>
        {ask ? (
          <AlertDialog
            variant="confirmation"
            title={C.stackTitle(ask.count)}
            primaryActionLabel={C.stackConfirm}
            cancelLabel={C.cancelLabel}
            onPrimaryAction={() => void land(ask.operations, C.stacked(nameOf(ask.group), ask.count))}>
            {C.stackBody(nameOf(ask.group), ask.count)}
          </AlertDialog>
        ) : null}
      </DialogContainer>
    </div>
  );
}
