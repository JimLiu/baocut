import { useMemo } from 'react';
import type { AssetRecord, EditOperation, Id, LibraryEntry, Sequence, TemplateLayers } from '@baocut/protocol';
import { EditLabel } from '@baocut/protocol/messages/ui';
import { ToastQueue } from '@react-spectrum/s2';
import { applyPlan, definitionOf } from '../../model/template-layers.ts';
import { openStudio, studioDirty, type TemplateStudio } from '../../model/template-studio.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useEditor } from '../../state/editor-store.ts';
import { useLibrary } from '../../state/library-store.ts';
import { copyBrandLogos, saveTemplateToBrand, updateBrandTemplate } from './brand-save.ts';
import { useEditorActions } from './editor-context.tsx';
import { TEMPLATE_COPY as TC } from './template-copy.ts';
import { undoToast } from './use-template-actions.ts';

const TOAST_MS = 4000;
/** 从空白做进视频的那一套的 ID：不是内置的、也不是品牌库条目，属性页写「只在这个视频」。 */
const OWN_ID = 'tpl-own';

export interface TemplateStudioActions {
  /** 「编辑版面」：改这部视频里套着的那一份。 */
  editVideo(sequence: Sequence): void;
  /** 「自己做一个」：从空白做一套，完成时套进这部视频。 */
  makeOwn(): void;
  /** 品牌页的「编辑版面」：改库里的这一条定义。 */
  editBrand(doc: TemplateLayers, entry: LibraryEntry): void;
  /** 品牌页的「新建模板」：从空白做一条品牌库定义。 */
  newBrand(): void;
  /** 「完成」：草稿写回到 `source` 指的地方，然后关掉。写回失败时不关，草稿还在。 */
  done(sequence: Sequence, assets: Record<Id, AssetRecord>): Promise<boolean>;
  /** 返回：放弃草稿。 */
  cancel(): void;
  /** 版面编辑器里的「存到品牌库」：存草稿（同名覆盖），草稿的名字换成存成的名字。 */
  saveToBrand(name: string): Promise<boolean>;
}

/**
 * 版面编辑器的进出（原型 editor-template.jsx 的 `openTplStudio` / `studioDone` / `studioCancel` / `studioSaveBrand`）：
 * 打开时舞台换成版面画布、右栏让给它；写回视频的是一笔编辑事务（带「撤销」），写回品牌库的是库里的一条。
 */
export function useTemplateStudio(): TemplateStudioActions {
  const actions = useEditorActions();
  const runtime = useRuntime();
  return useMemo<TemplateStudioActions>(() => {
    const open = (studio: TemplateStudio) => useEditor.getState().openStudio(studio);
    const current = () => useEditor.getState().templateStudio;
    const close = () => useEditor.getState().closeStudio();
    return {
      editVideo(sequence) {
        if (sequence.template) open(openStudio('video', sequence.template, null, TC.untitled));
      },
      makeOwn() {
        open(openStudio('new-video', null, null, TC.untitled));
      },
      editBrand(doc, entry) {
        open(openStudio('brand', doc, entry.id, TC.untitled));
      },
      newBrand() {
        open(openStudio('new-brand', null, null, TC.untitled));
      },
      async done(sequence, assets) {
        const studio = current();
        if (!studio) return false;
        const draft = studio.draft;
        const name = draft.name.trim() || TC.untitled;
        if (studio.source === 'video') {
          if (!studioDirty(studio)) {
            close();
            useEditor.getState().focusTemplate(true);
            return true;
          }
          if (!(await copyBrandLogos(runtime, draft))) return false;
          const operations: EditOperation[] = [{ type: 'setTemplate', sequenceId: sequence.id, template: { ...draft, name } }];
          const receipt = await actions.apply(operations, EditLabel.editTemplateLayout());
          if (!receipt) return false;
          close();
          useEditor.getState().focusTemplate(true);
          undoToast(actions, TC.layoutUpdated, receipt);
          return true;
        }
        if (studio.source === 'new-video') {
          // 套进视频的是自己的一套：不记来源（编辑中存进过品牌库的记那一条）；声明了套用时画幅就一并改画布，同一笔撤销。
          if (!(await copyBrandLogos(runtime, draft))) return false;
          const own = definitionOf(draft, name, OWN_ID);
          const plan = applyPlan(sequence, assets, own);
          const operations = plan.operations.map((op) => {
            if (op.type !== 'setTemplate' || !op.template) return op;
            const template = { ...op.template };
            if (draft.from) template.from = draft.from;
            else delete template.from;
            return { ...op, template };
          });
          const receipt = await actions.apply(operations, EditLabel.applyTemplate({ name }));
          if (!receipt) return false;
          close();
          useEditor.getState().focusTemplate(true);
          undoToast(actions, TC.appliedOwn(name), receipt);
          return true;
        }
        if (studio.source === 'brand' && studio.entryId) {
          if (!(await updateBrandTemplate(runtime, studio.entryId, draft, name))) return false;
          close();
          return true;
        }
        const saved = await saveTemplateToBrand(runtime, draft, name, useLibrary.getState().brand);
        if (!saved) return false;
        close();
        return true;
      },
      cancel() {
        const studio = current();
        if (!studio) return;
        close();
        if (studioDirty(studio)) ToastQueue.neutral(TC.layoutDiscarded, { timeout: TOAST_MS });
        if (studio.source === 'video') useEditor.getState().focusTemplate(true);
      },
      async saveToBrand(name) {
        const studio = current();
        if (!studio) return false;
        const saved = await saveTemplateToBrand(runtime, studio.draft, name, useLibrary.getState().brand);
        if (!saved) return false;
        // 视频里的这一份从此记着库里那一条（属性页写「已存进品牌库」）。
        useEditor.getState().updateStudio((s) => ({ ...s, draft: { ...s.draft, name: saved.name, from: saved.id } }));
        return true;
      },
    };
  }, [actions, runtime]);
}
