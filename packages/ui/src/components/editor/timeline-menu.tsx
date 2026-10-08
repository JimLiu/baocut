import { useRef, type ReactElement } from 'react';
import type { AssetRecord, DocumentRecord, Id, Sequence } from '@baocut/protocol';
import { Header, Heading, Keyboard, Menu, MenuItem, MenuSection, MenuTrigger, Text } from '@react-spectrum/s2';
import CopyIcon from '@react-spectrum/s2/icons/Copy';
import CutIcon from '@react-spectrum/s2/icons/Cut';
import DeleteIcon from '@react-spectrum/s2/icons/Delete';
import DuplicateIcon from '@react-spectrum/s2/icons/Duplicate';
import PasteIcon from '@react-spectrum/s2/icons/Paste';
import Visibility from '@react-spectrum/s2/icons/Visibility';
import VisibilityOff from '@react-spectrum/s2/icons/VisibilityOff';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Pressable } from 'react-aria-components';
import { TIMELINE_EDIT_COPY as COPY } from '../../copy.ts';
import { itemLabel } from '../../model/editor.ts';
import type { DubBlock } from '../../model/timeline-dub.ts';
import { useEditor } from '../../state/editor-store.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { DubFitHost } from './dub-fit-dialog.tsx';
import { useEditorActions } from './editor-context.tsx';
import { DubBlockMenu } from './timeline-dub.tsx';
import {
  MOD_KEY,
  canSplitAt,
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  pasteClipboard,
  setItemEnabled,
  splitAtPlayhead,
} from './timeline-commands.ts';

/** 右键的是哪一件、指针在哪（视口坐标）。 */
export interface TimelineMenuTarget {
  itemId: Id;
  x: number;
  y: number;
}

/**
 * 时间线片段的右键菜单（原型 timeline-menu.jsx）：片段名做标题；在播放头分割；复制、剪切、粘贴、再制；
 * 停用或启用这一件；删除。命令与快捷键是同一份（timeline-commands）。
 *
 * 菜单开在指针那一点：用一个 `position: fixed` 的 0 尺寸锚当触发器（时间线是滚动区，浮层挂在片段上会跟着滚、
 * 也会被裁），受控打开。原型只给视频块「在播放头分割」；这里每一类都给，与 S、⌘B 一致，播放头不在这一件里时禁用。
 * 配音块换成块菜单（timeline-dub.tsx `DubBlockMenu`）：听这一句、静音、重新生成、改译文并重配、删除这几句。
 * 「改译文并重配」的对话框也常驻挂在这里（dub-fit-dialog.tsx），块菜单、配音行头与配音组卡都经 `openDubFit` 打开它。
 */
export function TimelineMenu(props: {
  target: TimelineMenuTarget | null;
  sequence: Sequence;
  assets: Record<Id, AssetRecord>;
  documents: Record<Id, DocumentRecord>;
  /** 时间线上的配音块：右键的是其中一块时弹块菜单。 */
  dubBlocks?: ReadonlyMap<Id, DubBlock>;
  onClose(): void;
}) {
  return (
    <>
      <TimelineItemMenu {...props} />
      <DubFitHost sequence={props.sequence} documents={props.documents} blocks={props.dubBlocks ?? EMPTY_BLOCKS} />
    </>
  );
}

const EMPTY_BLOCKS: ReadonlyMap<Id, DubBlock> = new Map();

