import { useState, type ReactNode } from 'react';
import type { Sequence } from '@baocut/protocol';
import { ActionButton, SearchField, ToggleButton, ToggleButtonGroup, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import Animation from '@react-spectrum/s2/icons/Animation';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import Search from '@react-spectrum/s2/icons/Search';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton } from 'react-aria-components';
import { ELEMENT_TILES, VISUALIZER_PEEK, elementSections, type ElementSection, type ElementTile } from '../../model/element-catalog.ts';
import { frameAt } from '../../model/editor.ts';
import { stickerMatches } from '../../model/library-brand.ts';
import { spanAtPlayhead, wholeFilmSpan } from '../../model/new-items.ts';
import { useEditor } from '../../state/editor-store.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { BrandStickerThumb, ElementThumb } from './element-thumb.tsx';
import { SecHead } from './inspector-controls.tsx';
import { PanelChips, PanelHead, panelBody } from './panel-head.tsx';
import { useBrandApply } from './use-brand-apply.ts';
import { useBrandStickers, type BrandSticker } from './use-brand-stickers.ts';
import { useInsertVisual } from './use-insert-visual.ts';
import { ELEMENTS_COPY as EL } from './elements-copy.ts';

/** 目录页每一段摆几格，多的走「查看全部」。 */
const PEEK = 4;

type Section = ElementSection['key'];
const CHIPS: { key: Section | 'all'; label: string }[] = [
  {
    key: 'all',
    get label() {
      return EL.all;
    },
  },
  {
    key: 'sticker',
    get label() {
      return EL.sticker;
    },
  },
  {
    key: 'shape',
    get label() {
      return EL.shape;
    },
  },
  {
    key: 'visualizer',
    get label() {
      return EL.visualizer;
    },
  },
];

/** 可视化的二级分类（设计稿 `VIZ_CATS`）：计时两格跟着进度网格走，不自己占一格。 */
type VizSub = 'all' | 'progress' | 'wave';
const VIZ_CHIPS: { key: VizSub; label: string }[] = [
  {
    key: 'all',
    get label() {
      return EL.all;
    },
  },
  {
    key: 'progress',
    get label() {
      return EL.progress;
    },
  },
  {
    key: 'wave',
    get label() {
      return EL.wave;
    },
  },
];

/**
 * 贴纸的二级分类（设计稿 `stickerChips`）：「我的贴纸」恒在「全部」之后第一格。设计稿后面是第三方静态包（精选、表情、⋯），
 * 那些要随包素材，这里没有；内置的十款模板单占一格。
 */
type StickerSub = 'all' | 'brand' | 'builtin';
const STICKER_CHIPS: { key: StickerSub; label: string }[] = [
  {
    key: 'all',
    get label() {
      return EL.all;
    },
  },
  {
    key: 'brand',
    get label() {
      return EL.myStickers;
    },
  },
  {
    key: 'builtin',
    get label() {
      return EL.builtin;
    },
  },
];

/** 动态贴纸的二级分类（设计稿 `animCats`，只留做得出来的几格：我的贴纸、彩纸）。 */
type DynSub = 'all' | 'brand' | 'confetti';
const DYN_CHIPS: { key: DynSub; label: string }[] = [
  {
    key: 'all',
    get label() {
      return EL.all;
    },
  },
  {
    key: 'brand',
    get label() {
      return EL.myStickers;
    },
  },
  {
    key: 'confetti',
    get label() {
      return EL.confetti;
    },
  },
];

