import { useMemo, useState, type ComponentType } from 'react';
import type { AssetRecord, Id, Sequence } from '@baocut/protocol';
import { mediaTimeToSeconds } from '@baocut/protocol';
import {
  Button,
  ButtonGroup,
  Checkbox,
  Content,
  Dialog,
  DialogContainer,
  Heading,
  ListView,
  ListViewItem,
  SearchField,
  SegmentedControl,
  SegmentedControlItem,
  Text,
  ToastQueue,
} from '@react-spectrum/s2';
import Image from '@react-spectrum/s2/icons/Image';
import Import from '@react-spectrum/s2/icons/Import';
import InfoCircle from '@react-spectrum/s2/icons/InfoCircle';
import MusicNote from '@react-spectrum/s2/icons/MusicNote';
import Video from '@react-spectrum/s2/icons/Video';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { describeReplace, planAssetReplace, replaceSideEffects, type AssetReplacePlan, type ReplaceSource } from '../../model/asset-replace.ts';
import { libraryAssets, type PlaceableKind } from '../../model/editor-ops.ts';
import { formatClock } from '../../model/format.ts';
import { formatBytes, kindOfFileName } from '../../model/space.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useEditorActions } from './editor-context.tsx';
import { MEDIA_COPY as MC } from './media-copy.ts';

/**
 * 替换素材（设计稿 video-replace.jsx 的 `VideoReplaceDialog`，搬到素材库这一层）：左边是正在替换的素材与它用在哪几段，
 * 右边从视频素材里挑一份同类的，或选一个本地文件（同一笔事务里导入）。时间规则见 model/asset-replace.ts；确认后一笔提交，
 * 撤销一步回去。设计稿的「同时改视频画幅」不在这里：协议里改画幅是另一件事，替换只换素材。
 * 从画布工具条打开时带 `itemId`：只换选中的那一段（设计稿 `openVideoReplace(el.id)`），左边的说明随之改成这一段。
 */

const KIND_ICON: Record<PlaceableKind, ComponentType<{ slot?: string }>> = { video: Video, image: Image, audio: MusicNote };

const layout = style({ display: 'flex', flexDirection: { default: 'column', sm: 'row' }, gap: 24 });
const aside = style({ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0, width: { default: 'full', sm: 220 } });
const sectionTitle = style({ font: 'ui-xs', fontWeight: 'bold', color: 'gray-700' });
const targetThumb = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 96,
  borderRadius: 'lg',
  backgroundColor: 'gray-200',
  color: 'gray-600',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const strong = style({ font: 'ui-sm', fontWeight: 'bold', color: 'gray-900', overflowWrap: 'anywhere' });
const detail = style({ font: 'ui-xs', color: 'gray-700', margin: 0 });
const note = style({
  display: 'flex',
  alignItems: 'start',
  gap: 4,
  padding: 8,
  borderRadius: 'default',
  backgroundColor: 'gray-75',
  font: 'ui-xs',
  color: 'gray-700',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const picker = style({ display: 'flex', flexDirection: 'column', gap: 12, flexGrow: 1, minWidth: 0 });
const listBox = style({ height: 220 });
const local = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  padding: 16,
  borderWidth: 1,
  borderStyle: 'dashed',
  borderColor: 'gray-400',
  borderRadius: 'lg',
  textAlign: 'center',
  color: 'gray-700',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const choice = style({ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 'lg', backgroundColor: 'gray-75' });
const status = style({ font: 'ui-sm', color: { default: 'gray-800', isError: 'negative-900' }, margin: 0 });
const rows = style({ display: 'flex', flexDirection: 'column', gap: 2, margin: 0, padding: 0, listStyleType: 'none' });
const row = style({
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  font: 'ui-xs',
  color: { default: 'gray-800', isOff: 'gray-600' },
});
const rowName = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 });
const rowMeta = style({ flexShrink: 0, fontVariantNumeric: 'tabular-nums' });

function assetMeta(asset: AssetRecord): string {
  const revision = asset.revisions[asset.currentRevision];
  const parts: string[] = [];
  if (revision?.duration && asset.kind !== 'image') parts.push(formatClock(mediaTimeToSeconds(revision.duration)));
  if (revision?.video) parts.push(`${revision.video.displayWidth}×${revision.video.displayHeight}`);
  if (revision) parts.push(formatBytes(revision.byteLength));
  return parts.join(' · ');
}