function TimelineItemMenu({
  target,
  sequence,
  assets,
  documents,
  dubBlocks,
  onClose,
}: {
  target: TimelineMenuTarget | null;
  sequence: Sequence;
  assets: Record<Id, AssetRecord>;
  documents: Record<Id, DocumentRecord>;
  /** 时间线上的配音块：右键的是其中一块时弹块菜单。 */
  dubBlocks?: ReadonlyMap<Id, DubBlock>;
  onClose(): void;
}) {
  const actions = useEditorActions();
  const editable = useVideo((s) => canEdit(s.video));
  // 关上时的淡出还要画上一次的内容。
  const last = useRef(target);
  if (target) last.current = target;
  const at = last.current;
  if (!at) return null;
  const item = sequence.items.find((candidate) => candidate.id === at.itemId);
  const name = item ? itemLabel(item, assets, documents) : '';
  const dub = item ? dubBlocks?.get(item.id) : undefined;
  const enabled = item?.enabled ?? true;
  const canSplit = !!item && canSplitAt(sequence, item.id, useEditor.getState().playhead);
  const disabled = editable
    ? canSplit
      ? []
      : ['split']
    : ['split', 'cut', 'paste', 'duplicate', 'toggle', 'delete'];

  const run = (key: string) => {
    if (!item) return;
    switch (key) {
      case 'split':
        return splitAtPlayhead(actions, [item.id]);
      case 'copy':
        return void copySelection();
      case 'cut':
        return void cutSelection(actions);
      case 'paste':
        return void pasteClipboard(actions);
      case 'duplicate':
        return void duplicateSelection(actions);
      case 'toggle':
        return setItemEnabled(actions, item.id, !enabled);
      case 'delete':
        return void deleteSelection(actions);
    }
  };

  const trigger = (menu: ReactElement) => (
    <MenuTrigger
      trigger="contextMenu"
      isOpen={!!target}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}>
      <Pressable>
        <span role="button" tabIndex={-1} aria-label={COPY.menuLabel(name)} className={anchor} style={{ left: at.x, top: at.y }} />
      </Pressable>
      {menu}
    </MenuTrigger>
  );
  if (dub && dubBlocks) return trigger(<DubBlockMenu dub={dub} blocks={dubBlocks} sequence={sequence} documents={documents} name={name} />);

  return (
    <MenuTrigger
      trigger="contextMenu"
      isOpen={!!target}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}>
      <Pressable>
        <span role="button" tabIndex={-1} aria-label={COPY.menuLabel(name)} className={anchor} style={{ left: at.x, top: at.y }} />
      </Pressable>
      <Menu aria-label={COPY.menuLabel(name)} disabledKeys={disabled} onAction={(key) => run(String(key))}>
        <MenuSection>
          <Header>
            <Heading>{name}</Heading>
          </Header>
          <MenuItem id="split" textValue={COPY.split}>
            <CutIcon />
            <Text slot="label">{COPY.split}</Text>
            {canSplit ? null : <Text slot="description">{COPY.splitUnavailable}</Text>}
            <Keyboard>S</Keyboard>
          </MenuItem>
        </MenuSection>
        <MenuSection>
          <MenuItem id="copy" textValue={COPY.copy}>
            <CopyIcon />
            <Text slot="label">{COPY.copy}</Text>
            <Keyboard>{MOD_KEY}C</Keyboard>
          </MenuItem>
          <MenuItem id="cut" textValue={COPY.cutItem}>
            <CutIcon />
            <Text slot="label">{COPY.cutItem}</Text>
            <Keyboard>{MOD_KEY}X</Keyboard>
          </MenuItem>
          <MenuItem id="paste" textValue={COPY.paste}>
            <PasteIcon />
            <Text slot="label">{COPY.paste}</Text>
            <Keyboard>{MOD_KEY}V</Keyboard>
          </MenuItem>
          <MenuItem id="duplicate" textValue={COPY.duplicate}>
            <DuplicateIcon />
            <Text slot="label">{COPY.duplicate}</Text>
            <Keyboard>{MOD_KEY}D</Keyboard>
          </MenuItem>
        </MenuSection>
        <MenuSection>
          <MenuItem id="toggle" textValue={enabled ? COPY.disable : COPY.enable}>
            {enabled ? <VisibilityOff /> : <Visibility />}
            <Text slot="label">{enabled ? COPY.disable : COPY.enable}</Text>
            <Text slot="description">{enabled ? COPY.disableHint : COPY.enableHint}</Text>
          </MenuItem>
        </MenuSection>
        <MenuSection>
          <MenuItem id="delete" textValue={COPY.remove}>
            <DeleteIcon />
            <Text slot="label">{COPY.remove}</Text>
            <Keyboard>⌫</Keyboard>
          </MenuItem>
        </MenuSection>
      </Menu>
    </MenuTrigger>
  );
}

/** 菜单的锚：指针那一点，不占地方、不接指针。 */
const anchor = style({ position: 'fixed', width: 0, height: 0, pointerEvents: 'none', outlineStyle: 'none' });
