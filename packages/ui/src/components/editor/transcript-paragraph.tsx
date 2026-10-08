import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Id } from '@baocut/protocol';
import { ActionButton, Header, Heading, Menu, MenuItem, MenuSection, MenuTrigger, Text, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import ChevronUp from '@react-spectrum/s2/icons/ChevronUp';
import Copy from '@react-spectrum/s2/icons/Copy';
import Cut from '@react-spectrum/s2/icons/Cut';
import More from '@react-spectrum/s2/icons/More';
import Play from '@react-spectrum/s2/icons/Play';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import type { ParagraphMove } from '../../model/chapters.ts';
import { formatClock } from '../../model/format.ts';
import { displayWidth } from '../../model/speech-cues.ts';
import type { TextRange } from '../../model/text-find.ts';
import { playedEnd, type TranscriptParagraph, type TranscriptWord } from '../../model/transcript-cut.ts';
import { wordHighlights, type ParagraphText, type TranscriptView, type WordHighlight } from '../../model/transcript-text.ts';
import { TRANSCRIPT_COPY as C, TRANSCRIPT_TOOLS_COPY as T } from './transcript-copy.ts';
import { useHoldRow } from './use-virtual-rows.ts';

/**
 * 文稿里的一段（设计稿 panels.jsx `ParaRow`）：头行是说话人、段首时间（点了跳过去），右边悬停才出的 ↑ ↓（挪到相邻章）、
 * 播放本段与 ⋯ 菜单（复制这一段、换到哪一章、剪掉这一段）；下面是词（看原文、双语时）与译文行（看译文、双语时）。
 * 查找命中标在词上（盖住词间空格时连空格一起标）与译文行上。动作都交回文稿面板做（`onAction`）。
 *
 * 段落是文稿虚拟列表里的一行：与上一行的 8px 间距由列表的行外层给；⋯ 菜单开着时要求列表别卸掉这一行（菜单挂在这一行的钮上）。
 */

/** 一段里的命中，交给段落卡去画。 */
export interface ParaMarks {
  src: Array<TextRange & { current: boolean }>;
  trans: Array<TextRange & { current: boolean }>;
  key: string;
}

/** 段落行上的动作。 */
export type ParagraphAction = 'play' | 'up' | 'down' | 'copy' | 'copy-timed' | 'cut';

/** 段落挪到相邻章的两种做法，与挪不了的原因。有两章以上才有。 */
export interface ParagraphMoves {
  up: ParagraphMove | null;
  down: ParagraphMove | null;
  upReason: string;
  downReason: string;
}

const para = style({
  paddingX: 8,
  paddingY: 8,
  borderRadius: 'lg',
  backgroundColor: { default: 'gray-25', isHovered: 'gray-50', isGone: 'gray-50' },
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const paraHead = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 20,
  marginBottom: 2,
});
/** 段落行右边的几枚钮（设计稿 `.para__act`）：平时透明但占着位置，悬停、键盘焦点在里面或菜单开着时显出来，版面不跳。 */
const paraActs = style({
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  marginStart: 'auto',
  opacity: { default: 0, isShown: 1 },
});
const speakerName = style({
  font: 'ui-xs',
  fontWeight: 'bold',
  color: {
    default: 'gray-700',
    hue: {
      0: 'blue-900',
      1: 'green-900',
      2: 'orange-900',
      3: 'purple-900',
      4: 'cyan-900',
      5: 'magenta-900',
    },
  },
});
const paraTime = style({
  padding: 0,
  borderWidth: 0,
  backgroundColor: 'transparent',
  font: 'ui-xs',
  color: 'gray-500',
  cursor: { default: 'pointer', isGone: 'default' },
  textDecoration: { default: 'none', isHovered: 'underline', isGone: 'none' },
  borderRadius: 'sm',
});
const paraText = style({
  font: 'body-sm',
  lineHeight: '[1.8]',
  color: 'gray-800',
  overflowWrap: 'break-word',
});
/** 译文行：只看译文时它就是正文；双语对照时降一档（设计稿 `.para__b--tr`）。 */
const paraTranslation = style({
  font: { default: 'body-sm', isSecondary: 'body-xs' },
  lineHeight: '[1.7]',
  // 译文没有词级时间：整段播完才退灰（原型 `.para.is-done .para__b--tr`）。
  color: { default: 'gray-800', isSecondary: 'gray-600', isMissing: 'gray-500', isPlayed: 'gray-500' },
  fontStyle: { default: 'normal', isMissing: 'italic' },
  marginTop: { default: 0, isSecondary: 4 },
  overflowWrap: 'break-word',
});
/**
 * 词：已读（播放头走过的）退到 gray-500，与剪掉的词同色但不划线、不加底（原型 `.para__w.is-played`）；当前词黄底、选中蓝底都压过已读。
 * 同一段素材用了两次时，播第二处的词既是当前词又已读，所以当前词也写明颜色。
 */
const word = style({
  borderRadius: 'sm',
  cursor: 'pointer',
  userSelect: 'none',
  color: {
    default: 'gray-900',
    isPlayed: 'gray-500',
    state: { cut: 'gray-500' },
    isActive: 'gray-900',
    isSelected: 'gray-900',
  },
  textDecoration: {
    default: 'none',
    state: { cut: 'line-through', partial: 'underline' },
  },
  backgroundColor: {
    default: 'transparent',
    state: { cut: 'red-200', partial: 'red-100' },
    isActive: 'yellow-300',
    isSelected: 'blue-300',
  },
});
/** 查找命中（与字幕面板同一种标法）：当前那一处橙色。 */
const mark = style({ borderRadius: 'sm', backgroundColor: { default: 'yellow-200', isCurrent: 'orange-400' }, color: 'gray-900' });
const wordEditor = style({
  font: 'body-sm',
  lineHeight: '[1.4]',
  color: 'gray-900',
  backgroundColor: 'gray-50',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'blue-800',
  borderRadius: 'sm',
  paddingX: 2,
  paddingY: 0,
  marginX: 2,
  outlineStyle: 'none',
});

/** 在命中里切开一段文字画出来；当前那一处带 `data-match-current`，查找时滚到它。 */
function highlighted(text: string, ranges: readonly { start: number; end: number; current: boolean }[]): ReactNode {
  if (!ranges.length) return text;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    if (range.start < at) continue;
    if (range.start > at) parts.push(text.slice(at, range.start));
    parts.push(
      <mark key={range.start} className={mark({ isCurrent: range.current })} {...(range.current ? { 'data-match-current': '' } : {})}>
        {text.slice(range.start, range.end)}
      </mark>,
    );
    at = range.end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}

export const Paragraph = memo(
  function Paragraph({
    assetId,
    index,
    paragraph,
    text,
    view,
    translation,
    marks,
    moves,
    editable,
    selected,
    active,
    played,
    editing,
    speaker,
    hue,
    onSeek,
    onCommit,
    onCancel,
    onAction,
  }: {
    assetId: Id;
    index: number;
    paragraph: TranscriptParagraph;
    text: ParagraphText;
    view: TranscriptView;
    /** 这一段的译文（看原文时 null，没有对应译文时空串）。 */
    translation: string | null;
    marks: ParaMarks | null;
    /** 只用来让 memo 比较：这一段里的命中。 */
    markKey: string;
    moves: ParagraphMoves | null;
    editable: boolean;
    selected: ReadonlySet<number> | null;
    /** 只用来让 memo 比较：这一段里选中了哪些词。 */
    selKey: string;
    active: number | null;
    /**
     * 已读阈值（见 `paragraphPlayed`）：最早落点的结尾不晚于它的词已读。整段读完是 `Infinity`、没读到是 `-Infinity`，
     * 只有正在读的段才随播放头变，别的段不跟着重渲。
     */
    played: number;
    editing: number | null;
    speaker: string | null;
    hue: number | null;
    onSeek(seconds: number): void;
    onCommit(assetId: Id, index: number, text: string): void;
    onCancel(): void;
    onAction(assetId: Id, index: number, action: ParagraphAction, moves: ParagraphMoves | null): void;
  }) {
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    useHoldRow(menuOpen);
    const start = paragraph.words.find((w) => w.placements.length)?.placements[0]?.start;
    const gone = start === undefined;
    const showWords = view !== 'translation';
    const highlights = useMemo(() => (marks?.src.length ? wordHighlights(text, marks.src) : null), [text, marks]);
    const act = (action: ParagraphAction) => onAction(assetId, index, action, moves);
    const actionButton = (action: ParagraphAction, label: string, icon: ReactNode, disabled = false) => (
      <TooltipTrigger>
        <ActionButton isQuiet size="XS" aria-label={label} isDisabled={disabled} onPress={() => act(action)}>
          {icon}
        </ActionButton>
        <Tooltip>{label}</Tooltip>
      </TooltipTrigger>
    );
    const disabledKeys = [...(!editable || !moves?.up ? ['up'] : []), ...(!editable || !moves?.down ? ['down'] : []), ...(!editable || gone ? ['cut'] : [])];
    return (
      <div className={para({ isGone: gone, isHovered: hovered })} onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}>
        <div className={paraHead}>
          {speaker ? (
            <span
              className={speakerName({
                hue: hue === null ? undefined : (String(hue) as '0'),
              })}>
              {speaker}
            </span>
          ) : null}
          <button
            type="button"
            className={paraTime({ isGone: gone })}
            disabled={gone}
            title={gone ? C.cutWordTitle : C.jump}
            onClick={() => start !== undefined && onSeek(start)}>
            {gone ? C.cutWordTitle : formatClock(start)}
          </button>
          <span
            className={paraActs({ isShown: hovered || focused || menuOpen })}
            onFocus={() => setFocused(true)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
            }}>
            {moves ? (
              <>
                {actionButton('up', T.moveUp, <ChevronUp />, !editable || !moves.up)}
                {actionButton('down', T.moveDown, <ChevronDown />, !editable || !moves.down)}
              </>
            ) : null}
            {actionButton('play', T.play, <Play />, gone)}
            <MenuTrigger align="end" isOpen={menuOpen} onOpenChange={setMenuOpen}>
              <TooltipTrigger>
                <ActionButton isQuiet size="XS" aria-label={T.paraMenu}>
                  <More />
                </ActionButton>
                <Tooltip>{T.paraMenu}</Tooltip>
              </TooltipTrigger>
              <Menu aria-label={T.paraMenu} disabledKeys={disabledKeys} onAction={(key) => act(key as ParagraphAction)}>
                <MenuSection>
                  <Header>
                    <Heading>{T.copyScopeHead(T.scopePara)}</Heading>
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
                {moves ? (
                  <MenuSection>
                    <Header>
                      <Heading>{T.moveHead}</Heading>
                    </Header>
                    <MenuItem id="up" textValue={moves.up ? T.moveTo(moves.up.to.title) : T.moveUp}>
                      <ChevronUp />
                      <Text slot="label">{moves.up ? T.moveTo(moves.up.to.title) : T.moveUp}</Text>
                      <Text slot="description">{moves.up ? T.moveWith(moves.up.moved) : moves.upReason}</Text>
                    </MenuItem>
                    <MenuItem id="down" textValue={moves.down ? T.moveTo(moves.down.to.title) : T.moveDown}>
                      <ChevronDown />
                      <Text slot="label">{moves.down ? T.moveTo(moves.down.to.title) : T.moveDown}</Text>
                      <Text slot="description">{moves.down ? T.moveWith(moves.down.moved) : moves.downReason}</Text>
                    </MenuItem>
                  </MenuSection>
                ) : null}
                <MenuSection aria-label={T.cutPara}>
                  <MenuItem id="cut" textValue={T.cutPara}>
                    <Cut />
                    <Text slot="label">{T.cutPara}</Text>
                    <Text slot="description">{gone ? C.cutWordTitle : T.cutParaHint}</Text>
                  </MenuItem>
                </MenuSection>
              </Menu>
            </MenuTrigger>
          </span>
        </div>
        {showWords ? (
          <div className={paraText}>
            {paragraph.words.map((w, n) => (
              <WordView
                key={w.id}
                assetId={assetId}
                word={w}
                spaced={n > 0 && w.spaced}
                isSelected={!!selected?.has(w.index)}
                isActive={active === w.index}
                isPlayed={played > -Infinity && w.placements.length > 0 && playedEnd(w)! <= played}
                isEditing={editing === w.index}
                highlight={highlights?.get(w.index) ?? null}
                onCommit={onCommit}
                onCancel={onCancel}
              />
            ))}
          </div>
        ) : null}
        {translation !== null ? (
          <div className={paraTranslation({ isSecondary: view === 'both', isMissing: !translation, isPlayed: played === Infinity })}>
            {translation ? highlighted(translation, marks?.trans ?? []) : T.noParagraphTranslation}
          </div>
        ) : null}
      </div>
    );
  },
  (a, b) =>
    a.paragraph === b.paragraph &&
    a.text === b.text &&
    a.index === b.index &&
    a.view === b.view &&
    a.translation === b.translation &&
    a.markKey === b.markKey &&
    a.moves === b.moves &&
    a.editable === b.editable &&
    a.selKey === b.selKey &&
    a.active === b.active &&
    a.played === b.played &&
    a.editing === b.editing &&
    a.speaker === b.speaker &&
    a.hue === b.hue &&
    a.assetId === b.assetId &&
    a.onSeek === b.onSeek &&
    a.onCommit === b.onCommit &&
    a.onCancel === b.onCancel &&
    a.onAction === b.onAction,
);

