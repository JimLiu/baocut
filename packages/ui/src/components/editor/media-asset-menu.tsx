import { useState, type Key } from 'react';
import type { AssetRecord, Sequence } from '@baocut/protocol';
import {
  ActionButton,
  Button,
  ButtonGroup,
  Content,
  Dialog,
  DialogContainer,
  Heading,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  SubmenuTrigger,
  Text,
  ToastQueue,
} from '@react-spectrum/s2';
import Copy from '@react-spectrum/s2/icons/Copy';
import Delete from '@react-spectrum/s2/icons/Delete';
import FolderMoveTo from '@react-spectrum/s2/icons/FolderMoveTo';
import Location from '@react-spectrum/s2/icons/Location';
import More from '@react-spectrum/s2/icons/More';
import OpenIn from '@react-spectrum/s2/icons/OpenIn';
import Preview from '@react-spectrum/s2/icons/Preview';
import Replace from '@react-spectrum/s2/icons/Replace';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { revealLabel } from '../../copy.ts';
import { assetFilePath, assetUsages, type PlaceableKind } from '../../model/editor-ops.ts';
import { formatClock } from '../../model/format.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useEditor } from '../../state/editor-store.ts';
import { useVideo } from '../../state/video-store.ts';
import { AssetReplaceDialog } from './asset-replace-dialog.tsx';
import { useEditorActions } from './editor-context.tsx';
import { useAssetUrl } from './use-asset-url.ts';
import { MEDIA_COPY as MC } from './media-copy.ts';

/**
 * 素材卡片上的 ⋯（设计稿 panel-media.jsx `MediaMenu`）：预览、复制文件名、在文件夹中显示、用在哪（点一处选中它并跳过去）、
 * 替换…、收进视频目录（只对链接的素材）、从视频移除。Runtime 没有删除素材的操作，「从视频移除」置灰并写明原因。
 */

const C = {
  get reveal() {
    return revealLabel();
  },
};

const previewBox = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 120,
  borderRadius: 'lg',
  backgroundColor: 'gray-100',
  overflow: 'hidden',
});
const media = style({ display: 'block', maxWidth: 'full', maxHeight: 420 });
const audioEl = style({ width: 'full' });
const note = style({ font: 'ui-sm', color: 'gray-700', padding: 16, textAlign: 'center' });

