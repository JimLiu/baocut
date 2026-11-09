import { stickerHost, type PackSticker } from '@baocut/protocol';
import { Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton } from 'react-aria-components';
import { STICKER_PACK_COPY as SP } from '../../model/sticker-pack-copy.ts';
import { HOST_STYLES, hostName, matchHosts, type HostStyle } from '../../model/sticker-packs.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { PackStickerThumb } from './element-thumb.tsx';
import { ELEMENTS_COPY as EL } from './elements-copy.ts';

/**
 * 元素面板 › 虚拟主播（设计稿 `HostSection`）：BaoCut 自带的原创卡通角色（`@baocut/protocol` 的 `BUILTIN_HOSTS`）。格子是随包的
 * 静止立绘，格下写角色名；点一格就把角色包拷进视频、在右下新建一层角色贴纸（`usePackSticker`），放上去就做待机动作。跟着旁白
 * 对口型由智能体配动作轨，这里只说去哪里做。
 */

/** 二级分类的值：全部，或一种画风。 */
export type HostSub = HostStyle | 'all';
export const hostChips = (): { key: HostSub; label: string }[] => [
  { key: 'all', label: EL.all },
  ...HOST_STYLES.map((key) => ({ key, label: SP.hostStyles[key] })),
];

const grid = style({ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '[6px]' });
const cell = style({ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 });
/** 一格（设计稿 .stile--host）：方格、灰底、不留边，立绘铺满；悬停加深，按下微缩。 */
const tile = style({
  display: 'block',
  boxSizing: 'border-box',
  width: 'full',
  aspectRatio: 'square',
  padding: 0,
  borderWidth: 0,
  borderRadius: 'lg',
  overflow: 'hidden',
  backgroundColor: { default: 'gray-100', isHovered: 'gray-200' },
  cursor: { default: 'pointer', isDisabled: 'default' },
  opacity: { default: 1, isDisabled: 0.5 },
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  transform: { default: 'none', isPressed: 'scale(0.96)' },
  transition: 'default',
});
/** 格下的名字（设计稿 .hostcap）：界面语言的名字加粗，中文界面后面跟一个英文名。 */
const caption = style({
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'center',
  gap: 4,
  minWidth: 0,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
});
const captionName = style({ font: 'ui-xs', fontWeight: 'bold', color: 'gray-900', overflow: 'hidden', textOverflow: 'ellipsis' });
const captionNote = style({ font: 'ui-xs', color: 'gray-600', overflow: 'hidden', textOverflow: 'ellipsis' });
const emptyBox = style({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, paddingY: 16, paddingX: 8, textAlign: 'center' });
const emptyTitle = style({ font: 'ui-sm', fontWeight: 'bold', color: 'gray-900' });
const emptyText = style({ font: 'ui-xs', color: 'gray-600' });
/** 底下那两句（设计稿 .signpost）：放上去会怎样动，配口型去哪里做。 */
const signpost = style({ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8, font: 'ui-xs', color: 'gray-600' });

interface HostGridProps {
  stickers: readonly PackSticker[];
  editable: boolean;
  onAdd(sticker: PackSticker): void;
}

/** 一组主播格子（组头由面板摆）。 */
export function HostGrid({ stickers, editable, onAdd }: HostGridProps) {
  return (
    <div className={grid}>
      {stickers.map((sticker) => (
        <HostTile key={sticker.id} sticker={sticker} editable={editable} onAdd={onAdd} />
      ))}
    </div>
  );
}

function HostTile({ sticker, editable, onAdd }: { sticker: PackSticker; editable: boolean; onAdd(sticker: PackSticker): void }) {
  const host = stickerHost(sticker)!;
  const name = hostName(host);
  const other = name === host.name ? null : host.name;
  return (
    <div className={cell}>
      <TooltipTrigger delay={600}>
        <RACButton className={tile} aria-label={EL.addNamed(name)} isDisabled={!editable} onPress={() => onAdd(sticker)}>
          <PackStickerThumb sticker={sticker} />
        </RACButton>
        <Tooltip>{other ? `${name} · ${other}` : name}</Tooltip>
      </TooltipTrigger>
      <span className={caption}>
        <span className={captionName}>{name}</span>
        {other ? <span className={captionNote}>{other}</span> : null}
      </span>
    </div>
  );
}

/** 「虚拟主播」子页：按画风与搜索词筛出来的格子，底下说清放上去会怎样、配口型去哪里做（Web 上没有会话）。 */
export function HostSection({ sub, query, editable, onAdd }: { sub: HostSub; query: string } & Omit<HostGridProps, 'stickers'>) {
  const web = useRuntime().host.platform === 'web';
  const stickers = matchHosts(sub, query);
  return (
    <>
      {stickers.length ? (
        <HostGrid stickers={stickers} editable={editable} onAdd={onAdd} />
      ) : (
        <div className={emptyBox}>
          <span className={emptyTitle}>{SP.noHost}</span>
          <span className={emptyText}>{SP.noHostHint}</span>
        </div>
      )}
      <div className={signpost}>
        <span>{SP.hostSignpost}</span>
        <span>{web ? SP.hostLipSyncWeb : SP.hostLipSync}</span>
      </div>
    </>
  );
}
