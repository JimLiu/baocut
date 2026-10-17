import { useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react';
import type { AssetRecord, Id, SpaceEntry } from '@baocut/protocol';
import {
  ActionButton,
  Button,
  Header,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  SegmentedControl,
  SegmentedControlItem,
  Slider,
  Text,
  ToastQueue,
} from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import Close from '@react-spectrum/s2/icons/Close';
import ImageIcon from '@react-spectrum/s2/icons/Image';
import Upload from '@react-spectrum/s2/icons/Upload';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { M as IMG } from '../../model/tools-image-copy.ts';
import {
  addRefs,
  editsByPrompt,
  imageRefMode,
  imageRefModes,
  refKey,
  refRoom,
  refsCount,
  refsNote,
  strengthFor,
  type ImageDraft,
  type ImageOption,
  type ImageRef,
} from '../../model/tools-image.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useSpace } from '../../state/space-store.ts';
import { useAssetUrl } from '../editor/use-asset-url.ts';
import { useEntryThumbnail } from '../use-entry-thumbnail.ts';
import { IMAGE_COPY } from './tools-copy.ts';

/*
 * 参考图一行与它的用法（设计稿 image-gen.jsx `RefsRow`、`RefModeRow`）：工具页从 Space 的图片里选，编辑器从这个视频的图片素材里选；
 * 桌面端都还能从文件选、把图片粘贴或拖进提示词框与这一行（[`ImageRefsZone`]；浏览器里拿不到本机路径，那一项置灰写原因）。
 * 认不认、上限几张、能不能以图为底重画看能力描述。
 */

const ACCEPTED = new Set(['image/png', 'image/jpeg', 'image/webp']);
/** 菜单里最多列几张（最近的在前）。 */
const MENU_LIMIT = 40;

const row = style({ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 });
/** 收图的区域（提示词框连同参考图一行）：拖着图片进来时描一圈虚线。工具页的一节里按列排、间距 8，编辑器面板里照常流式排。 */
const zone = style({
  display: { default: 'block', isStack: 'flex' },
  flexDirection: 'column',
  gap: 8,
  minWidth: 0,
  borderRadius: 'default',
  outlineStyle: { default: 'none', isOver: 'dashed' },
  outlineWidth: 2,
  outlineColor: 'blue-800',
  outlineOffset: 4,
});
const head = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });
const headLabel = style({ font: 'detail', fontWeight: 'bold', color: 'gray-700' });
const counter = style({ font: 'ui-xs', color: { default: 'gray-600', isOver: 'red-900' } });
const chips = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, minWidth: 0 });
const chip = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  maxWidth: 220,
  minWidth: 0,
  paddingStart: 4,
  paddingEnd: 0,
  paddingY: 2,
  borderRadius: 'default',
  borderWidth: 1,
  borderStyle: { default: 'solid', isInvalid: 'dashed' },
  borderColor: { default: 'gray-300', isInvalid: 'red-800' },
  backgroundColor: 'gray-50',
});
const chipThumb = style({
  display: 'grid',
  placeItems: 'center',
  flexShrink: 0,
  width: 28,
  height: 28,
  overflow: 'hidden',
  borderRadius: 'sm',
  backgroundColor: 'gray-200',
  color: 'gray-600',
});
const chipImg = style({ display: 'block', width: 'full', height: 'full', objectFit: 'cover' });
const chipName = style({ font: 'ui-xs', color: 'gray-900', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 });
const note = style({ flexGrow: 1, minWidth: 0, font: 'ui-xs', color: 'gray-600', lineHeight: '[1.5]', overflowWrap: 'anywhere' });
const modeRow = style({ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 });
const strengthField = style({ width: 'full', maxWidth: 320 });

/** 参考图从哪儿挑：工具页是 Space，编辑器是这个视频的图片素材。 */
export type RefSource = { kind: 'space' } | { kind: 'video'; videoId: Id; assets: Record<Id, AssetRecord> };

interface RefsProps {
  draft: ImageDraft;
  option: ImageOption;
  patch: (patch: Partial<ImageDraft>) => void;
  source: RefSource;
}

/** 能挑的 Space 图片：没进废纸篓、不是缺失或生成中的。 */
function spaceImages(entries: readonly SpaceEntry[]): SpaceEntry[] {
  return entries.filter((e) => e.kind === 'image' && !e.user.trashedAt && e.status !== 'missing' && e.status !== 'generating' && e.status !== 'failed');
}

/** 能挑的素材：当前版本是 PNG、JPEG、WebP 的图片。 */
function videoImages(assets: Record<Id, AssetRecord>): AssetRecord[] {
  return Object.values(assets).filter((a) => a.kind === 'image' && ACCEPTED.has(a.revisions[a.currentRevision]?.mediaType ?? ''));
}