export function MediaAssetMenu({
  asset,
  sequence,
  assets,
  editable,
}: {
  asset: AssetRecord & { kind: PlaceableKind };
  sequence: Sequence;
  assets: Record<string, AssetRecord>;
  editable: boolean;
}) {
  const runtime = useRuntime();
  const { apply, undo, seek } = useEditorActions();
  const videoDir = useVideo((s) => s.video?.ref?.path ?? null);
  const [dialog, setDialog] = useState<'preview' | 'replace' | null>(null);
  const revision = asset.revisions[asset.currentRevision];
  const linked = revision?.storage.mode === 'linked';
  const desktop = runtime.host.platform !== 'web';
  const path = assetFilePath(asset, videoDir);
  const usages = assetUsages(sequence, asset.id);

  const disabled = ['remove'];
  if (!path) disabled.push('reveal');
  if (!usages.length) disabled.push('uses');
  if (!usages.length || !editable) disabled.push('replace');
  if (!editable) disabled.push('collect');

  const onAction = async (key: Key) => {
    if (key === 'preview') setDialog('preview');
    else if (key === 'replace') setDialog('replace');
    else if (key === 'copy') {
      const ok = await navigator.clipboard.writeText(asset.name).then(
        () => true,
        () => false,
      );
      if (ok) ToastQueue.positive(MC.copied(asset.name), { timeout: 3000 });
      else ToastQueue.negative(MC.copyFailed, { timeout: 4000 });
    } else if (key === 'reveal' && path) void runtime.host.revealPath(path);
    else if (key === 'collect') {
      const receipt = await apply([{ type: 'collectAssets', assetIds: [asset.id] }], MC.collect);
      if (receipt)
        ToastQueue.positive(MC.collected(asset.name), {
          timeout: 5000,
          actionLabel: MC.undo,
          onAction: () => void undo({ transaction: receipt.transactionId }),
          shouldCloseOnAction: true,
        });
    } else {
      const use = usages.find((u) => `use:${u.itemId}` === key);
      if (!use) return;
      useEditor.getState().select([use.itemId]);
      seek(use.start);
    }
  };

  return (
    <>
      <MenuTrigger>
        <ActionButton isQuiet aria-label={MC.moreActions(asset.name)}>
          <More />
        </ActionButton>
        <Menu aria-label={MC.moreActions(asset.name)} disabledKeys={disabled} onAction={(key) => void onAction(key)}>
          <MenuSection>
            <MenuItem id="preview" textValue={MC.preview}>
              <Preview />
              <Text slot="label">{MC.preview}</Text>
            </MenuItem>
            <MenuItem id="copy" textValue={MC.copyName}>
              <Copy />
              <Text slot="label">{MC.copyName}</Text>
            </MenuItem>
            {desktop ? (
              <MenuItem id="reveal" textValue={C.reveal}>
                <OpenIn />
                <Text slot="label">{C.reveal}</Text>
                {!path ? <Text slot="description">{linked ? MC.revealUnknown : MC.revealManaged}</Text> : null}
              </MenuItem>
            ) : null}
            {usages.length ? (
              <SubmenuTrigger>
                <MenuItem id="uses" textValue={MC.uses}>
                  <Location />
                  <Text slot="label">{MC.uses}</Text>
                  <Text slot="description">{MC.usesCount(usages.length)}</Text>
                </MenuItem>
                <Menu aria-label={MC.usesOf(asset.name)} onAction={(key) => void onAction(key)}>
                  {usages.map((use) => (
                    <MenuItem key={use.itemId} id={`use:${use.itemId}`} textValue={`${use.track} ${formatClock(use.start)}`}>
                      <Text slot="label">
                        {formatClock(use.start, { tenths: true })} — {formatClock(use.end, { tenths: true })}
                      </Text>
                      <Text slot="description">{use.name ? `${use.track} · ${use.name}` : use.track}</Text>
                    </MenuItem>
                  ))}
                </Menu>
              </SubmenuTrigger>
            ) : (
              <MenuItem id="uses" textValue={MC.uses}>
                <Location />
                <Text slot="label">{MC.uses}</Text>
                <Text slot="description">{MC.usesNone}</Text>
              </MenuItem>
            )}
          </MenuSection>
          <MenuSection>
            <MenuItem id="replace" textValue={MC.replace}>
              <Replace />
              <Text slot="label">{MC.replace}</Text>
              <Text slot="description">
                {!editable ? MC.readOnly : !usages.length ? MC.replaceNone : usages.length === 1 ? MC.replaceOne(asset.kind) : MC.replaceMany(usages.length)}
              </Text>
            </MenuItem>
            {linked ? (
              <MenuItem id="collect" textValue={MC.collect}>
                <FolderMoveTo />
                <Text slot="label">{MC.collect}</Text>
                <Text slot="description">{editable ? MC.collectNote : MC.readOnly}</Text>
              </MenuItem>
            ) : null}
          </MenuSection>
          <MenuSection>
            <MenuItem id="remove" textValue={MC.remove}>
              <Delete />
              <Text slot="label">{MC.remove}</Text>
              <Text slot="description">{MC.removeNote}</Text>
            </MenuItem>
          </MenuSection>
        </Menu>
      </MenuTrigger>
      {dialog === 'preview' ? <AssetPreviewDialog asset={asset} onClose={() => setDialog(null)} /> : null}
      {dialog === 'replace' ? <AssetReplaceDialog asset={asset} sequence={sequence} assets={assets} onClose={() => setDialog(null)} /> : null}
    </>
  );
}

/** 「预览」：在窗口里放一遍素材本身（不经时间线）。地址按素材版本向 Runtime 要（`media.resolve`）。 */
function AssetPreviewDialog({ asset, onClose }: { asset: AssetRecord & { kind: PlaceableKind }; onClose(): void }) {
  const videoId = useVideo((s) => s.video?.videoId ?? null);
  const { url, error, retry } = useAssetUrl(videoId, { id: asset.id, revision: asset.currentRevision });
  return (
    <DialogContainer onDismiss={onClose}>
      <Dialog size="L">
        {({ close }) => (
          <>
            <Heading slot="title">{asset.name}</Heading>
            <Content>
              <div className={previewBox}>
                {error ? (
                  <span className={note} role="alert">
                    {MC.previewFailed(error)}
                  </span>
                ) : !url ? (
                  <span className={note}>{MC.previewLoading}</span>
                ) : asset.kind === 'video' ? (
                  <video className={media} src={url} controls autoPlay />
                ) : asset.kind === 'audio' ? (
                  <audio className={audioEl} src={url} controls autoPlay />
                ) : (
                  <img className={media} src={url} alt={asset.name} />
                )}
              </div>
            </Content>
            <ButtonGroup>
              {error ? (
                <Button variant="secondary" onPress={retry}>
                  {MC.retry}
                </Button>
              ) : null}
              <Button variant="secondary" onPress={close}>
                {MC.close}
              </Button>
            </ButtonGroup>
          </>
        )}
      </Dialog>
    </DialogContainer>
  );
}
