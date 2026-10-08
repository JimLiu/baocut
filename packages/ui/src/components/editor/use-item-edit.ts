import type { EditOperation, Sequence, SequenceItem } from '@baocut/protocol';
import type { ItemPatch } from '../../model/item-draft.ts';
import { useEditor } from '../../state/editor-store.ts';
import { useEditorActions } from './editor-context.tsx';

export interface ItemEdit {
  /** 拖动中：只叠给预览与属性页，不提交。 */
  live(patch: ItemPatch): void;
  /** 提交一笔修改；失败时丢掉草稿，回到原值（错误由编辑器统一提示）。 */
  commit(operations: EditOperation[], label?: string): void;
}

/** 属性页改一个片段：拖动中的值进草稿，松手提交。草稿记着序列版本，提交成功后新版本到了就不再叠加。 */
export function useItemEdit(sequence: Sequence, item: SequenceItem): ItemEdit {
  const { apply } = useEditorActions();
  return {
    live: (patch) => useEditor.getState().setDraft({ itemId: item.id, revision: sequence.revision, patch }),
    commit: (operations, label) =>
      void apply(operations, label).then((receipt) => {
        if (!receipt) useEditor.getState().clearDrafts();
      }),
  };
}
