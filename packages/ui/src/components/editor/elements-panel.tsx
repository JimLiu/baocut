import { Fragment, useEffect, useState, type ReactNode } from 'react';
import {
  ANIMATED_STICKER_PACKS,
  STICKER_PACKS,
  packStickers,
  type AssetRecord,
  type Id,
  type PackSticker,
  type Sequence,
  type StickerPack,
} from '@baocut/protocol';
import {
  ActionButton,
  Header,
  Heading,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  SearchField,
  Text,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2';
import Animation from '@react-spectrum/s2/icons/Animation';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import More from '@react-spectrum/s2/icons/More';
import Search from '@react-spectrum/s2/icons/Search';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton } from 'react-aria-components';
import { ELEMENT_TILES, VISUALIZER_PEEK, elementSections, type ElementSection, type ElementTile } from '../../model/element-catalog.ts';
import { frameAt } from '../../model/editor.ts';
import { stickerMatches } from '../../model/library-brand.ts';
import { spanAtPlayhead, wholeFilmSpan } from '../../model/new-items.ts';
import { STICKER_PACK_COPY as SP } from '../../model/sticker-pack-copy.ts';
import {
  CHIP_PACKS,
  CTA_PACK,
  confettiAt,
  findPack,
  headStickers,
  matchPacks,
  packLabel,
  packStickerName,
  restPacks,
} from '../../model/sticker-packs.ts';
import type { TemplateGroup } from '../../model/template-layers.ts';
import { useEditor } from '../../state/editor-store.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { BrandStickerThumb, ElementThumb, PackStickerThumb } from './element-thumb.tsx';
import { TemplateList, templateMatches } from './elements-templates.tsx';
import { SecHead } from './inspector-controls.tsx';
import { PanelChips, PanelHead, panelBody } from './panel-head.tsx';
import { useBrandApply } from './use-brand-apply.ts';
import { useBrandStickers, type BrandSticker } from './use-brand-stickers.ts';
import { useInsertVisual } from './use-insert-visual.ts';
import { usePackSticker } from './use-pack-sticker.ts';
import { useTemplateActions } from './use-template-actions.ts';
import { useTemplateCatalog } from './use-template-catalog.ts';
import { useTemplateStudio } from './use-template-studio.ts';
import { ELEMENTS_COPY as EL } from './elements-copy.ts';
import { TEMPLATE_COPY as TC } from './template-copy.ts';

/** 目录页每一段摆几格，多的走「查看全部」。 */
const PEEK = 4;

type Section = ElementSection['key'];
/** 钻进去的那一页：元素目录的几段，加上模板（BaoCut 特有，不占顶层 chip，只有目录页的「查看全部」与组 chip 钻得进去）。 */
type Page = Section | 'all' | 'template';
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
 * 贴纸的二级分类（设计稿 `stickerChips`）：「全部」「我的贴纸」，再是 chip 上的随包贴纸包（精选、表情）；其余的包与内置的十款
 * 进「⋯」。值是 `all`、`brand`、`builtin` 或包的 key。
 */
type StickerSub = string;
const stickerChips = (): { key: StickerSub; label: string }[] => [
  { key: 'all', label: EL.all },
  { key: 'brand', label: EL.myStickers },
  ...CHIP_PACKS.map((key) => ({ key, label: packLabel(findPack(key)!) })),
];
/** 「⋯」里的：其余的随包贴纸包按目录原序，最后是内置的十款（BaoCut 自己画的）。 */
const stickerRest = (builtinCount: number): { key: StickerSub; label: string; count: number }[] => [
  ...restPacks().map((pack) => ({ key: pack.key, label: packLabel(pack), count: pack.files.length })),
  { key: 'builtin', label: EL.builtin, count: builtinCount },
];

/**
 * 动态贴纸的二级分类（设计稿 `animCats`）：「全部」「我的贴纸」，再是五个 Noto 分类，彩纸按分类键的字母序插在拼贴之后。
 * 值是 `all`、`brand`、`confetti` 或包的 key。
 */
type DynSub = string;
const dynChips = (): { key: DynSub; label: string }[] => {
  const packs = ANIMATED_STICKER_PACKS.map((pack) => ({ key: pack.key, label: packLabel(pack) }));
  packs.splice(confettiAt(ANIMATED_STICKER_PACKS), 0, { key: 'confetti', label: EL.confetti });
  return [{ key: 'all', label: EL.all }, { key: 'brand', label: EL.myStickers }, ...packs];
};

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

/** 模板子页的组 chip（原型 `tplChips`）：「全部」加当前有模板的组。 */
const templateChips = (groups: readonly TemplateGroup[]) => [
  {
    key: 'all',
    get label() {
      return EL.all;
    },
  },
  ...groups.map((g) => ({ key: g.key, label: g.label })),
];