/** 能不能把粘贴、拖进来的图收成参考图：要拿得到本机路径（桌面端），或能把没有路径的图写成临时文件。 */
function takesLocalImages(host: { pickFiles?: unknown; writeImageRef?: unknown }): boolean {
  return !!host.pickFiles || !!host.writeImageRef;
}

/**
 * 把粘贴或拖进来的图片收成参考图（提示词框与参考图一行都收）。桌面端拿得到本机路径的直接用；截图、从浏览器拖来的图只有字节，
 * 经宿主写进临时文件（`writeImageRef`）。不是 PNG、JPEG、WebP 的跳过并提示，超出上限的不加并提示。只拦带文件的粘贴，文字照常进
 * 提示词框；浏览器里拿不到本机路径，带图的粘贴只提示一句，拖放不接。
 */
function useImageRefIntake({ draft, option, patch }: Omit<RefsProps, 'source'>) {
  const runtime = useRuntime();
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  // 写临时文件要等；等完按那时的草稿加，不用事件发生时的旧值。
  const latest = useRef(draft);
  latest.current = draft;
  const info = option.info;
  const supported = !!info.referenceImages;
  const local = takesLocalImages(runtime.host);
  const acceptsDrag = supported && local && refRoom(draft, info) > 0;

  const resolve = async (file: File): Promise<string> => {
    const path = runtime.host.pathForFile(file);
    if (path || !runtime.host.writeImageRef) return path;
    try {
      return await runtime.host.writeImageRef(new Uint8Array(await file.arrayBuffer()));
    } catch (error) {
      ToastQueue.negative(IMG.refsAddFailed(file.name, (error as Error).message), { timeout: 5000 });
      return '';
    }
  };

  const take = async (files: File[]) => {
    const images = files.filter((f) => ACCEPTED.has(f.type));
    if (files.length > images.length) ToastQueue.neutral(IMG.refsSkipped(files.length - images.length), { timeout: 4000 });
    if (!images.length || !info.referenceImages) return;
    const room = refRoom(latest.current, info);
    const resolved = await Promise.all(images.slice(0, room).map(async (f) => ({ path: await resolve(f), name: f.name })));
    const more: ImageRef[] = resolved.flatMap(({ path, name }) => (path ? [{ path, name: name || path.split(/[\\/]/).pop() || path }] : []));
    const current = latest.current.refs;
    const { refs, dropped } = addRefs(current, more, refRoom(latest.current, info));
    if (refs.length !== current.length) patch({ refs });
    const left = dropped + Math.max(0, images.length - room);
    if (left > 0) ToastQueue.neutral(IMG.refsNotAdded(info.referenceImages.max, left), { timeout: 4000 });
  };

  const carriesFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');
  const handlers = {
    onDragEnterCapture: (event: DragEvent) => {
      if (!acceptsDrag || !carriesFiles(event)) return;
      event.preventDefault();
      depth.current++;
      setOver(true);
    },
    onDragOverCapture: (event: DragEvent) => {
      if (!acceptsDrag || !carriesFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    // 移进子元素（提示词框、按钮）时也会触发 dragleave：数进出的层数，全离开了才收起描边。
    onDragLeaveCapture: (event: DragEvent) => {
      if (!acceptsDrag || !carriesFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setOver(false);
    },
    onDropCapture: (event: DragEvent) => {
      if (!acceptsDrag || !carriesFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      depth.current = 0;
      setOver(false);
      void take([...event.dataTransfer.files]);
    },
    onPasteCapture: (event: ClipboardEvent) => {
      const files = [...event.clipboardData.files];
      if (!supported || !files.length) return;
      event.preventDefault();
      event.stopPropagation();
      if (!local) {
        ToastQueue.neutral(IMG.refsWebNote, { timeout: 4000 });
        return;
      }
      void take(files);
    },
  };
  return { over, handlers };
}

/**
 * 收参考图的区域：包住提示词框与参考图一行，粘贴、拖进来的图片都收成参考图（[`useImageRefIntake`]）。还没有模型时只是普通容器。
 * `stack` 在工具页的一节里用（按列排、间距 8）；编辑器面板里不给，照常流式排。
 */
export function ImageRefsZone({
  draft,
  option,
  patch,
  stack = false,
  children,
}: Omit<RefsProps, 'source' | 'option'> & { option: ImageOption | null; stack?: boolean; children: ReactNode }) {
  if (!option) return <div className={zone({ isStack: stack, isOver: false })}>{children}</div>;
  return (
    <IntakeZone draft={draft} option={option} patch={patch} stack={stack}>
      {children}
    </IntakeZone>
  );
}

function IntakeZone({ draft, option, patch, stack, children }: Omit<RefsProps, 'source'> & { stack: boolean; children: ReactNode }) {
  const { over, handlers } = useImageRefIntake({ draft, option, patch });
  return (
    <div className={zone({ isStack: stack, isOver: over })} {...handlers}>
      {children}
    </div>
  );
}

/** 提示词框的占位文字：按提示词改第一张图时说清要怎么改（含糊的「画完整」之类多半原样出图），别的时候描述画面。 */
export function imagePromptPlaceholder(draft: ImageDraft, option: ImageOption | null): string {
  return option && editsByPrompt(draft, option.info) ? IMG.promptEditPlaceholder : IMAGE_COPY.promptPlaceholder;
}

/** 参考图一行：已选的几张（超出上限、找不到的标出来）、加图的菜单，和一句说明。粘贴与拖放由外面的 [`ImageRefsZone`] 收。 */
export function ImageRefsRow({ draft, option, patch, source }: RefsProps) {
  const runtime = useRuntime();
  const entries = useSpace((s) => s.entries);
  const info = option.info;
  const supported = !!info.referenceImages;
  const room = refRoom(draft, info);
  const canPick = !!runtime.host.pickFiles;
  const count = refsCount(draft, info);
  const chosen = new Set(draft.refs.map(refKey));

  const pool = useMemo(() => {
    if (source.kind === 'space') return spaceImages(entries).map((e) => ({ ref: { entryId: e.id, name: e.name } as ImageRef, sub: null }));
    return videoImages(source.assets).map((a) => ({ ref: { assetId: a.id, name: a.name } as ImageRef, sub: null }));
  }, [source, entries]);
  const offered = pool.filter((p) => !chosen.has(refKey(p.ref))).slice(0, MENU_LIMIT);

  const missing = (ref: ImageRef): boolean => {
    if ('entryId' in ref) return !spaceImages(entries).some((e) => e.id === ref.entryId);
    if ('assetId' in ref) return source.kind !== 'video' || !source.assets[ref.assetId];
    return false;
  };

  const add = (more: ImageRef[]) => {
    const { refs, dropped } = addRefs(draft.refs, more, room);
    if (refs.length !== draft.refs.length) patch({ refs });
    if (dropped > 0 && info.referenceImages) ToastQueue.neutral(IMG.refsNotAdded(info.referenceImages.max, dropped), { timeout: 4000 });
  };

  const pickFiles = async () => {
    const pick = runtime.host.pickFiles;
    if (!pick) return;
    const paths = await pick({
      title: IMAGE_COPY.pickRefs,
      buttonLabel: IMAGE_COPY.pickRefs,
      filters: [{ name: IMAGE_COPY.refs, extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      multiple: true,
    });
    if (paths?.length) add(paths.map((path) => ({ path, name: path.split(/[\\/]/).pop() || path })));
  };

  const acceptsDrop = supported && room > 0 && takesLocalImages(runtime.host);

  const onAction = (key: string) => {
    if (key === 'file') void pickFiles();
    else {
      const hit = offered.find((p) => refKey(p.ref) === key);
      if (hit) add([hit.ref]);
    }
  };

  const max = info.referenceImages?.max ?? 0;
  const text = [refsNote(draft, option), acceptsDrop ? IMG.refsDrop : null].filter(Boolean).join(' · ');

  return (
    <div className={row}>
      <div className={head}>
        <span className={headLabel}>{IMAGE_COPY.refs}</span>
        {count ? <span className={counter({ isOver: count.over })}>{count.text}</span> : null}
      </div>
      {draft.refs.length ? (
        <div className={chips} role="list" aria-label={IMAGE_COPY.refs}>
          {draft.refs.map((ref, i) => (
            <RefChip
              key={refKey(ref)}
              refItem={ref}
              source={source}
              invalid={!supported || i >= max || missing(ref)}
              missing={missing(ref)}
              onRemove={() => patch({ refs: draft.refs.filter((r) => refKey(r) !== refKey(ref)) })}
            />
          ))}
        </div>
      ) : null}
      <div className={head}>
        {supported ? (
          <MenuTrigger align="start">
            <Button variant="secondary" size="S" isDisabled={room === 0}>
              <Add />
              <Text>{draft.refs.length ? IMG.refsAddMore : IMAGE_COPY.pickRefs}</Text>
            </Button>
            <Menu aria-label={IMAGE_COPY.pickRefs} onAction={(key) => onAction(String(key))} disabledKeys={canPick ? ['empty'] : ['file', 'empty']}>
              <MenuSection>
                <MenuItem id="file" textValue={IMG.refsFromFile}>
                  <Upload />
                  <Text slot="label">{IMG.refsFromFile}</Text>
                  <Text slot="description">{canPick ? IMG.refsFromFileNote : IMG.refsWebNote}</Text>
                </MenuItem>
              </MenuSection>
              <MenuSection>
                <Header>{source.kind === 'space' ? IMG.refsFromSpace : IMG.refsFromLibrary}</Header>
                {offered.length ? (
                  offered.map((p) => (
                    <MenuItem key={refKey(p.ref)} id={refKey(p.ref)} textValue={p.ref.name}>
                      <ImageIcon />
                      <Text slot="label">{p.ref.name}</Text>
                    </MenuItem>
                  ))
                ) : (
                  <MenuItem id="empty" textValue={source.kind === 'space' ? IMG.refsNoSpaceImages : IMG.refsNoLibraryImages}>
                    <Text slot="label">{source.kind === 'space' ? IMG.refsNoSpaceImages : IMG.refsNoLibraryImages}</Text>
                  </MenuItem>
                )}
              </MenuSection>
            </Menu>
          </MenuTrigger>
        ) : (
          <Button variant="secondary" size="S" isDisabled>
            <Add />
            <Text>{IMAGE_COPY.pickRefs}</Text>
          </Button>
        )}
        {!supported && draft.refs.length ? (
          <ActionButton isQuiet size="S" onPress={() => patch({ refs: [] })}>
            <Text>{IMG.refsClear}</Text>
          </ActionButton>
        ) : null}
      </div>
      <span className={note}>{text}</span>
    </div>
  );
}

/** 一张已选的参考图：缩略（Space 条目与素材有，本机文件只有图标）、名字、去掉。 */
function RefChip({
  refItem,
  source,
  invalid,
  missing,
  onRemove,
}: {
  refItem: ImageRef;
  source: RefSource;
  invalid: boolean;
  missing: boolean;
  onRemove: () => void;
}) {
  const title = missing ? IMG.refsMissing(refItem.name) : 'path' in refItem ? refItem.path : refItem.name;
  return (
    <div className={chip({ isInvalid: invalid })} role="listitem" title={title}>
      <span className={chipThumb} aria-hidden>
        {'entryId' in refItem ? (
          <EntryThumb entryId={refItem.entryId} />
        ) : 'assetId' in refItem && source.kind === 'video' && source.assets[refItem.assetId] ? (
          <AssetThumb videoId={source.videoId} asset={source.assets[refItem.assetId]!} />
        ) : (
          <ImageIcon />
        )}
      </span>
      <span className={chipName}>{refItem.name}</span>
      <ActionButton isQuiet size="XS" aria-label={IMG.refsRemove(refItem.name)} onPress={onRemove}>
        <Close />
      </ActionButton>
    </div>
  );
}

function EntryThumb({ entryId }: { entryId: Id }) {
  const entry = useSpace((s) => s.entries.find((e) => e.id === entryId) ?? null);
  const thumbnail = useEntryThumbnail(entry);
  return thumbnail?.kind === 'image' ? <img className={chipImg} src={thumbnail.url} alt="" /> : <ImageIcon />;
}

function AssetThumb({ videoId, asset }: { videoId: Id; asset: AssetRecord }) {
  const { url } = useAssetUrl(videoId, { id: asset.id, revision: asset.currentRevision });
  return url ? <img className={chipImg} src={url} alt="" /> : <ImageIcon />;
}

/**
 * 参考图的用法与改动幅度（设计稿 `RefModeRow`）：模型能以图为底重画时才出这一行；改动幅度只在以图为底重画时出现。
 * 出几张由底图数决定，那时表单不给「数量」。
 */
export function ImageRefModeRow({ draft, option, patch }: Omit<RefsProps, 'source'>) {
  const info = option.info;
  const modes = imageRefModes(info);
  if (modes.length < 2 || !info.img2img) return null;
  const mode = imageRefMode(draft, info);
  const range = info.img2img.strength;
  return (
    <div className={modeRow}>
      <SegmentedControl aria-label={IMG.refModeLabel} selectedKey={mode} onSelectionChange={(key) => patch({ refMode: key === 'img2img' ? 'img2img' : 'ref' })}>
        {modes.map((m) => (
          <SegmentedControlItem key={m.key} id={m.key}>
            {m.label}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
      {mode === 'img2img' ? (
        <>
          <Slider
            label={IMG.strength}
            labelPosition="side"
            size="S"
            styles={strengthField}
            minValue={range.min}
            maxValue={range.max}
            step={range.step}
            formatOptions={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
            value={strengthFor(draft, info) ?? range.default}
            onChange={(strength) => patch({ strength })}
          />
          <span className={note}>{IMG.strengthNote}</span>
        </>
      ) : null}
    </div>
  );
}
