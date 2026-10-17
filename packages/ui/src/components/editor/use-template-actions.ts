import { useMemo } from 'react';
import type {
  AssetRecord,
  Id,
  LibraryEntrySummary,
  Localized,
  Sequence,
  TemplateLayer,
  TemplateLayers,
  TransactionReceipt,
} from '@baocut/protocol';
import { EditLabel } from '@baocut/protocol/messages/ui';
import { ToastQueue } from '@react-spectrum/s2';
import { applyPlan, infoOf, isOriginalRatio, withLayer } from '../../model/template-layers.ts';
import { useEditor } from '../../state/editor-store.ts';
import type { EditorActions } from './editor-context.tsx';
import { useEditorActions } from './editor-context.tsx';
import { TEMPLATE_COPY as TC } from './template-copy.ts';

const TOAST_MS = 4000;

/** 画幅档在界面上怎么写：`original` 写「原始」，其余原样（`16:9`）。 */
export const ratioLabel = (ratio: string): string => (isOriginalRatio(ratio) ? TC.original : ratio);

/** 上一条带撤销的提示：新的一条出来时收掉旧的（S2 带操作的提示不会自己消失）。 */
let closeUndoToast: (() => void) | null = null;

export function undoToast(actions: EditorActions, message: string, receipt: TransactionReceipt): void {
  closeUndoToast?.();
  const close = ToastQueue.positive(message, {
    actionLabel: TC.undo,
    onAction: () => void actions.undo({ transaction: receipt.transactionId }),
    shouldCloseOnAction: true,
    onClose: () => {
      if (closeUndoToast === close) closeUndoToast = null;
    },
  });
  closeUndoToast = close;
}

export interface TemplateActions {
  /**
   * 套用一套定义（内置或品牌库）：拷一份进序列，声明了套用时画幅就一并改画布，同一笔撤销。已经是这一套就只翻到属性页，
   * 除非 `again`（品牌页的「重新套用」：用库里的新版本换掉视频里那份）。
   */
  apply(sequence: Sequence, assets: Record<Id, AssetRecord>, doc: TemplateLayers, options?: { again?: boolean }): Promise<boolean>;
  /** 移除模板（章节留着，只是不画了）。 */
  remove(sequence: Sequence): Promise<boolean>;
  /** 改序列里那一份的整套字段（字幕避让这一类）。不出提示：滑一下就一条太吵。 */
  patch(sequence: Sequence, patch: Partial<TemplateLayers>, label?: Localized): Promise<boolean>;
  /** 改一层。 */
  patchLayer(sequence: Sequence, layerId: string, patch: Partial<TemplateLayer>): Promise<boolean>;
  /** 画幅锁：只在模板声明了套用时画幅时有意义。 */
  setLock(sequence: Sequence, on: boolean): Promise<boolean>;
  /** 台标换成品牌库里的一张图片。 */
  setLogoImage(sequence: Sequence, layerId: string, image: LibraryEntrySummary): Promise<boolean>;
}

/**
 * 模板层的编辑命令（原型 editor-template.jsx）：元素面板的模板目录、模板属性页、时间线上的模板行与品牌库共用。
 * 每一步是一笔编辑事务；套用、移除、锁与解锁之后出带「撤销」的提示，撤的是这一笔。台标用到、视频里还没有的图片由
 * Runtime 在同一笔里登记成素材（视频格式规范 §3.17）。
 */
export function useTemplateActions(): TemplateActions {
  const actions = useEditorActions();
  return useMemo<TemplateActions>(() => {
    const set = (sequence: Sequence, template: TemplateLayers | null, label: Localized) =>
      actions.apply([{ type: 'setTemplate', sequenceId: sequence.id, template }], label);
    return {
      async apply(sequence, assets, doc, options) {
        const current = sequence.template;
        if (current?.from === doc.id && !options?.again) {
          useEditor.getState().focusTemplate(true);
          ToastQueue.neutral(TC.alreadyApplied(doc.name), { timeout: TOAST_MS });
          return true;
        }
        const plan = applyPlan(sequence, assets, doc);
        const receipt = await actions.apply(plan.operations, EditLabel.applyTemplate({ name: doc.name }));
        if (!receipt) return false;
        useEditor.getState().focusTemplate(true);
        const head = current ? TC.replacedToast(doc.name) : TC.appliedToast(doc.name);
        const target = infoOf(plan.instance).ratioTarget;
        const tail =
          plan.locked && target
            ? plan.ratio
              ? TC.ratioSetLocked(ratioLabel(target))
              : TC.ratioLockedTo(ratioLabel(target))
            : plan.ratio
              ? TC.ratioSetTo(ratioLabel(plan.ratio))
              : null;
        undoToast(actions, tail ? `${head} · ${tail}` : head, receipt);
        return true;
      },
      async remove(sequence) {
        const current = sequence.template;
        if (!current) return false;
        const receipt = await set(sequence, null, EditLabel.removeTemplate());
        if (!receipt) return false;
        useEditor.getState().focusTemplate(false);
        undoToast(actions, infoOf(current).ratioLocked ? TC.removedUnlocked : TC.removedToast, receipt);
        return true;
      },
      async patch(sequence, patch, label = EditLabel.editTemplate()) {
        const current = sequence.template;
        if (!current) return false;
        return !!(await set(sequence, { ...current, ...patch }, label));
      },
      async patchLayer(sequence, layerId, patch) {
        const current = sequence.template;
        if (!current) return false;
        return !!(await set(sequence, withLayer(current, layerId, patch), EditLabel.editTemplate()));
      },
      async setLock(sequence, on) {
        const current = sequence.template;
        const target = current ? infoOf(current).ratioTarget : null;
        if (!current || !target) return false;
        const next: TemplateLayers = { ...current, lockRatio: on };
        if (!on) delete next.lockRatio;
        const receipt = await set(sequence, next, on ? EditLabel.lockTemplateRatio() : EditLabel.unlockTemplateRatio());
        if (!receipt) return false;
        undoToast(actions, on ? TC.lockedToast(ratioLabel(target)) : TC.unlockedToast, receipt);
        return true;
      },
      async setLogoImage(sequence, layerId, image) {
        const current = sequence.template;
        if (!current) return false;
        const next = withLayer(current, layerId, { src: { brandLogo: image.id } });
        return !!(await set(sequence, next, EditLabel.editTemplate()));
      },
    };
  }, [actions]);
}
