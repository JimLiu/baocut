import { useCaptionPreferences } from '../../state/caption-preferences-store.ts';
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DocumentRecord, Id, Sequence } from '@baocut/protocol';
import { ActionButton, ToastQueue, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import Checkmark from '@react-spectrum/s2/icons/Checkmark';
import Edit from '@react-spectrum/s2/icons/Edit';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton } from 'react-aria-components';
import { create } from 'zustand';
import {
  applyPreset,
  captionStyleOperations,
  galleryTarget,
  presetGroups,
  presetOn,
  type CaptionPreset,
  type PresetScope,
} from '../../model/caption-presets.ts';
import { onScreen, type CaptionChip } from '../../model/caption-tracks.ts';
import { DEFAULT_CAPTION_STYLE, captionStyleRoot } from '../../model/property-values.ts';
import { asObject, type Json, type LineKind } from '../../render/text-style.ts';
import { useEditor } from '../../state/editor-store.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { CaptionThumb } from './caption-thumb.tsx';
import { draftedBody, dropStaleDraft } from './draft-documents.ts';
import { useEditorActions } from './editor-context.tsx';
import { Note, SecHead, Seg } from './inspector-controls.tsx';
import { PanelHead, panelBody } from './panel-head.tsx';
import { CAPTION_STYLE_COPY as S } from './subtitle-copy.ts';
import { useDocumentBody } from './use-document-body.ts';
import { SUBTITLE_COPY as C } from './subtitle-copy.ts';

/** 画廊开着的视频（推进来的一页，同翻译设置页 `openFlow`）。 */
export const useCaptionGallery = create<{ open: Record<Id, true> }>(() => ({ open: {} }));

export function openGallery(videoId: Id, open: boolean): void {
  useCaptionGallery.setState((s) => {
    const next = { ...s.open };
    if (open) next[videoId] = true;
    else delete next[videoId];
    return { open: next };
  });
}

