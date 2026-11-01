import type { ArtifactRef } from '@baocut/protocol';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import CloseCaptions from '@react-spectrum/s2/icons/CloseCaptions';
import FileText from '@react-spectrum/s2/icons/FileText';
import Image from '@react-spectrum/s2/icons/Image';
import Video from '@react-spectrum/s2/icons/Video';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { outputKind, type OutputKind } from '../../model/bot.ts';
import { BOT_COPY as C } from './bot-copy.ts';

/** 产物种类的图标（原型 model-bot.js `OUTPUT_KIND`）：Make 面板的产物卡、任务详情的产物行、产物页签与产物页共用。 */
export const OUTPUT_ICON: Record<OutputKind, typeof Video> = { video: Video, image: Image, subtitle: CloseCaptions, doc: FileText };

/** 产物的名字：写了名字用名字，没写的文件用文件名，都没有用种类。 */
export function outputLabel(ref: ArtifactRef): string {
  if (ref.label) return ref.label;
  if (ref.kind === 'file') return ref.path.split(/[\\/]/).pop() || ref.path;
  return C.make.outputKind[outputKind(ref) ?? 'doc'];
}

const link = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: 'full',
  minWidth: 0,
  boxSizing: 'border-box',
  paddingX: 8,
  paddingY: 4,
  borderWidth: 0,
  borderRadius: 'default',
  backgroundColor: { default: 'transparent', ':hover': 'gray-100' },
  font: 'ui-sm',
  color: 'gray-800',
  textAlign: 'start',
  cursor: 'default',
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: 2,
});
/** 开不了页签的产物（幻灯片、设计稿）：同一行的样子，不能按。 */
const still = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  paddingX: 8,
  paddingY: 4,
  font: 'ui-sm',
  color: 'gray-800',
});
const name = style({ flexGrow: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

/**
 * 任务详情「产物」里的一行（原型 page-bot-side.jsx `BotOutputLink`）：种类图标、名字、右箭头，按下在右栏推开它的产物页签。
 * 没有 `onOpen`（开不了页签的产物）时只画图标与名字。
 */
export function BotOutputLink({ output, onOpen }: { output: ArtifactRef; onOpen?: () => void }) {
  const kind = outputKind(output) ?? 'doc';
  const Icon = OUTPUT_ICON[kind];
  const label = outputLabel(output);
  if (!onOpen) {
    return (
      <span className={still} title={label}>
        <Icon styles={iconStyle({ color: 'gray', size: 'S' })} />
        <span className={name}>{label}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      className={link}
      onClick={onOpen}
      aria-label={C.output.open(label, C.make.outputKind[kind])}
      title={output.kind === 'file' ? output.path : label}
    >
      <Icon styles={iconStyle({ color: 'gray', size: 'S' })} />
      <span className={name}>{label}</span>
      <ChevronRight styles={iconStyle({ color: 'gray', size: 'S' })} />
    </button>
  );
}
