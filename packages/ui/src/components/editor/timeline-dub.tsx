import { useEffect, useMemo, useReducer, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { AssetRecord, DocumentRecord, Id, Sequence } from '@baocut/protocol';
import { itemRangeSeconds } from '@baocut/protocol';
import { Header, Heading, Menu, MenuItem, MenuSection, Text } from '@react-spectrum/s2';
import DeleteIcon from '@react-spectrum/s2/icons/Delete';
import EditIcon from '@react-spectrum/s2/icons/Edit';
import PlayIcon from '@react-spectrum/s2/icons/Play';
import RefreshIcon from '@react-spectrum/s2/icons/Refresh';
import VolumeOff from '@react-spectrum/s2/icons/VolumeOff';
import VolumeTwo from '@react-spectrum/s2/icons/VolumeTwo';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { formatTimecode } from '../../model/editor.ts';
import {
  DUB_FAST_RATE,
  anyLocked,
  dubBlocks,
  dubGroups,
  planRecordOf,
  planSpeechId,
  planUnits,
  selectedBlocks,
  showsRate,
  type DubBlock,
} from '../../model/timeline-dub.ts';
import { queuedKey, queuedSet, withRegen } from '../../model/dub-takes.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useEditor } from '../../state/editor-store.ts';
import { useJobs } from '../../state/jobs-store.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { DUB_REGEN_COPY as REGEN, TIMELINE_DUB_COPY as COPY } from './dub-copy.ts';
import { openDubFit, regenDeps, regenerateUnits, useDubRegen } from './dub-regen.ts';
import { useEditorActions } from './editor-context.tsx';
import { auditionRange, deleteDubBlocks, muteDubBlocks } from './timeline-commands.ts';

/**
 * 时间线上的配音块（设计稿 timeline-dub.jsx `DubBlock` / `DubBlockMenu`，ui.css `.tdub`）：块是淡的——中性浅灰底、
 * 左缘 3px 说话人色条、译文；语速快过 1.35× 整块换黄、角标写「1.62× · 过快」；静音的压淡加删除线；选中描蓝。
 * 右缘是拉伸把手：拖它改这一句的语速（时间线负责手势，松手一次 `setSpeed`）。右键弹块菜单，作用于选中的那几句。
 * 算什么都在 model/timeline-dub.ts；这里只画，并经文档缓存取配音计划与转写的正文。
 */

/**
 * 序列里的配音块：配音计划与原句所在转写的正文经文档缓存取（与预览、字幕块共用一份），取到了重算；
 * 还没取到时块照画（色相取第一档、文字留给片段名）。再叠上哪几句在重配（`jobs` 镜像里在跑的配音流程冻结的
 * `params.regroup`）与当前是第几版（model/dub-takes.ts）。任务进度事件很多，订阅的是排好序的句子串，句子没变不重算。
 */
export function useDubBlocks(sequence: Sequence, documents: Record<Id, DocumentRecord>, assets: Record<Id, AssetRecord>): ReadonlyMap<Id, DubBlock> {
  const cache = useRuntime().videos.documents;
  const videoId = useVideo((s) => s.video?.videoId ?? null);
  const queued = useJobs((s) => queuedKey(s.jobs, videoId));
  const [loaded, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => cache.subscribe(bump), [cache]);
  const { blocks, plans, wanted } = useMemo(() => {
    const plans = new Map<string, unknown>();
    const speeches = new Map<Id, unknown>();
    const missing: Array<[Id, string]> = [];
    const peek = (record: DocumentRecord) => {
      const body = cache.peek(record.id, record.currentRevision);
      if (body === undefined) missing.push([record.id, record.currentRevision]);
      return body;
    };
    for (const group of dubGroups(sequence)) {
      const plan = planRecordOf(documents, group.groupId);
      const body = plan ? peek(plan) : undefined;
      if (body === undefined) continue;
      plans.set(group.groupId, body);
      const speechId = planSpeechId(planUnits(body));
      const speech = speechId ? documents[speechId] : undefined;
      const speechBody = speech ? peek(speech) : undefined;
      if (speechId && speechBody !== undefined) speeches.set(speechId, speechBody);
    }
    return { blocks: dubBlocks(sequence, { assets, plans, speeches }), plans, wanted: JSON.stringify(missing) };
    // `loaded`：缓存里取到了新的正文，重算一遍。
  }, [sequence, documents, assets, cache, loaded]);
  useEffect(() => {
    for (const [id, revision] of JSON.parse(wanted) as Array<[Id, string]>) cache.load(id, revision);
  }, [cache, wanted]);
  return useMemo(() => withRegen(blocks, plans, queuedSet(queued)), [blocks, plans, queued]);
}

/** 块随状态变的部分；位置、圆角、边框线型、裁切、排版在 editor.css 的 `.bc-clip` / `.bc-dub-block`，字体继承自轨（见 timeline.tsx 的 lane）。 */
const block = style({
  borderWidth: { default: 1, isSelected: 2 },
  cursor: { default: 'grab', isLocked: 'not-allowed' },
  backgroundColor: {
    default: 'gray-50',
    ':hover': 'gray-75',
    isSelected: 'blue-100',
    isFast: { default: 'yellow-200', isSelected: 'yellow-300' },
  },
  borderColor: { default: 'gray-200', isFast: 'yellow-400', isQueued: 'gray-300', isSelected: 'blue-800' },
  color: { default: 'gray-800', isFast: 'yellow-1100', isQueued: 'gray-600' },
  opacity: { default: 1, isOff: 0.45, isMuted: 0.55 },
  // 正在重配的条纹（设计稿 `.tdub--queued`）在 editor.css（样式宏画不了渐变），这里只给 token。
  '--bc-dub-stripe': { type: 'backgroundColor', value: 'gray-100' },
  '--bc-dub-stripe-gap': { type: 'backgroundColor', value: 'gray-50' },
});
/** 左缘的说话人色条（设计稿 `.tdub__sp`，色取说话人色相的边色档）。 */
const speakerStrip = style({
  position: 'absolute',
  top: 0,
  bottom: 0,
  insetStart: 0,
  width: 3,
  backgroundColor: {
    hue: { blue: 'blue-400', green: 'green-400', orange: 'orange-400', purple: 'purple-400', magenta: 'magenta-400', indigo: 'indigo-400' },
  },
});
const blockText = style({
  flexGrow: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  textDecoration: { default: 'none', isMuted: 'line-through' },
});
const rateBadge = style({
  flexShrink: 0,
  marginStart: 'auto',
  marginEnd: 4,
  paddingX: 4,
  borderRadius: 'sm',
  whiteSpace: 'nowrap',
  backgroundColor: { default: 'gray-200', isFast: 'yellow-400' },
  color: { default: 'gray-800', isFast: 'yellow-1100' },
});
/** 右缘拉伸把手（设计稿 `.thnd--r`）：热区宽 min(7, w/3)，里面一根说话人色的细条。 */
const stretchHandle = style({ position: 'absolute', top: 0, bottom: 0, insetEnd: 0, zIndex: 2, cursor: 'ew-resize' });
const stretchPill = style({
  position: 'absolute',
  top: 2,
  bottom: 2,
  insetEnd: 2,
  width: 4,
  borderRadius: 'full',
  opacity: { default: 0.85, ':hover': 1 },
  backgroundColor: {
    hue: { blue: 'blue-400', green: 'green-400', orange: 'orange-400', purple: 'purple-400', magenta: 'magenta-400', indigo: 'indigo-400' },
  },
});

/** 角标上的语速：1.0× 不写。 */
export function rateText(rate: number, fast: boolean): string {
  return showsRate(rate) ? COPY.rate(rate, fast) : '';
}

/** 拖右缘时这一块的样子：实例的新变速乘上合成时的速，就是新的语速。 */
export function stretchedLook(dub: DubBlock, speed: number): { rate: number; fast: boolean } {
  const rate = dub.tempo * speed;
  return { rate, fast: rate > DUB_FAST_RATE + 1e-9 };
}

/** 一块配音（位置与宽度由时间线按手势算好给进来）。 */
export function DubBlockView({
  dub,
  name,
  left,
  width,
  selected,
  locked,
  editable,
  off,
  active,
  stretchSpeed,
  style: extra,
  onPointerDown,
  onContextMenu,
  onStretchPointerDown,
}: {
  dub: DubBlock;
  /** 片段名：计划还没取到时块上写它。 */
  name: string;
  left: number;
  width: number;
  selected: boolean;
  locked: boolean;
  editable: boolean;
  /** 所在的轨道静音了，或这件停用了。 */
  off: boolean;
  active: boolean;
  /** 正在拖右缘：拖到的实例变速。 */
  stretchSpeed: number | null;
  style?: CSSProperties;
  onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void;
  onContextMenu(event: ReactMouseEvent<HTMLDivElement>): void;
  onStretchPointerDown(event: ReactPointerEvent<HTMLDivElement>): void;
}) {
  const queued = dub.queued === true;
  const look = stretchSpeed === null ? { rate: dub.rate, fast: dub.fast } : stretchedLook(dub, stretchSpeed);
  const rate = queued ? '' : rateText(look.rate, look.fast);
  const text = dub.text ?? name;
  // 正在重配的块画条纹、写「重新生成中…」，不画角标、不给拉伸（Runtime 写回时会换掉这一件）。
  const canStretch = editable && !locked && !queued;
  const version = dub.version ? REGEN.version(dub.version.k, dub.version.seed) : '';
  const fast = look.fast && !queued;
  return (
    <div
      className={`${block({ isSelected: selected, isFast: fast, isQueued: queued, isMuted: dub.muted, isOff: off, isLocked: locked })} bc-clip bc-dub-block${queued ? ' bc-dub-queued' : ''}`}
      style={{ left, width, ...extra }}
      data-active={active || undefined}
      title={
        queued
          ? REGEN.queuedTip(text)
          : COPY.tip({
              text,
              speaker: dub.speakerName,
              rate: [rate, version].filter(Boolean).join(' · '),
              muted: dub.muted,
              manual: dub.manual,
              editable: canStretch,
            })
      }
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}>
      <span className={speakerStrip({ hue: dub.hue })} />
      {width >= 28 ? <span className={blockText({ isMuted: dub.muted && !queued })}>{queued ? REGEN.queued : text}</span> : null}
      {rate && width >= 84 ? <span className={rateBadge({ isFast: fast })}>{rate}</span> : null}
      {canStretch && (width >= 24 || stretchSpeed !== null) ? (
        <div className={stretchHandle} style={{ width: Math.max(4, Math.min(7, width / 3)) }} onPointerDown={onStretchPointerDown}>
          <span className={stretchPill({ hue: dub.hue })} />
        </div>
      ) : null}
    </div>
  );
}