/** 搜索时模板目录里留下的：每组只留命中的，空组不摆。 */
function filterGroups(groups: readonly TemplateGroup[], query: string): TemplateGroup[] {
  if (!query.trim()) return [...groups];
  return groups
    .map((g) => ({ ...g, items: g.items.filter((entry) => templateMatches(entry, g, query)) }))
    .filter((g) => g.items.length > 0);
}

const byKey = (keys: readonly string[]) => keys.map((key) => ELEMENT_TILES.find((t) => t.key === key)).filter((t): t is ElementTile => !!t);

/**
 * 元素面板（原型 §14）：目录页是贴纸、形状、可视化几段各摆几格，「查看全部」或分节头下的
 * 二级分类钻进那一段；点一格就在播放头处新建一条并选中。最后一段是模板（视频格式规范 §3.17）：点一行就套到这部视频上。
 */
export function ElementsPanel({ sequence, assets }: { sequence: Sequence; assets: Record<Id, AssetRecord> }) {
  const [tab, setTab] = useState<Page>('all');
  const [tgrp, setTgrp] = useState('all');
  const [viz, setViz] = useState<VizSub>('all');
  const [dyn, setDyn] = useState<DynSub>('all');
  const [stk, setStk] = useState<StickerSub>('all');
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const editable = useVideo((s) => canEdit(s.video));
  const insert = useInsertVisual();
  const applyBrand = useBrandApply();
  const brand = useBrandStickers();
  const templates = useTemplateActions();
  const studio = useTemplateStudio();
  const { groups: allGroups, builtinCount } = useTemplateCatalog();
  const root = tab === 'all';
  const q = query.trim();
  const groups = filterGroups(allGroups, q);
  const showTemplates = (root || tab === 'template') && groups.length > 0;
  // 品牌库贴纸：图片进贴纸那一段，Lottie 进动态贴纸那一段；搜索时命中了，那一段就留着。
  const mine = (dynamic: boolean): BrandProps => ({
    stickers: brand.stickers.filter((sticker) => sticker.dynamic === dynamic && stickerMatches(sticker.summary.name, dynamic, q)),
    ready: brand.ready,
    query: q,
    onAdd: (sticker) => void applyBrand(sticker.entry),
  });
  const mineStatic = mine(false);
  const mineDynamic = mine(true);
  // 随包贴纸包：搜索按包名与检索词整包留下；命中了，那一段也得留着。
  const stickerPacks = matchPacks(STICKER_PACKS, q);
  const animPacks = matchPacks(ANIMATED_STICKER_PACKS, q);
  const keep: Section[] = [
    ...(mineStatic.stickers.length || stickerPacks.length ? ['sticker' as const] : []),
    ...(mineDynamic.stickers.length || animPacks.length ? ['dynamic' as const] : []),
  ];
  const sections = elementSections(query, keep).filter((section) => root || section.key === tab);
  const current =
    tab === 'template'
      ? { title: TC.section, note: TC.sectionNote(builtinCount) }
      : root
        ? null
        : elementSections().find((section) => section.key === tab);
  const peeking = root && !query.trim();
  // CTA 弹窗（设计稿目录页的一段）：只在目录页不搜索时单独摆；搜索时它跟着贴纸那一段走，免得同一包摆两次。
  const cta = findPack(CTA_PACK)!;
  const showCta = peeking;
  const addPack = usePackSticker();

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
    setTgrp('all');
  };
  const open = (section: Section | 'template', sub?: string) => {
    if (section === 'template') setTgrp(sub ?? 'all');
    if (section === 'visualizer') setViz((sub as VizSub | undefined) ?? 'all');
    if (section === 'dynamic') setDyn(sub ?? 'all');
    if (section === 'sticker') setStk(sub ?? 'all');
    setTab(section);
  };
  const tiles = { canvas: sequence.canvas, editable, onAdd: add };
  const packTiles: PackTileProps = { editable, onAdd: (sticker) => void addPack(sticker) };
  const builtinStickers = ELEMENT_TILES.filter((tile) => tile.group === 'sticker').length;
  // 模板属性页的「换一套」：翻到模板目录。
  const request = useEditor((s) => s.elementsPage);
  useEffect(() => {
    if (request !== 'template') return;
    useEditor.getState().clearElementsPage();
    setQuery('');
    setSearching(false);
    open('template');
    // open 只用 setter。
  }, [request]);

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
      {tab === 'sticker' ? (
        <PanelChips<StickerSub> label={EL.stickerCategories} items={stickerChips()} value={stk} onChange={setStk}>
          <MorePacks items={stickerRest(builtinStickers)} value={stk} onChange={setStk} />
        </PanelChips>
      ) : null}
      {tab === 'visualizer' ? <PanelChips<VizSub> label={EL.visualizerCategories} items={VIZ_CHIPS} value={viz} onChange={setViz} /> : null}
      {tab === 'dynamic' ? <PanelChips<DynSub> label={EL.dynamicCategories} items={dynChips()} value={dyn} onChange={setDyn} /> : null}
      {tab === 'template' ? (
        <PanelChips<string> label={TC.categories} items={templateChips(allGroups)} value={tgrp} onChange={setTgrp} />
      ) : null}
      <div className={`${panelBody} bc-scroll`}>
        {sections.length || showTemplates ? (
          sections.map((section, index) => (
            <div key={section.key}>
              {root ? (
                <>
                  <SecHead
                    first={index === 0}
                    aside={section.note}
                    action={
                      peeking && (section.key === 'sticker' || section.key === 'dynamic' || section.tiles.length > PEEK) ? (
                        <ViewAll onPress={() => open(section.key)} />
                      ) : null
                    }>
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
              {section.key === 'sticker' ? (
                peeking ? (
                  <PackTileGrid className={grid} stickers={headStickers(STICKER_PACKS, PEEK)} {...packTiles} />
                ) : (
                  <Stickers sub={root ? 'all' : stk} items={section.tiles} packs={stickerPacks} brand={mineStatic} pack={packTiles} {...tiles} />
                )
              ) : section.key === 'dynamic' ? (
                peeking ? (
                  // 目录页那一屏（设计稿 `AnimPackPeek`）：第一格是彩纸，其余各分类轮流取一张。
                  <div className={grid}>
                    {section.tiles.slice(0, 1).map((item) => (
                      <Tile key={item.key} item={item} face="square" label={false} {...tiles} />
                    ))}
                    {headStickers(ANIMATED_STICKER_PACKS, PEEK - 1).map((sticker) => (
                      <PackTile key={sticker.id} sticker={sticker} {...packTiles} />
                    ))}
                  </div>
                ) : (
                  <Dynamic sub={root ? 'all' : dyn} items={section.tiles} packs={animPacks} brand={mineDynamic} pack={packTiles} {...tiles} />
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
        {showCta ? (
          <div>
            <SecHead first={sections.length === 0} aside={SP.ctaNote} action={<ViewAll onPress={() => open('sticker', CTA_PACK)} />}>
              {SP.ctaTitle}
            </SecHead>
            <PackTileGrid className={grid} stickers={packStickers(cta).slice(0, PEEK)} {...packTiles} />
          </div>
        ) : null}
        {showTemplates ? (
          <div>
            {root ? (
              <>
                <SecHead
                  first={sections.length === 0}
                  aside={TC.sectionNote(builtinCount)}
                  action={peeking ? <ViewAll onPress={() => open('template')} /> : null}
                >
                  {TC.section}
                </SecHead>
                {peeking ? (
                  <SubChips label={TC.categories} items={templateChips(allGroups)} onPick={(key) => open('template', key)} />
                ) : null}
              </>
            ) : null}
            <TemplateList
              groups={groups}
              group={root ? null : q ? 'all' : tgrp}
              peek={peeking ? PEEK : null}
              current={sequence.template}
              editable={editable}
              onApply={(doc) => void templates.apply(sequence, assets, doc)}
              onMakeOwn={studio.makeOwn}
            />
          </div>
        ) : null}
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
const showMine = (sub: string, brand: BrandProps) => sub === 'brand' || (sub === 'all' && (!brand.query || brand.stickers.length > 0));

/** 子页里摆哪些随包贴纸包：「全部」下是搜索命中的那些；钉在某一个包上时就是那一包（设计稿 `PackGrid`，不再按搜索筛）。 */
function shownPacks(sub: string, packs: readonly StickerPack[]): StickerPack[] {
  if (sub === 'all') return [...packs];
  const pack = findPack(sub);
  return pack ? [pack] : [];
}

/**
 * 贴纸子页（设计稿 `StickerSection`）：先「我的贴纸」（用户自己的东西先于随包目录），再随包贴纸包，最后内置的十款。
 */
function Stickers({
  sub,
  items,
  packs,
  brand,
  pack,
  ...tiles
}: TileProps & { sub: StickerSub; items: ElementTile[]; packs: StickerPack[]; brand: BrandProps; pack: PackTileProps }) {
  const withMine = showMine(sub, brand);
  const shown = shownPacks(sub, packs);
  const withBuiltin = (sub === 'all' || sub === 'builtin') && items.length > 0;
  return (
    <>
      {withMine ? <BrandStickerGrid first anim={false} brand={brand} editable={tiles.editable} /> : null}
      {shown.map((p, index) => (
        <PackGrid key={p.key} first={!withMine && index === 0} pack={p} className={grid} {...pack} />
      ))}
      {withBuiltin ? (
        <>
          <PackHead first={!withMine && !shown.length} title={EL.builtin} note={EL.builtinCount(items.length)} />
          <TileGrid className={grid} items={items} {...tiles} />
        </>
      ) : null}
    </>
  );
}

/**
 * 动态贴纸子页（设计稿 `AnimPackSection`）：先品牌库里的 Lottie（「我的贴纸」），再五个 Noto 分类，彩纸十款（算法粒子，
 * 不是动图）按分类键的字母序插在拼贴之后。
 */
function Dynamic({
  sub,
  items,
  packs,
  brand,
  pack,
  ...tiles
}: TileProps & { sub: DynSub; items: ElementTile[]; packs: StickerPack[]; brand: BrandProps; pack: PackTileProps }) {
  const withMine = showMine(sub, brand);
  const shown = shownPacks(sub, packs);
  const withConfetti = (sub === 'all' || sub === 'confetti') && items.length > 0;
  const at = withConfetti ? confettiAt(shown) : -1;
  const confetti = (first: boolean) => (
    <Fragment key="confetti">
      <PackHead first={first} title={EL.confetti} note={EL.confettiNote} />
      <TileGrid className={animGrid} items={items} {...tiles} />
    </Fragment>
  );
  return (
    <>
      {withMine ? <BrandStickerGrid first anim brand={brand} editable={tiles.editable} /> : null}
      {shown.map((p, index) => (
        <Fragment key={p.key}>
          {at === index ? confetti(!withMine && index === 0) : null}
          <PackGrid first={!withMine && index === 0 && at !== 0} pack={p} className={animGrid} {...pack} />
        </Fragment>
      ))}
      {withConfetti && at >= shown.length ? confetti(!withMine && !shown.length) : null}
      {brand.query ? null : (
        <div className={hint}>
          {sub === 'all' || findPack(sub) ? `${SP.notoHint} ` : null}
          {EL.dynamicHint}
        </div>
      )}
    </>
  );
}

/** 随包贴纸格要的东西：能不能改、点一格怎么放（拷进视频再新建一层）。 */
interface PackTileProps {
  editable: boolean;
  onAdd(sticker: PackSticker): void;
}

/** 一个随包贴纸包（设计稿 `PackGrid`）：包头写包名与张数，下面是这一包的全部贴纸。 */
function PackGrid({ pack, first, className, ...props }: PackTileProps & { pack: StickerPack; first?: boolean; className: string }) {
  return (
    <>
      <PackHead first={first} title={packLabel(pack)} note={SP.packCount(pack.files.length)} />
      <PackTileGrid className={className} stickers={packStickers(pack)} {...props} />
    </>
  );
}

function PackTileGrid({ className, stickers, ...props }: PackTileProps & { className: string; stickers: readonly PackSticker[] }) {
  return (
    <div className={className}>
      {stickers.map((sticker) => (
        <PackTile key={sticker.id} sticker={sticker} {...props} />
      ))}
    </div>
  );
}

/** 一格随包贴纸：SVG 直接摆，Lottie 停在一帧、鼠标移上去才播。 */
function PackTile({ sticker, editable, onAdd }: PackTileProps & { sticker: PackSticker }) {
  const name = packStickerName(sticker);
  return (
    <TooltipTrigger delay={600}>
      <RACButton className={tile} aria-label={EL.addNamed(name)} isDisabled={!editable} onPress={() => onAdd(sticker)}>
        {({ isHovered }) => (
          <span className={face({ isHovered, shape: 'square', isDark: false })}>
            <PackStickerThumb sticker={sticker} playing={isHovered} />
          </span>
        )}
      </RACButton>
      <Tooltip>{name}</Tooltip>
    </TooltipTrigger>
  );
}

/**
 * 贴纸 chip 那一行最后的「⋯」（设计稿 `StickerPackChips`）：其余的包与内置的十款；选中了其中一个，这一格就写它的名字。
 */
function MorePacks({
  items,
  value,
  onChange,
}: {
  items: readonly { key: string; label: string; count: number }[];
  value: string;
  onChange(key: string): void;
}) {
  const on = items.find((item) => item.key === value);
  return (
    <MenuTrigger>
      <ActionButton size="S" isQuiet={!on} aria-label={SP.morePacks}>
        {on ? <Text>{on.label}</Text> : <More />}
      </ActionButton>
      <Menu aria-label={SP.morePacks} onAction={(key) => onChange(String(key))}>
        <MenuSection selectionMode="single" selectedKeys={on ? [on.key] : []}>
          <Header>
            <Heading>{SP.packMenuHead(STICKER_PACKS.length)}</Heading>
          </Header>
          {items.map((item) => (
            <MenuItem key={item.key} id={item.key} textValue={item.label}>
              <Text slot="label">{item.label}</Text>
              <Text slot="description">{SP.packCount(item.count)}</Text>
            </MenuItem>
          ))}
        </MenuSection>
      </Menu>
    </MenuTrigger>
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
