import { useRef, useState, type HTMLAttributes, type Ref } from 'react';
import type { Id, Sequence } from '@baocut/protocol';
import { ActionButton, Header, Heading, Menu, MenuItem, MenuSection, MenuTrigger, Text, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import Copy from '@react-spectrum/s2/icons/Copy';
import Cut from '@react-spectrum/s2/icons/Cut';
import Delete from '@react-spectrum/s2/icons/Delete';
import Edit from '@react-spectrum/s2/icons/Edit';
import More from '@react-spectrum/s2/icons/More';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { CHAPTER_TITLE_MAX, cutChapterOperations, sequenceChapters, type ChapterSpan } from '../../model/chapters.ts';
import { formatClock } from '../../model/format.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { removeChapter, renameChapter } from './chapter-commands.ts';
import { CHAPTER_COPY as C } from './chapter-copy.ts';
import { useEditorActions } from './editor-context.tsx';
import { applyChapterCut } from './transcript-actions.ts';
import { TRANSCRIPT_TOOLS_COPY as T } from './transcript-copy.ts';
import { useHoldRow } from './use-virtual-rows.ts';

/**
 * 文稿里的章节头行（设计稿 panels.jsx `.chead`）：滚动时贴在面板顶上；章名点一下就地改名（Enter 或移开焦点写入，Esc 放弃），
 * 起止时间点一下跳到这一章开头，右边是这一章有几段。没有段落的章在头行下写一句（`TranscriptChapterEmpty`，文稿列表里单独一行）。
 * `chapter` 为 null 时是「第一章之前」。头行本身就是文稿虚拟列表里的一行（`rowProps`：量高的 ref 与列表项属性），吸顶靠它是
 * 那一节外层的直接子元素；菜单开着、章名输入框开着时要求列表别卸掉这一行。
 *
 * 最右是「这一章…」菜单（设计稿 `.chead__b` + `ScopeMenu`，悬停、焦点在上面或菜单开着时显出来）：复制这一章（文字 / 带时间码
 * 与说话人，由文稿面板按这一章的段拼）、改名、剪掉这一章（`removeRange` 删掉这段时间，删标记，后面的章前移，一笔事务）、
 * 删除章节标记（内容不动）。「第一章之前」只有复制。设计稿菜单里只对一章重跑转录、润色、识别说话人的几项没有做（按章的重跑
 * 还没有）；拖段落换章也没有做，用段落行的 ↑ ↓。
 */

const head = style({
  position: 'sticky',
  top: 0,
  zIndex: 2,
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  boxSizing: 'border-box',
  height: 40,
  paddingTop: 12,
  paddingBottom: 2,
  paddingX: 12,
  marginX: -12,
  backgroundColor: 'gray-25',
  borderBottomWidth: 1,
  borderTopWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const title = style({
  flexShrink: 1,
  minWidth: 0,
  height: 20,
  marginStart: -4,
  paddingX: 4,
  paddingY: 0,
  borderWidth: 0,
  borderRadius: 'sm',
  backgroundColor: { default: 'transparent', isHovered: 'gray-100', isStatic: 'transparent' },
  font: 'ui',
  fontWeight: 'bold',
  color: 'gray-900',
  textAlign: 'start',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  cursor: { default: 'text', isStatic: 'default' },
});
const input = style({
  flexGrow: 1,
  minWidth: 0,
  height: 20,
  marginStart: -4,
  paddingX: 4,
  paddingY: 0,
  boxSizing: 'border-box',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'blue-800',
  borderRadius: 'sm',
  backgroundColor: 'gray-25',
  font: 'ui',
  fontWeight: 'bold',
  color: 'gray-900',
  outlineStyle: 'none',
});
const range = style({
  flexShrink: 0,
  padding: 0,
  borderWidth: 0,
  borderRadius: 'sm',
  backgroundColor: 'transparent',
  font: 'code-xs',
  color: 'gray-600',
  cursor: 'pointer',
  textDecoration: { default: 'none', isHovered: 'underline' },
  whiteSpace: 'nowrap',
});
const grow = style({ flexGrow: 1 });
/** 「这一章…」钮（设计稿 `.chead__b`）：平时透明，悬停、焦点在里面或菜单开着时显出来。 */
const menuSlot = style({ flexShrink: 0, alignSelf: 'center', opacity: { default: 0, isShown: 1 } });
const count = style({ flexShrink: 0, font: 'ui-xs', color: 'gray-500', whiteSpace: 'nowrap' });
const empty = style({ margin: 0, paddingX: 4, paddingTop: 8, paddingBottom: 12, font: 'ui-sm', color: 'gray-500' });

export function TranscriptChapterHead({
  rowProps,
  sequence,
  chapter,
  paragraphs,
  cutTrackIds,
  onCopy,
}: {
  /** 虚拟列表给行外层的：量高的 ref、`role="listitem"` 与位置。 */
  rowProps?: HTMLAttributes<HTMLDivElement> & { ref?: Ref<HTMLDivElement> };
  sequence: Sequence;
  chapter: ChapterSpan | null;
  paragraphs: number;
  /** 剪掉这一章时声明的轨道（与文稿里剪一段同一套：取用了素材的轨道、链接的轨道与字幕轨）。 */
  cutTrackIds: readonly Id[];
  /** 复制这一章的段。 */
  onCopy(options: { time?: boolean; speaker?: boolean }): void;
}) {
  const actions = useEditorActions();
  const editable = useVideo((s) => canEdit(s.video));
  const [draft, setDraft] = useState<string | null>(null);
  const [hovered, setHovered] = useState<'title' | 'range' | null>(null);
  const [rowHovered, setRowHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Enter 写入后输入框卸掉时还可能来一次失焦：只写一次。
  const settled = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useHoldRow(menuOpen || draft !== null);

  const startEdit = () => {
    if (!chapter || !editable) return;
    settled.current = false;
    setDraft(chapter.label.trim() || chapter.title);
  };
  const finish = (value: string | null) => {
    if (settled.current) return;
    settled.current = true;
    setDraft(null);
    if (chapter && value !== null) void renameChapter(actions, sequence, chapter, value);
  };

  let name;
  if (draft !== null)
    name = (
      <input
        className={input}
        ref={inputRef}
        aria-label={C.renameTitle}
        autoFocus
        value={draft}
        maxLength={CHAPTER_TITLE_MAX}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => finish(event.target.value)}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            finish(event.currentTarget.value);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            finish(null);
          }
          event.stopPropagation();
        }}
      />
    );
  else if (chapter && editable)
    name = (
      <button
        type="button"
        className={title({ isHovered: hovered === 'title' })}
        title={C.clickRename}
        onPointerEnter={() => setHovered('title')}
        onPointerLeave={() => setHovered(null)}
        onClick={startEdit}>
        {chapter.title}
      </button>
    );
  else
    name = (
      <span className={title({ isStatic: true })} role="heading" aria-level={4}>
        {chapter ? chapter.title : C.beforeFirst}
      </span>
    );

  const cutPlan = chapter ? cutChapterOperations(sequence, sequenceChapters(sequence), chapter, cutTrackIds) : null;
  const onAction = (key: string) => {
    if (key === 'copy') onCopy({});
    else if (key === 'copy-timed') onCopy({ time: true, speaker: true });
    else if (!chapter || !editable) return;
    else if (key === 'rename') {
      startEdit();
      // 菜单关上时会把焦点还给 ⋯ 按钮（在它卸掉后的下一帧）：等那之后再把焦点放进输入框。
      requestAnimationFrame(() => requestAnimationFrame(() => inputRef.current?.focus()));
    } else if (key === 'cut' && cutPlan) void applyChapterCut(actions, chapter, cutPlan, sequence.fps);
    else if (key === 'remove') void removeChapter(actions, sequence, chapter);
  };
  const disabledKeys = !editable || !chapter ? ['rename', 'cut', 'remove'] : cutPlan?.ok ? [] : ['cut'];
  const scope = T.scopeChapter(chapter ? chapter.title : C.beforeFirst);

  const menu = (
    <span
      className={menuSlot({ isShown: rowHovered || focused || menuOpen })}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}>
      <MenuTrigger align="end" isOpen={menuOpen} onOpenChange={setMenuOpen}>
        <TooltipTrigger>
          <ActionButton isQuiet size="XS" aria-label={T.chapterMenu}>
            <More />
          </ActionButton>
          <Tooltip>{T.chapterMenu}</Tooltip>
        </TooltipTrigger>
        <Menu aria-label={T.chapterMenu} disabledKeys={disabledKeys} onAction={(key) => onAction(String(key))}>
          <MenuSection>
            <Header>
              <Heading>{T.copyScopeHead(scope)}</Heading>
            </Header>
            <MenuItem id="copy" textValue={T.copyText}>
              <Copy />
              <Text slot="label">{T.copyText}</Text>
            </MenuItem>
            <MenuItem id="copy-timed" textValue={T.copyTimed}>
              <Copy />
              <Text slot="label">{T.copyTimed}</Text>
            </MenuItem>
          </MenuSection>
          {chapter ? (
            <MenuSection>
              <Header>
                <Heading>{T.chapterMenu}</Heading>
              </Header>
              <MenuItem id="rename" textValue={T.renameChapter}>
                <Edit />
                <Text slot="label">{T.renameChapter}</Text>
              </MenuItem>
              <MenuItem id="cut" textValue={T.cutChapter}>
                <Cut />
                <Text slot="label">{T.cutChapter}</Text>
                <Text slot="description">{cutPlan && !cutPlan.ok ? T.cutChapterRefused[cutPlan.reason] : T.cutChapterHint}</Text>
              </MenuItem>
              <MenuItem id="remove" textValue={T.removeMarker}>
                <Delete />
                <Text slot="label">{T.removeMarker}</Text>
                <Text slot="description">{T.removeMarkerHint}</Text>
              </MenuItem>
            </MenuSection>
          ) : null}
        </Menu>
      </MenuTrigger>
    </span>
  );

  return (
    <div {...rowProps} className={head} onPointerEnter={() => setRowHovered(true)} onPointerLeave={() => setRowHovered(false)}>
      {name}
      {chapter && draft === null ? (
        <button
          type="button"
          className={`${range({ isHovered: hovered === 'range' })} bc-tabular`}
          title={C.jump}
          onPointerEnter={() => setHovered('range')}
          onPointerLeave={() => setHovered(null)}
          onClick={() => actions.seek(chapter.start)}>
          {formatClock(chapter.start)}–{formatClock(chapter.end)}
        </button>
      ) : null}
      <span className={grow} />
      <span className={count}>{C.paragraphs(paragraphs)}</span>
      {menu}
    </div>
  );
}

/** 没有段落的章，头行下面的那一句。 */
export function TranscriptChapterEmpty() {
  return <p className={empty}>{C.empty}</p>;
}