const scopeRow = style({ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, paddingX: 12, paddingTop: 8 });
const scopeLabel = style({ flexShrink: 0, font: 'ui-xs', color: 'gray-600' });
const grid = style({ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 });
/** 一张卡（原型 .scard）：圆角 10、细边，选中的 2px 蓝边。 */
const card = style({
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  borderRadius: 'lg',
  overflow: 'hidden',
  backgroundColor: 'gray-25',
  outlineStyle: 'solid',
  outlineWidth: { default: 1, isOn: 2 },
  outlineOffset: { default: -1, isOn: -2 },
  outlineColor: { default: 'gray-200', ':hover': 'gray-400', isOn: 'blue-800' },
  transition: 'default',
});
const thumbButton = style({
  position: 'relative',
  display: 'block',
  width: 'full',
  height: 66,
  padding: 0,
  borderWidth: 0,
  backgroundColor: 'transparent',
  cursor: { default: 'pointer', isDisabled: 'default' },
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: -2,
  transform: { default: 'none', isPressed: 'scale(0.96)' },
  transition: 'default',
});
const tick = style({
  position: 'absolute',
  top: '[6px]',
  insetEnd: '[6px]',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 18,
  height: 18,
  borderRadius: 'full',
  backgroundColor: 'blue-900',
  '--iconPrimary': { type: 'fill', value: 'gray-25' },
});
const tickIcon = iconStyle({ size: 'XS' });
const foot = style({ display: 'flex', alignItems: 'center', gap: 4, paddingY: 4, paddingStart: 8, paddingEnd: 4 });
const cardName = style({
  flexGrow: 1,
  minWidth: 0,
  font: 'ui-xs',
  color: 'gray-700',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
const hint = style({ marginTop: 16, marginBottom: 0, font: 'ui-xs', color: 'gray-600' });

function GalleryCard({
  preset,
  on,
  root,
  kinds,
  isDisabled,
  onPick,
  onEdit,
}: {
  preset: CaptionPreset;
  on: boolean;
  root: Json;
  kinds: readonly LineKind[];
  isDisabled: boolean;
  onPick(): void;
  onEdit(): void;
}) {
  return (
    <div className={card({ isOn: on })}>
      <RACButton
        className={({ isFocusVisible, isPressed, isDisabled: off }) => thumbButton({ isFocusVisible, isPressed, isDisabled: off })}
        aria-label={preset.name}
        aria-pressed={on}
        isDisabled={isDisabled}
        onPress={onPick}>
        <CaptionThumb root={root} kinds={kinds} px={13} />
        {on ? (
          <span className={tick}>
            <Checkmark styles={tickIcon} data-bc-icons="own" />
          </span>
        ) : null}
      </RACButton>
      <div className={foot}>
        <span className={cardName} title={preset.name}>
          {preset.name}
        </span>
        <TooltipTrigger delay={500}>
          <ActionButton isQuiet size="XS" aria-label={C.editPreset(preset.name)} isDisabled={isDisabled} onPress={onEdit}>
            <Edit />
          </ActionButton>
          <Tooltip>{S.edit}</Tooltip>
        </TooltipTrigger>
      </div>
    </div>
  );
}

/**
 * 字幕样式画廊（原型 panel-substyle.jsx `SubGallery`）：推进来的一页，页头下是「画面上」轨条，再是按分区陈列的卡。
 * 每张卡画的是套上去之后画面上这几行的样子；点卡 = 一笔事务套用（可撤销），卡上的「编辑」= 套上再去属性页逐项改。
 *
 * 套到哪份样式见 `galleryTarget`：原文与译文共用一份时「套到」能指到一行（写进那一行的覆盖）。
 */
export function CaptionGallery({
  videoId,
  sequence,
  documents,
  chips,
  selected,
  onBack,
  children,
}: {
  videoId: Id;
  sequence: Sequence;
  documents: Record<Id, DocumentRecord>;
  chips: CaptionChip[];
  selected: string | null;
  onBack(): void;
  /** 页头下的轨条。 */
  children: ReactNode;
}) {
  const { apply, undo } = useEditorActions();
  const editable = useVideo((s) => canEdit(s.video));
  const target = useMemo(() => galleryTarget(chips, selected), [chips, selected]);
  const record = target.styleDocumentId ? documents[target.styleDocumentId] : undefined;
  const loaded = useDocumentBody(record);
  const draft = useEditor((s) => s.documentDraft);
  const body = record ? draftedBody(draft, record.id, record.currentRevision, loaded) : DEFAULT_CAPTION_STYLE;
  useEffect(() => {
    if (record) dropStaleDraft(record.id, record.currentRevision, loaded);
  }, [record, loaded]);
  const root = body === undefined ? null : captionStyleRoot(body);

  // 「套到」：这份样式管两种行时才出；作用域是这一页自己的，不写进选中（原型第 152 轮）。
  const [picked, setPicked] = useState<PresetScope>('all');
  const scope: PresetScope = picked !== 'all' && target.kinds.includes(picked) ? picked : 'all';
  const showing = onScreen(chips);
  const labelOf = (kind: LineKind) =>
    showing.find((c) => c.kind === kind && (!c.styleDocumentId || c.styleDocumentId === target.styleDocumentId))?.label ??
    (kind === 'original' ? S.original : S.translation);
  const groups = useMemo(() => presetGroups(), []);
  const previews = useMemo(() => {
    const out = new Map<string, Json>();
    if (body === undefined || !root) return out;
    for (const group of groups) for (const preset of group.presets) out.set(preset.id, asObject(applyPreset(body, preset, scope).style));
    return out;
  }, [body, root, groups, scope]);
  const kindsKey = target.kinds.join(',');
  const kinds = useMemo(() => (kindsKey ? (kindsKey.split(',') as LineKind[]) : []), [kindsKey]);
  const onCard = (preset: CaptionPreset) => !!root && presetOn(root, preset, scope === 'all' ? kinds : [scope]);

  const current = chips.find((c) => c.key === selected && c.state !== 'shelved') ?? showing[0] ?? null;
  const disabled = !editable || !root;

  const pick = async (preset: CaptionPreset): Promise<boolean> => {
    if (disabled || body === undefined) return false;
    const next = applyPreset(body, preset, scope);
    if (record) useEditor.getState().setDocumentDraft({ documentId: record.id, baseRevision: record.currentRevision, body: next });
    const receipt = await apply(captionStyleOperations(sequence, record, next), C.applyStyleLabel);
    if (!receipt) {
      useEditor.getState().clearDrafts();
      return false;
    }
    useCaptionPreferences.getState().remember(root!, asObject(next.style));
    const others = kinds.filter((kind) => kind !== scope).map(labelOf);
    const message =
      scope === 'all'
        ? S.applied(preset.name, (kinds.length ? kinds : (['original'] as const)).map(labelOf).join(' + '))
        : S.appliedOne(labelOf(scope), preset.name, others.join(C.listSeparator));
    ToastQueue.positive(message, {
      timeout: 5000,
      actionLabel: C.undo,
      onAction: () => void undo({ transaction: receipt.transactionId }),
      shouldCloseOnAction: true,
    });
    return true;
  };
  /** 卡上的「编辑」：套上（已经是它就不再套一次），再去属性页逐项改（原型 `onEdit={() => { apply(p); onEdit(); }}`）。 */
  const edit = async (preset: CaptionPreset) => {
    const itemId = current?.itemIds[0];
    if (!itemId) return;
    // 先选中再套：选中会清掉样式草稿，反过来新样式取到之前会闪回旧的一下。
    useEditor.getState().select([itemId]);
    if (!onCard(preset) && !(await pick(preset))) return;
    openGallery(videoId, false);
    useEditor.getState().showPanel('props');
  };

  return (
    <>
      <PanelHead title={S.title} back={{ label: S.back, onPress: onBack }} />
      {children}
      {kinds.length > 1 && root ? (
        <div className={scopeRow}>
          <span className={scopeLabel}>{S.scope}</span>
          <Seg<PresetScope>
            label={S.scope}
            value={scope}
            options={[{ key: 'all' as PresetScope, label: S.scopeAll }, ...kinds.map((kind) => ({ key: kind as PresetScope, label: labelOf(kind) }))]}
            isDisabled={!editable}
            onChange={setPicked}
          />
        </div>
      ) : null}
      <div className={panelBody}>
        {body === undefined ? (
          <Note>{S.loading}</Note>
        ) : !root ? (
          <Note>{S.foreign(String(asObject(body).schema ?? C.noSchema))}</Note>
        ) : (
          <>
            {!editable ? <Note>{S.readOnly}</Note> : null}
            {groups.map((group, index) => (
              <Fragment key={group.key}>
                <SecHead first={index === 0}>{group.label}</SecHead>
                <div className={grid}>
                  {group.presets.map((preset) => (
                    <GalleryCard
                      key={preset.id}
                      preset={preset}
                      on={onCard(preset)}
                      root={previews.get(preset.id) ?? root}
                      kinds={kinds}
                      isDisabled={disabled}
                      onPick={() => void pick(preset)}
                      onEdit={() => void edit(preset)}
                    />
                  ))}
                </div>
              </Fragment>
            ))}
            <p className={hint}>
              {S.hint}
              {kinds.length > 1 ? S.hintScope : null}
              {S.hintMotion}
            </p>
          </>
        )}
      </div>
    </>
  );
}
