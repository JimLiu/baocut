import type { AssetRecord, Id, Sequence } from '@baocut/protocol';
import { create } from 'zustand';
import { AssetReplaceDialog } from './asset-replace-dialog.tsx';

/**
 * 画布工具条的「替换视频 / 替换图片」：开素材库那一个替换窗口，只换选中的这一段（asset-replace.ts 的 `itemId`）。
 * 窗口常驻挂在时间线上（timeline-menu.tsx，与「改译文并重配」一处）：工具条跟着选中框走，替换落地后旧片段换成新 ID，
 * 条子会收起，窗口不能挂在条子里；也不挂在舞台里，免得窗口里的指针事件冒泡到舞台的选择与拖动。
 * 打开时记下片段与素材：落地之后旧片段不在了，窗口照样收尾（回执与撤销提示），不看片段还在不在。
 */
interface Target {
  itemId: Id;
  assetId: Id;
}

export const useItemReplace = create<{ target: Target | null }>(() => ({ target: null }));

export function openItemReplace(itemId: Id, assetId: Id): void {
  useItemReplace.setState({ target: { itemId, assetId } });
}

const close = () => useItemReplace.setState({ target: null });

export function ItemReplaceHost({ sequence, assets }: { sequence: Sequence; assets: Record<Id, AssetRecord> }) {
  const target = useItemReplace((s) => s.target);
  const asset = target ? assets[target.assetId] : undefined;
  if (!target || !asset || (asset.kind !== 'video' && asset.kind !== 'image')) return null;
  return (
    <AssetReplaceDialog key={target.itemId} asset={{ ...asset, kind: asset.kind }} itemId={target.itemId} sequence={sequence} assets={assets} onClose={close} />
  );
}