const fileName = (path: string) => path.split(/[\\/]/).pop() || path;

function kindOfPath(path: string): PlaceableKind | null {
  const kind = kindOfFileName(fileName(path));
  return kind === 'video-file' ? 'video' : kind === 'audio' || kind === 'image' ? kind : null;
}

const span = (start: number, end: number) => `${formatClock(start, { tenths: true })} — ${formatClock(end, { tenths: true })}`;

export interface AssetReplaceDialogProps {
  asset: AssetRecord & { kind: PlaceableKind };
  sequence: Sequence;
  assets: Record<string, AssetRecord>;
  /** 只换这一段（画布工具条）；缺省换掉用到这个素材的每一段。 */
  itemId?: Id;
  onClose(): void;
}

/** 一个素材的替换窗口。状态放在 Dialog 外层（S2 的 Dialog 会把 children 在几个 slot 里各渲染一遍）。 */
export function AssetReplaceDialog({ asset, sequence, assets, itemId, onClose }: AssetReplaceDialogProps) {
  const runtime = useRuntime();
  const { apply, undo } = useEditorActions();
  const Icon = KIND_ICON[asset.kind];
  const [tab, setTab] = useState<'library' | 'local'>('library');
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const [file, setFile] = useState<{ path: string; name: string; kind: PlaceableKind | null } | null>(null);
  const [align, setAlign] = useState(false);
  const [busy, setBusy] = useState(false);
  // 提交时把两份计划定住：事务落地后序列先变、窗口后关，不定住会闪一下「没用到这个素材」。
  const [frozen, setFrozen] = useState<{ plan: AssetReplacePlan; precheck: AssetReplacePlan } | null>(null);

  const candidates = useMemo(() => libraryAssets(assets, asset.kind).filter((a) => a.id !== asset.id), [assets, asset.id, asset.kind]);
  const shown = candidates.filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase()));
  const pick = chosen ? assets[chosen] : undefined;
  const source: ReplaceSource | null =
    tab === 'library' ? (pick ? { from: 'library', asset: pick } : null) : file ? { from: 'file', path: file.path, name: file.name, kind: file.kind } : null;
  const plan = frozen?.plan ?? (source ? planAssetReplace({ sequence, asset, source, align, itemId }) : null);
  // 不管换成什么都会被拒的情形（都锁着、没用到）在选之前就说。
  const precheck = frozen?.precheck ?? planAssetReplace({ sequence, asset, source: { from: 'file', path: '', name: '', kind: asset.kind }, itemId });
  const blocked = !precheck.ok ? precheck.reason : null;
  const sideEffects = plan ? replaceSideEffects(plan) : [];
  const kept = precheck.ok ? precheck.kept : [];
  const users = precheck.ok ? precheck.replaced : [];
  const sourceName = source ? (source.from === 'library' ? source.asset.name : source.name) : null;
  const canApply = !!plan?.ok && !busy;

  const chooseFile = async () => {
    const [path] = await runtime.host.pickMediaFiles();
    if (!path) return;
    setFile({ path, name: fileName(path), kind: kindOfPath(path) });
  };

  const commit = async (close: () => void) => {
    if (!plan?.ok) return;
    setBusy(true);
    setFrozen({ plan, precheck });
    const receipt = await apply(plan.operations, MC.replaceKind(asset.kind));
    setBusy(false);
    if (!receipt) {
      setFrozen(null);
      return;
    }
    const n = plan.replaced.length;
    ToastQueue.positive(n === 1 ? MC.replacedOne(asset.kind) : MC.replacedMany(asset.kind, n), {
      timeout: 5000,
      actionLabel: MC.undo,
      onAction: () => void undo({ transaction: receipt.transactionId }),
      shouldCloseOnAction: true,
    });
    close();
  };

  return (
    <DialogContainer onDismiss={onClose}>
      <Dialog size="L">
        {({ close }) => (
          <>
            <Heading slot="title">{MC.replaceKind(asset.kind)}</Heading>
            <Content>
              <div className={layout}>
                <aside className={aside} aria-label={itemId ? MC.replacingClip : MC.replacingThis}>
                  <span className={sectionTitle}>{itemId ? MC.replacingClip : MC.replacingThis}</span>
                  <span className={targetThumb} aria-hidden>
                    <Icon />
                  </span>
                  <span className={strong}>{asset.name}</span>
                  <span className={detail}>{assetMeta(asset) || MC.kindName(asset.kind)}</span>
                  <p className={detail}>
                    {itemId ? MC.replaceClipRule : MC.replaceRule}
                  </p>
                  <span className={note}>
                    <InfoCircle />
                    {MC.replaceCancelNote}
                  </span>
                </aside>
                <section className={picker} aria-label={MC.pickNew(asset.kind)}>
                  <SegmentedControl aria-label={MC.sourceTabs} selectedKey={tab} onSelectionChange={(key) => setTab(key as 'library' | 'local')}>
                    <SegmentedControlItem id="library">{MC.existing(asset.kind)}</SegmentedControlItem>
                    <SegmentedControlItem id="local">{MC.localFile}</SegmentedControlItem>
                  </SegmentedControl>
                  {tab === 'library' ? (
                    <>
                      <SearchField aria-label={MC.searchExisting(asset.kind)} placeholder={MC.searchExistingPlaceholder(asset.kind)} value={query} onChange={setQuery} />
                      <ListView
                        aria-label={MC.existing(asset.kind)}
                        selectionMode="single"
                        selectedKeys={chosen ? [chosen] : []}
                        onSelectionChange={(keys) => {
                          const [key] = keys === 'all' ? [] : [...keys];
                          setChosen(key === undefined ? null : String(key));
                        }}
                        styles={listBox}
                        renderEmptyState={() => (
                          <Text>{candidates.length ? MC.noNameMatch : MC.noOthers(asset.kind)}</Text>
                        )}>
                        {shown.map((candidate) => (
                          <ListViewItem key={candidate.id} id={candidate.id} textValue={candidate.name}>
                            <Icon slot="icon" />
                            <Text>{candidate.name}</Text>
                            <Text slot="description">{assetMeta(candidate) || MC.kindName(asset.kind)}</Text>
                          </ListViewItem>
                        ))}
                      </ListView>
                    </>
                  ) : (
                    <div className={local}>
                      <Import />
                      <span className={strong}>{MC.chooseLocal(asset.kind)}</span>
                      <p className={detail}>{MC.localNote}</p>
                      <Button variant="secondary" onPress={() => void chooseFile()}>
                        {file ? MC.chooseAgain : MC.chooseKindFile(asset.kind)}
                      </Button>
                      {file ? <span className={detail}>{file.name}</span> : null}
                    </div>
                  )}
                  <Checkbox isSelected={align} onChange={setAlign} isDisabled={asset.kind === 'image'}>
                    {MC.alignNote}
                  </Checkbox>
                  <div className={choice}>
                    <span className={strong}>{sourceName ? MC.replaceWith(sourceName) : MC.noneChosen}</span>
                    <p className={status({ isError: !!blocked || (!!plan && !plan.ok) })} role="status">
                      {blocked ?? (plan ? describeReplace(plan) : MC.pickToReplace)}
                    </p>
                    {sideEffects.map((line) => (
                      <p key={line} className={detail}>
                        {line}
                      </p>
                    ))}
                    {users.length || kept.length ? (
                      <ul className={rows} aria-label={MC.usingClips}>
                        {(plan?.ok ? plan.replaced : users).map((r) => (
                          <li key={r.itemId} className={row({})}>
                            <span className={rowName}>{r.name}</span>
                            <span className={rowMeta}>
                              {span(r.start, r.end)}
                              {r.delta < 0 ? ` → ${span(r.newStart, r.newEnd)}` : ''}
                            </span>
                          </li>
                        ))}
                        {kept.map((k) => (
                          <li key={k.itemId} className={row({ isOff: true })}>
                            <span className={rowName}>
                              {k.name} · {k.reason === 'locked' ? MC.locked : MC.proxy}
                            </span>
                            <span className={rowMeta}>{span(k.start, k.end)} · {MC.keepAsIs}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </section>
              </div>
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={close}>
                {MC.cancel}
              </Button>
              <Button variant="accent" isDisabled={!canApply} isPending={busy} onPress={() => void commit(close)}>
                {MC.confirmReplace}
              </Button>
            </ButtonGroup>
          </>
        )}
      </Dialog>
    </DialogContainer>
  );
}