const search = style({ flexShrink: 0, paddingX: 12, paddingTop: 12 });
const subChips = style({ paddingBottom: 8 });
const grid = style({ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '[6px]' });
/** 动态贴纸的网格（设计稿 .stgrid--anim）：三列——动的东西细节多，四列下看不出它在动什么。 */
const animGrid = style({ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '[6px]' });
/** 进度网格（设计稿 .tgrid--prog）：三列，条形两款横跨两列，空位由后面的方格补上。 */
const progressGrid = style({ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gridAutoFlow: 'row dense', gap: 8 });
/** 声波网格（设计稿 .tgrid--wave）：两列 2:1 宽格。 */
const waveGrid = style({ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 });
const span2 = style({ gridColumnEnd: 'span 2' });
/** 一格（原型 .stile）：方格、灰底，悬停加深，按下微缩。 */
const tile = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: 0,
  borderWidth: 0,
  backgroundColor: 'transparent',
  cursor: { default: 'pointer', isDisabled: 'default' },
  opacity: { default: 1, isDisabled: 0.5 },
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  borderRadius: 'lg',
  transform: { default: 'none', isPressed: 'scale(0.96)' },
  transition: 'default',
});
/** 缩略图那一块：方格、2:1 宽格，或撑满这一行的高（横跨两列的进度条）。彩纸格（设计稿 .stile--cft）深底、不留边。 */
const face = style({
  display: 'block',
  boxSizing: 'border-box',
  width: 'full',
  flexGrow: { default: 0, shape: { stretch: 1 } },
  aspectRatio: { default: 'square', shape: { wave: '[2 / 1]', stretch: 'auto' } },
  minHeight: { default: 0, shape: { stretch: 48 } },
  padding: { default: '[6px]', isDark: 0 },
  overflow: 'hidden',
  borderRadius: 'lg',
  backgroundColor: { default: 'gray-100', isHovered: 'gray-200', isDark: { default: 'gray-800', isHovered: 'gray-700' } },
  transition: 'default',
});
/** 动态贴纸那一段标题前的小徽标（设计稿 .secbadge）：目录页唯一带徽标的一段。 */
const badgeTitle = style({ display: 'inline-flex', alignItems: 'center', gap: 4 });
const badgeIcon = iconStyle({ size: 'XS', color: 'neutral' });
const tileLabel = style({
  font: 'ui-xs',
  color: 'gray-700',
  textAlign: 'center',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
const viewAll = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  padding: 0,
  borderWidth: 0,
  backgroundColor: 'transparent',
  font: 'ui-xs',
  color: 'blue-1000',
  cursor: 'pointer',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
/** 子页里一组的组头（设计稿 .packhead）：组名、说明，右边一个入口。 */
const packHead = style({
  display: 'flex',
  alignItems: 'baseline',
  gap: '[6px]',
  paddingTop: { default: 16, isFirst: 0 },
  paddingBottom: 8,
});
const packTitle = style({ flexShrink: 0, font: 'ui-sm', fontWeight: 'bold', color: 'gray-900' });
const packNote = style({ minWidth: 0, font: 'ui-xs', color: 'gray-600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const packAction = style({ flexShrink: 0, marginStart: 'auto' });
const empty = style({ font: 'ui-sm', color: 'gray-600', textAlign: 'center', paddingY: 24 });
/** 「我的贴纸」空着时的路牌（设计稿 `Empty`）：说清东西从哪来，不是一片空白。 */
const emptyBox = style({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, paddingY: 16, paddingX: 8, textAlign: 'center' });
const emptyTitle = style({ font: 'ui-sm', fontWeight: 'bold', color: 'gray-900' });
const emptyText = style({ font: 'ui-xs', color: 'gray-600' });
/** 「我的贴纸」底下那一句（设计稿 .signpost）。 */
const signpost = style({ marginTop: 8, font: 'ui-xs', color: 'gray-600' });
const hint = style({
  marginTop: 16,
  paddingX: 12,
  paddingY: 8,
  borderRadius: 'lg',
  backgroundColor: 'gray-50',
  font: 'ui-xs',
  color: 'gray-600',
});
const headNote = style({
  font: 'ui-xs',
  color: 'gray-600',
  flexShrink: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

const byKey = (keys: readonly string[]) => keys.map((key) => ELEMENT_TILES.find((t) => t.key === key)).filter((t): t is ElementTile => !!t);

/**
 * 元素面板（原型 §14）：目录页是贴纸、形状、可视化几段各摆几格，「查看全部」或分节头下的
 * 二级分类钻进那一段；点一格就在播放头处新建一条并选中。
 */
export function ElementsPanel({ sequence }: { sequence: Sequence }) {
  const [tab, setTab] = useState<Section | 'all'>('all');
  const [viz, setViz] = useState<VizSub>('all');
  const [dyn, setDyn] = useState<DynSub>('all');
  const [stk, setStk] = useState<StickerSub>('all');
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const editable = useVideo((s) => canEdit(s.video));
  const insert = useInsertVisual();
  const applyBrand = useBrandApply();
  const brand = useBrandStickers();
  const root = tab === 'all';
  const q = query.trim();
  // 品牌库贴纸：图片进贴纸那一段，Lottie 进动态贴纸那一段；搜索时命中了，那一段就留着。
  const mine = (dynamic: boolean): BrandProps => ({
    stickers: brand.stickers.filter((sticker) => sticker.dynamic === dynamic && stickerMatches(sticker.summary.name, dynamic, q)),
    ready: brand.ready,
    query: q,
    onAdd: (sticker) => void applyBrand(sticker.entry),
  });
  const mineStatic = mine(false);
  const mineDynamic = mine(true);
  const keep: Section[] = [...(mineStatic.stickers.length ? ['sticker' as const] : []), ...(mineDynamic.stickers.length ? ['dynamic' as const] : [])];
  const sections = elementSections(query, keep).filter((section) => root || section.key === tab);
  const current = root ? null : elementSections().find((section) => section.key === tab);
  const peeking = root && !query.trim();

  const add = (item: ElementTile) => {
    const frame = frameAt(useEditor.getState().playhead, sequence.fps);
    const span = item.seconds === 'film' ? wholeFilmSpan(sequence, frame) : spanAtPlayhead(sequence, frame, item.seconds);
    const layer = item.layer(sequence.canvas);
    void insert(sequence, { span, layers: [layer], label: layer.name ?? item.label, trackName: EL.elementsTrack });
  };
  // 回目录时把二级分类清回「全部」：目录页的样本是各类轮流取的，下次进来停在上次那一格就对不上了。
  const back = () => {
    setTab('all');
    setViz('all');
    setDyn('all');
    setStk('all');
  };
  const open = (section: Section, sub?: string) => {
    if (section === 'visualizer') setViz((sub as VizSub | undefined) ?? 'all');
    if (section === 'dynamic') setDyn((sub as DynSub | undefined) ?? 'all');
    if (section === 'sticker') setStk((sub as StickerSub | undefined) ?? 'all');
    setTab(section);
  };
  const tiles = { canvas: sequence.canvas, editable, onAdd: add };

  const searchButton = (
    <TooltipTrigger>
      <ActionButton
        isQuiet
        size="S"
        aria-label={EL.searchElements}
        aria-pressed={searching}
        onPress={() => {
          if (searching) setQuery('');
          setSearching(!searching);
        }}>
        <Search />
      </ActionButton>
      <Tooltip>{EL.searchElements}</Tooltip>
    </TooltipTrigger>
  );

  return (
    <>
      {current ? (
        <PanelHead title={current.title} back={{ label: EL.backToCatalog, onPress: back }}>
          <span className={headNote}>{current.note}</span>
          {searchButton}
        </PanelHead>
      ) : (
        <PanelHead title={EL.elements}>{searchButton}</PanelHead>
      )}
      {searching ? (
        <div className={search}>
          <SearchField aria-label={EL.searchElements} placeholder={EL.searchPlaceholder} value={query} onChange={setQuery} autoFocus />
        </div>
      ) : null}
      {root ? <PanelChips<Section | 'all'> label={EL.elementCategories} items={CHIPS} value="all" onChange={(key) => (key === 'all' ? back() : open(key))} /> : null}
      {tab === 'sticker' ? <PanelChips<StickerSub> label={EL.stickerCategories} items={STICKER_CHIPS} value={stk} onChange={setStk} /> : null}
      {tab === 'visualizer' ? <PanelChips<VizSub> label={EL.visualizerCategories} items={VIZ_CHIPS} value={viz} onChange={setViz} /> : null}
      {tab === 'dynamic' ? <PanelChips<DynSub> label={EL.dynamicCategories} items={DYN_CHIPS} value={dyn} onChange={setDyn} /> : null}
      <div className={`${panelBody} bc-scroll`}>
        {sections.length ? (
          sections.map((section, index) => (
            <div key={section.key}>
              {root ? (
                <>
                  <SecHead
                    first={index === 0}
                    aside={section.note}
                    action={peeking && section.tiles.length > PEEK ? <ViewAll onPress={() => open(section.key)} /> : null}>
                    {section.key === 'dynamic' ? (
                      <span className={badgeTitle}>
                        <Animation styles={badgeIcon} data-bc-icons="own" />
                        {section.title}
                      </span>
                    ) : (
                      section.title
                    )}
                  </SecHead>
                  {peeking && section.key === 'visualizer' ? <SubChips label={EL.visualizerCategories} items={VIZ_CHIPS} onPick={(key) => open('visualizer', key)} /> : null}
                </>
              ) : null}
              {section.key === 'sticker' && !peeking ? (
                <Stickers sub={root ? 'all' : stk} items={section.tiles} brand={mineStatic} {...tiles} />
              ) : section.key === 'dynamic' ? (
                peeking ? (
                  <TileGrid className={grid} items={section.tiles.slice(0, PEEK)} {...tiles} />
                ) : (
                  <Dynamic sub={root ? 'all' : dyn} items={section.tiles} brand={mineDynamic} {...tiles} />
                )
              ) : section.key === 'visualizer' ? (
                peeking ? (
                  <TileGrid className={grid} items={byKey(VISUALIZER_PEEK)} labels {...tiles} />
                ) : (
                  <Visualizers items={section.tiles} sub={root ? 'all' : viz} limit={root || query.trim() ? null : PEEK} onMore={setViz} {...tiles} />
                )
              ) : (
                <TileGrid className={grid} items={peeking ? section.tiles.slice(0, PEEK) : section.tiles} {...tiles} />
              )}
            </div>
          ))
        ) : (
          <div className={empty}>{EL.notFound(query.trim())}</div>
        )}
        <div className={hint}>{EL.clickHint}</div>
      </div>
    </>
  );
}

function ViewAll({ onPress, children = EL.viewAll }: { onPress(): void; children?: ReactNode }) {
  return (
    <RACButton className={viewAll} onPress={onPress}>
      {children}
      <ChevronRight />
    </RACButton>
  );
}

/** 目录页分节头底下那一行二级分类（设计稿 `SubChips`）：高亮停在「全部」，点别的一格就带着它钻进那一段。 */
function SubChips<K extends string>({ label, items, onPick }: { label: string; items: readonly { key: K; label: string }[]; onPick(key: K): void }) {
  return (
    <div className={subChips}>
      <ToggleButtonGroup
        aria-label={label}
        size="XS"
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={['all']}
        onSelectionChange={(keys) => {
          const key = [...keys][0];
          if (key !== undefined) onPick(key as K);
        }}>
        {items.map((item) => (
          <ToggleButton key={item.key} id={item.key}>
            {item.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </div>
  );
}

export function PackHead({ title, note, action, first }: { title: string; note?: ReactNode; action?: ReactNode; first?: boolean }) {
  return (
    <div className={packHead({ isFirst: !!first })}>
      <span className={packTitle}>{title}</span>
      {note ? <span className={packNote}>{note}</span> : null}
      {action ? <span className={packAction}>{action}</span> : null}
    </div>
  );
}

interface TileProps {
  canvas: { width: number; height: number };
  editable: boolean;
  onAdd(tile: ElementTile): void;
}

/**
 * 可视化子页（设计稿 `VizSection`）：「全部」下是进度条、声波两小段，各摆前几格、各带「查看全部」切过去；
 * 「进度」摆进度网格（计时两格夹在里面），「声波」摆 10 款。搜索时两段各摆全部命中的。
 */
function Visualizers({
  items,
  sub,
  limit,
  onMore,
  ...tiles
}: TileProps & { items: ElementTile[]; sub: VizSub; limit: number | null; onMore(sub: VizSub): void }) {
  const progress = items.filter((t) => t.group === 'progress' || t.group === 'counter');
  const waves = items.filter((t) => t.group === 'wave');
  if (sub === 'progress') return <ProgressGrid items={progress} {...tiles} />;
  if (sub === 'wave') return <TileGrid className={waveGrid} items={waves} face="wave" labels {...tiles} />;
  const cut = (list: ElementTile[]) => (limit === null ? list : list.slice(0, limit));
  const more = (list: ElementTile[], key: VizSub) => (limit !== null && list.length > limit ? <ViewAll onPress={() => onMore(key)} /> : null);
  return (
    <>
      {progress.length ? (
        <>
          <PackHead first title={EL.progressBars} action={more(progress, 'progress')} />
          <ProgressGrid items={cut(progress)} {...tiles} />
        </>
      ) : null}
      {waves.length ? (
        <>
          <PackHead first={!progress.length} title={EL.wave} action={more(waves, 'wave')} />
          <TileGrid className={waveGrid} items={cut(waves)} face="wave" labels {...tiles} />
        </>
      ) : null}
    </>
  );
}

/** 「我的贴纸」那一组要的东西：这一页命中的品牌库贴纸、读好了没有、搜的词、点一格怎么放。 */
interface BrandProps {
  stickers: BrandSticker[];
  ready: boolean;
  query: string;
  onAdd(sticker: BrandSticker): void;
}

/** 「我的贴纸」这一组摆不摆：「全部」下搜索没命中就不摆（别处有命中），单看「我的贴纸」时总摆（好说没找到）。 */
const showMine = (sub: string, brand: BrandProps) => sub !== 'builtin' && sub !== 'confetti' && (sub === 'brand' || !brand.query || brand.stickers.length > 0);

/**
 * 贴纸子页（设计稿 `StickerSection`）：先「我的贴纸」（用户自己的东西先于随包目录），再内置的十款模板。
 */
function Stickers({ sub, items, brand, ...tiles }: TileProps & { sub: StickerSub; items: ElementTile[]; brand: BrandProps }) {
  const withMine = showMine(sub, brand);
  return (
    <>
      {withMine ? <BrandStickerGrid first anim={false} brand={brand} editable={tiles.editable} /> : null}
      {sub !== 'brand' && items.length ? (
        <>
          <PackHead first={!withMine} title={EL.builtin} note={EL.builtinCount(items.length)} />
          <TileGrid className={grid} items={items} {...tiles} />
        </>
      ) : null}
    </>
  );
}

/**
 * 动态贴纸子页（设计稿 `AnimPackSection`）：先品牌库里的 Lottie（「我的贴纸」），再彩纸十款（算法粒子，不是动图）。
 */
function Dynamic({ sub, items, brand, ...tiles }: TileProps & { sub: DynSub; items: ElementTile[]; brand: BrandProps }) {
  const withMine = showMine(sub, brand);
  return (
    <>
      {withMine ? <BrandStickerGrid first anim brand={brand} editable={tiles.editable} /> : null}
      {sub !== 'brand' && items.length ? (
        <>
          <PackHead first={!withMine} title={EL.confetti} note={EL.confettiNote} />
          <TileGrid className={animGrid} items={items} {...tiles} />
        </>
      ) : null}
      {brand.query ? null : (
        <div className={hint}>
          {EL.dynamicHint}
        </div>
      )}
    </>
  );
}

/**
 * 「我的贴纸」（设计稿 `BrandStickerGrid`）：品牌库里上传的贴纸，贴纸与动态贴纸两页各摆各的（图片 / Lottie，不重复）。
 * 点一格就拷进视频、放到播放头处（与品牌页的「放进视频」同一条路）。空着时是路牌：东西从哪来、去哪传。
 */
function BrandStickerGrid({ anim, brand, editable, first }: { anim: boolean; brand: BrandProps; editable: boolean; first?: boolean }) {
  const { stickers, ready, query, onAdd } = brand;
  return (
    <>
      <PackHead
        first={first}
        title={EL.myStickers}
        note={stickers.length ? EL.stickerCount(stickers.length) : EL.fromBrand}
        action={<ViewAll onPress={() => useEditor.getState().showPanel('brand')}>{EL.uploadToBrand}</ViewAll>}
      />
      {stickers.length ? (
        <div className={anim ? animGrid : grid}>
          {stickers.map((sticker) => (
            <BrandTile key={sticker.summary.id} sticker={sticker} editable={editable} onAdd={onAdd} />
          ))}
        </div>
      ) : query ? (
        <div className={emptyBox}>
          <span className={emptyText}>{EL.noMine(query)}</span>
        </div>
      ) : !ready ? (
        <div className={emptyBox}>
          <span className={emptyText}>{EL.readingBrand}</span>
        </div>
      ) : (
        <div className={emptyBox}>
          <span className={emptyTitle}>{anim ? EL.noOwnDynamic : EL.noOwnStatic}</span>
          <span className={emptyText}>
            {anim
              ? EL.dynamicAccepts
              : EL.staticAccepts}
          </span>
        </div>
      )}
      {query ? null : <div className={signpost}>{EL.signpost}</div>}
    </>
  );
}

function BrandTile({ sticker, editable, onAdd }: { sticker: BrandSticker; editable: boolean; onAdd(sticker: BrandSticker): void }) {
  const name = sticker.summary.name;
  return (
    <TooltipTrigger delay={600}>
      <RACButton className={tile} aria-label={EL.addNamed(name)} isDisabled={!editable} onPress={() => onAdd(sticker)}>
        {({ isHovered }) => (
          <span className={face({ isHovered, shape: 'square', isDark: false })}>
            <BrandStickerThumb summary={sticker.summary} lottie={sticker.dynamic} playing={isHovered} />
          </span>
        )}
      </RACButton>
      <Tooltip>{name}</Tooltip>
    </TooltipTrigger>
  );
}

function ProgressGrid({ items, ...tiles }: TileProps & { items: ElementTile[] }) {
  return (
    <div className={progressGrid}>
      {items.map((item) => (
        <Tile key={item.key} item={item} face={item.wide ? 'stretch' : 'square'} label className={item.wide ? span2 : undefined} {...tiles} />
      ))}
    </div>
  );
}

function TileGrid({
  className,
  items,
  face: shape = 'square',
  labels = false,
  ...tiles
}: TileProps & { className: string; items: ElementTile[]; face?: FaceShape; labels?: boolean }) {
  return (
    <div className={className}>
      {items.map((item) => (
        <Tile key={item.key} item={item} face={shape} label={labels} {...tiles} />
      ))}
    </div>
  );
}

type FaceShape = 'square' | 'wave' | 'stretch';

function Tile({
  item,
  face: shape,
  label,
  className,
  canvas,
  editable,
  onAdd,
}: TileProps & { item: ElementTile; face: FaceShape; label: boolean; className?: string }) {
  return (
    <TooltipTrigger delay={600}>
      <RACButton
        className={(state) => `${tile(state)}${className ? ` ${className}` : ''}`}
        aria-label={EL.addNamed(item.label)}
        isDisabled={!editable}
        onPress={() => onAdd(item)}>
        {({ isHovered }) => (
          <>
            <span className={face({ isHovered, shape, isDark: !!item.confetti })}>
              <ElementThumb tile={item} canvas={canvas} playing={isHovered} />
            </span>
            {label ? <span className={tileLabel}>{item.label}</span> : null}
          </>
        )}
      </RACButton>
      <Tooltip>{item.label}</Tooltip>
    </TooltipTrigger>
  );
}
