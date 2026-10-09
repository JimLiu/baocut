import { useCaptionPreferences } from '../../state/caption-preferences-store.ts';
import { useState, type ReactNode } from 'react';
import type { DocumentRecord, EditOperation, Id, Sequence, TransactionReceipt } from '@baocut/protocol';
import { AlertDialog, DialogContainer, ProgressCircle, ToastQueue, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import Close from '@react-spectrum/s2/icons/Close';
import Lock from '@react-spectrum/s2/icons/Lock';
import VisibilityOff from '@react-spectrum/s2/icons/VisibilityOff';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton, Focusable } from 'react-aria-components';
import { currentPreset } from '../../model/caption-presets.ts';
import { dropOperations, flipTarget, onScreen, putBackOperations, type CaptionChip } from '../../model/caption-tracks.ts';
import { DEFAULT_CAPTION_STYLE, captionStyleRoot, patchCaptionStyle } from '../../model/property-values.ts';
import type { LineKind } from '../../render/text-style.ts';
import { useEditor } from '../../state/editor-store.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { CaptionThumb, openGallery } from './caption-gallery.tsx';
import { draftedBody } from './draft-documents.ts';
import { useEditorActions } from './editor-context.tsx';
import { CAPTION_STYLE_COPY as S, SUBTITLE_COPY as C } from './subtitle-copy.ts';
import { useDocumentBody } from './use-document-body.ts';
import { TRANSLATE_COPY as T } from './translate-copy.ts';

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
  /** 「＋ 翻译成…」：推进翻译设置页；不给时这颗钮看得见、按了不动。 */
  onTranslate?: () => void;
  /** 正在翻的那门：语言名、百分比（Runtime 没报总数时 null）、正在做的那一步。 */
  running?: { label: string; percent: number | null; step: string } | null;
  /** 画廊页头下面那一条：只要轨条，不要入口卡与「更换样式」。 */
  noCard?: boolean;
}) {
  const { apply, undo } = useEditorActions();
  const editable = useVideo((s) => canEdit(s.video));
  const [ask, setAsk] = useState<{ chip: CaptionChip; count: number; operations: EditOperation[] } | null>(null);
  const showing = onScreen(chips);
  const shelved = chips.filter((c) => c.state === 'shelved');
  const visible = chips.filter((c) => c.state === 'on').length;
  const current = chips.find((c) => c.key === selected) ?? showing[0] ?? null;
  const styleRecord = current?.styleDocumentId ? documents[current.styleDocumentId] : undefined;
  const videoId = useVideo((s) => s.video?.videoId ?? null);

  // 入口卡的缩略图与名字：当下这条用的样式，画它管的几行（共用这份样式、在画面上的）。
  const styleLoaded = useDocumentBody(styleRecord);
  const draft = useEditor((s) => s.documentDraft);
  const styleBody = styleRecord ? draftedBody(draft, styleRecord.id, styleRecord.currentRevision, styleLoaded) : DEFAULT_CAPTION_STYLE;
  const styleRoot = styleBody === undefined ? null : captionStyleRoot(styleBody);
  const sharing = new Set(
    showing.filter((c) => (current?.styleDocumentId ? c.styleDocumentId === current.styleDocumentId : c.key === current?.key)).map((c) => c.kind),
  );
  const styleKinds = (['original', 'translation'] as const).filter((kind): kind is LineKind => sharing.has(kind));
  const styleName = (styleRoot && currentPreset(styleRoot, styleKinds)?.name) ?? styleRecord?.name ?? C.defaultStyle;

  // 倒转：原文与译文共用的那份样式文档（没有时传 undefined，hook 照常调用）。
  const flipId = flipTarget(chips);
  const flipRecord = flipId ? documents[flipId] : undefined;
  const flipBody = useDocumentBody(flipRecord);
  const flipRoot = flipBody === undefined ? null : captionStyleRoot(flipBody);

  const toastUndo = (message: string, receipt: TransactionReceipt) =>
    ToastQueue.positive(message, {
      timeout: 5000,
      actionLabel: C.undo,
      onAction: () => void undo({ transaction: receipt.transactionId }),
      shouldCloseOnAction: true,
    });

  const drop = async (target: CaptionChip) => {
    const result = dropOperations(sequence, chips, target);
    if ('refused' in result) {
      ToastQueue.neutral(C.dropLast, { timeout: 4000 });
      return;
    }
    const receipt = await apply(result.operations, C.dropLabel);
    if (receipt) toastUndo(C.dropped(target.name), receipt);
  };
  const land = async (target: CaptionChip, operations: EditOperation[], message: string) => {
    const receipt = await apply(operations, C.landLabel);
    if (receipt) toastUndo(message, receipt);
  };
  const putBack = (target: CaptionChip) => {
    const result = putBackOperations(sequence, chips, target);
    if (result.confirm) setAsk({ chip: target, count: result.confirm, operations: result.operations });
    else void land(target, result.operations, C.putBack(target.name));
  };
  const flip = async () => {
    if (!flipRecord || flipBody === undefined || !flipRoot) return;
    const translationFirst = (flipRoot.order ?? 'trans') === 'trans';
    const body = patchCaptionStyle(flipBody, { order: translationFirst ? 'orig' : 'trans' });
    const receipt = await apply([{ type: 'putDocument', documentId: flipRecord.id, kind: flipRecord.kind, body }], C.flipLabel);
    if (receipt) {
      useCaptionPreferences.getState().remember(flipRoot, captionStyleRoot(body)!);
      toastUndo(C.flipped(!translationFirst), receipt);
    }
  };
  /** 入口卡：选中当下这条字幕的实例，侧栏随之切到属性页（字幕样式）。 */
  const openStyle = () => {
    const itemId = current?.itemIds[0];
    if (!itemId) return;
    useEditor.getState().select([itemId]);
    useEditor.getState().showPanel('props');
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
        {showing.map((c) => {
          const isOn = c.key === current?.key;
          const isOff = c.state === 'off';
          return (
            <span key={c.key} className={chip({ isOn, isOff })}>
              <TooltipTrigger delay={500}>
                <RACButton
                  className={({ isHovered, isFocusVisible }) => chipPart({ isHovered, isFocusVisible, isOn })}
                  aria-pressed={isOn}
                  onPress={() => onSelect(c.key)}>
                  {isOff ? <VisibilityOff /> : c.locked ? <Lock /> : null}
                  {c.label}
                </RACButton>
                <Tooltip>{isOff ? C.chipOff : c.locked ? C.chipLocked : C.chipPick}</Tooltip>
              </TooltipTrigger>
              {/* 只剩一条时不给 ×（设计稿 `last`）；锁住的拿不下来。 */}
              {showing.length < 2 || c.locked ? null : (
                <TooltipTrigger delay={500}>
                  <RACButton
                    className={({ isHovered, isFocusVisible }) => chipClose({ isHovered, isFocusVisible, isOn })}
                    aria-label={C.drop(c.name)}
                    isDisabled={!editable}
                    onPress={() => void drop(c)}>
                    <Close />
                  </RACButton>
                  <Tooltip>{C.dropTip}</Tooltip>
                </TooltipTrigger>
              )}
            </span>
          );
        })}
        {shelved.map((c) => (
          <TooltipTrigger key={c.key} delay={500}>
            <RACButton
              className={({ isHovered, isFocusVisible, isDisabled }) => ghost({ isHovered, isFocusVisible, isDisabled })}
              isDisabled={!editable || c.locked}
              onPress={() => putBack(c)}>
              <Add />
              {c.label}
            </RACButton>
            <Tooltip>{c.locked ? C.chipLocked : C.putBackTip(c.name, showing.length >= 2)}</Tooltip>
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
        ) : (
          <SoftDisabled className={ghost({ isDisabled: true })} tip={C.translateOff}>
            <Add />
            {C.translate}
          </SoftDisabled>
        )}
        {showing.length >= 2 ? (
          flipRoot && editable ? (
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
      <DialogContainer onDismiss={() => setAsk(null)}>
        {ask ? (
          <AlertDialog
            variant="confirmation"
            title={C.stackTitle(ask.count)}
            primaryActionLabel={C.stackConfirm}
            cancelLabel={C.cancelLabel}
            onPrimaryAction={() => void land(ask.chip, ask.operations, C.stacked(ask.chip.name, ask.count))}>
            {C.stackBody(ask.chip.name, ask.count)}
          </AlertDialog>
        ) : null}
      </DialogContainer>
    </div>
  );
}