/** 块菜单的标题：一句写译文（长了截断），多句写句数（设计稿 model-dub.js `selectionTitle`）。 */
function menuTitle(chosen: readonly DubBlock[], name: string): string {
  if (chosen.length > 1) return COPY.selection(chosen.length);
  const text = chosen[0]?.text ?? name;
  return text.length > 22 ? `${text.slice(0, 22)}…` : text;
}

/**
 * 配音块的右键菜单（设计稿 `DubBlockMenu`）：作用于选中的那几句（右键的那块不在选区里时只算它）。
 * 听这一句（只选了一句时）；静音 / 取消静音；重新生成这几句（同样的译文与声音换个种子再合成）；改译文并重配…；删除这几句。
 * 「移除这组配音」挪到了配音行头的 ⋯（timeline-dub-head.tsx）。重新生成要跑在线模型：只在桌面端、视频可改、找得到这组的
 * 配音计划、选中的几句都不在重配时可点（Web 表面不放 AI 入口）。
 * 渲染在时间线菜单的 MenuTrigger 里（timeline-menu.tsx），锚点与开关由它管。
 */
export function DubBlockMenu({
  dub,
  blocks,
  sequence,
  documents,
  name,
}: {
  dub: DubBlock;
  blocks: ReadonlyMap<Id, DubBlock>;
  sequence: Sequence;
  documents: Record<Id, DocumentRecord>;
  name: string;
}) {
  const actions = useEditorActions();
  const runtime = useRuntime();
  const editable = useVideo((s) => canEdit(s.video));
  const videoId = useVideo((s) => s.video?.videoId ?? null);
  const selection = useEditor((s) => s.selection);
  const busy = useDubRegen((s) => !!s.busy[dub.groupId]);
  const picked = selectedBlocks(selection, blocks);
  const chosen = picked.some((b) => b.itemId === dub.itemId) ? picked : [dub];
  const ids = chosen.map((b) => b.itemId);
  const n = chosen.length;
  const allMuted = chosen.every((b) => b.muted);
  const one = n === 1 ? sequence.items.find((item) => item.id === chosen[0]!.itemId) : undefined;
  const range = one ? itemRangeSeconds(one, sequence.fps) : null;
  const title = menuTitle(chosen, name);
  const desktop = runtime.host.platform !== 'web';
  const plan = planRecordOf(documents, dub.groupId);
  // 选区可能跨组：重配只认右键那一块所在的组。
  const units = [...new Set(chosen.flatMap((b) => (b.groupId === dub.groupId && b.unitId ? [b.unitId] : [])))];
  const inQueue = chosen.some((b) => b.queued);
  const canRegen = editable && !!plan && !!videoId && units.length > 0 && !inQueue && !busy;
  // 锁着的改不了（引擎会拒绝）：选中的几句里有锁着的，静音与删除置灰。
  const disabled = [...(editable ? (anyLocked(sequence, ids) ? ['mute', 'delete'] : []) : ['mute', 'delete']), ...(canRegen ? [] : ['regen', 'fit'])];

  const run = (key: string) => {
    switch (key) {
      case 'listen':
        if (range) auditionRange(actions, range.start, range.end);
        return;
      case 'mute':
        return void muteDubBlocks(actions, ids, !allMuted);
      case 'delete':
        return void deleteDubBlocks(actions, ids);
      case 'regen':
        if (videoId) void regenerateUnits(regenDeps(runtime, actions), { videoId, groupId: dub.groupId, units, planDocumentId: plan?.id ?? null });
        return;
      case 'fit':
        if (videoId) openDubFit({ videoId, groupId: dub.groupId, units });
        return;
    }
  };

  const regenHint = inQueue ? REGEN.inQueue : !editable ? REGEN.readOnly : REGEN.regenBlocksHint;
  return (
    <Menu aria-label={COPY.menuLabel(title)} disabledKeys={disabled} onAction={(key) => run(String(key))}>
      <MenuSection>
        <Header>
          <Heading>{title}</Heading>
        </Header>
        {range && one ? (
          <MenuItem id="listen" textValue={COPY.listen}>
            <PlayIcon />
            <Text slot="label">{COPY.listen}</Text>
            <Text slot="description">
              {COPY.listenHint(formatTimecode(range.start, sequence.fps), range.end - range.start, rateText(chosen[0]!.rate, chosen[0]!.fast))}
            </Text>
          </MenuItem>
        ) : null}
        <MenuItem id="mute" textValue={COPY.mute(allMuted, n)}>
          {allMuted ? <VolumeTwo /> : <VolumeOff />}
          <Text slot="label">{COPY.mute(allMuted, n)}</Text>
          <Text slot="description">{COPY.muteHint(allMuted)}</Text>
        </MenuItem>
      </MenuSection>
      {desktop ? (
        <MenuSection>
          <MenuItem id="regen" textValue={REGEN.regenBlocks(units.length || n)}>
            <RefreshIcon />
            <Text slot="label">{REGEN.regenBlocks(units.length || n)}</Text>
            <Text slot="description">{regenHint}</Text>
          </MenuItem>
          <MenuItem id="fit" textValue={REGEN.retext}>
            <EditIcon />
            <Text slot="label">{REGEN.retext}</Text>
            <Text slot="description">{inQueue ? REGEN.inQueue : REGEN.retextHint}</Text>
          </MenuItem>
        </MenuSection>
      ) : null}
      <MenuSection>
        <MenuItem id="delete" textValue={COPY.remove(n)}>
          <DeleteIcon />
          <Text slot="label">{COPY.remove(n)}</Text>
          <Text slot="description">{COPY.removeHint}</Text>
        </MenuItem>
      </MenuSection>
    </Menu>
  );
}