function WordView({
  assetId,
  word: w,
  spaced,
  isSelected,
  isActive,
  isPlayed,
  isEditing,
  highlight,
  onCommit,
  onCancel,
}: {
  assetId: Id;
  word: TranscriptWord;
  spaced: boolean;
  isSelected: boolean;
  isActive: boolean;
  /** 播放头已经走过（剪掉的词没有落点，永远不算）。 */
  isPlayed: boolean;
  isEditing: boolean;
  highlight: WordHighlight | null;
  onCommit(assetId: Id, index: number, text: string): void;
  onCancel(): void;
}) {
  const text = w.text.trim();
  if (isEditing) {
    return (
      <>
        {spaced ? ' ' : null}
        <WordEditor initial={text} onCommit={(value) => onCommit(assetId, w.index, value)} onCancel={onCancel} />
      </>
    );
  }
  const title = w.state === 'cut' ? C.cutWordTitle : w.state === 'partial' ? C.partialWordTitle : undefined;
  const gap = highlight?.gap ? (
    <mark className={mark({ isCurrent: highlight.gap === 2 })} {...(highlight.gap === 2 ? { 'data-match-current': '' } : {})}>
      {' '}
    </mark>
  ) : (
    ' '
  );
  return (
    <>
      {spaced ? gap : null}
      <span data-a={assetId} data-w={w.index} className={word({ state: w.state, isSelected, isActive, isPlayed })} title={title}>
        {highlight ? highlighted(text, highlight.ranges) : text}
      </span>
    </>
  );
}

/** 就地改一个词：回车或失焦提交，Esc 放弃。 */
function WordEditor({ initial, onCommit, onCancel }: { initial: string; onCommit(value: string): void; onCancel(): void }) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className={wordEditor}
      aria-label={C.editWord}
      value={value}
      size={Math.max(2, displayWidth(value) + 1)}
      onChange={(event) => setValue(event.target.value)}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          done.current = true;
          onCommit(value);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          done.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (!done.current) onCommit(value);
      }}
    />
  );
}
