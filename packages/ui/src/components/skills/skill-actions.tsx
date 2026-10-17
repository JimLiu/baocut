import { useState, type ReactNode } from 'react';
import type { SkillSummary } from '@baocut/protocol';
import { ActionButton, AlertDialog, DialogContainer, Menu, MenuItem, MenuTrigger, Text, ToastQueue } from '@react-spectrum/s2';
import Delete from '@react-spectrum/s2/icons/Delete';
import Download from '@react-spectrum/s2/icons/Download';
import Duplicate from '@react-spectrum/s2/icons/Duplicate';
import Edit from '@react-spectrum/s2/icons/Edit';
import FolderOpen from '@react-spectrum/s2/icons/FolderOpen';
import More from '@react-spectrum/s2/icons/More';
import Play from '@react-spectrum/s2/icons/Play';
import { skillDisplayName, skillErrorMessage } from '../../model/agent-skills.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { duplicateSkill, exportSkill, removeSkill, setSkillEnabled } from '../../runtime/skill-commands.ts';
import { useDraftSkills } from '../../state/draft-skills-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { openHome, startDraftKey } from '../start/open-home.ts';
import { MENU_COPY, REMOVE_COPY, TOAST_COPY, UPLOAD_COPY } from './skills-copy.ts';

export interface SkillActions {
  /** 浏览器里只能看与开关（产品设计 §6.9「浏览器与外部 Agent」）。 */
  web: boolean;
  open(skill: SkillSummary, view?: 'files'): void;
  toggle(skill: SkillSummary, enabled: boolean): void;
  /** 新会话的起始页挂上这个 skill；`prompt` 填进空着的输入框。 */
  tryIt(skill: SkillSummary, prompt?: string): void;
  download(skill: SkillSummary): void;
  reveal(skill: SkillSummary): void;
  duplicate(skill: SkillSummary): void;
  /** 先确认（`dialog` 里的那个），移除后调 `after`。 */
  remove(skill: SkillSummary, after?: () => void): void;
  /** 移除确认框：挂在用这组动作的页面里。 */
  dialog: ReactNode;
}

/** 列表行与详情页共用的动作（原型 page-skills.jsx `useSkillActions`）。 */
export function useSkillActions(): SkillActions {
  const runtime = useRuntime();
  const web = runtime.host.platform === 'web';
  const go = useShell((s) => s.go);
  const [removing, setRemoving] = useState<{ skill: SkillSummary; after?: () => void } | null>(null);

  const confirmRemove = async (skill: SkillSummary, after?: () => void) => {
    try {
      await removeSkill(runtime, skill.id);
      after?.();
      ToastQueue.neutral(TOAST_COPY.removed(skillDisplayName(skill)), { timeout: 4000 });
    } catch (error) {
      ToastQueue.negative(skillErrorMessage(error, 'remove'), { timeout: 6000 });
    }
  };

  return {
    web,
    open: (skill, view) => go({ tab: 'skills', id: skill.id, ...(view ? { view } : {}) }),
    toggle: (skill, enabled) =>
      void setSkillEnabled(runtime, skill.id, enabled).then(
        () => ToastQueue.neutral(enabled ? TOAST_COPY.on(skillDisplayName(skill)) : TOAST_COPY.off(skillDisplayName(skill)), { timeout: 5000 }),
        (error) => ToastQueue.negative(skillErrorMessage(error, 'toggle'), { timeout: 5000 }),
      ),
    tryIt: (skill, prompt) => {
      useDraftSkills.getState().add(startDraftKey(null), skill.id);
      openHome(null, prompt ? { prompt } : {});
    },
    download: async (skill) => {
      const target = await runtime.host.pickSavePath?.({
        defaultName: `${skill.id}.zip`,
        filters: [{ name: UPLOAD_COPY.zipFilter, extensions: ['zip'] }],
      });
      if (!target) return;
      try {
        const { path } = await exportSkill(runtime, skill.id, target);
        ToastQueue.positive(TOAST_COPY.downloaded(path), { timeout: 5000 });
      } catch (error) {
        ToastQueue.negative(skillErrorMessage(error, 'export'), { timeout: 6000 });
      }
    },
    reveal: (skill) => void runtime.host.revealPath(skill.path),
    duplicate: async (skill) => {
      try {
        const { skill: copy } = await duplicateSkill(runtime, skill.id);
        ToastQueue.positive(TOAST_COPY.duplicated(skillDisplayName(copy)), { timeout: 5000 });
        go({ tab: 'skills', id: copy.id, view: 'files' });
      } catch (error) {
        ToastQueue.negative(skillErrorMessage(error, 'duplicate'), { timeout: 6000 });
      }
    },
    remove: (skill, after) => setRemoving({ skill, ...(after ? { after } : {}) }),
    dialog: (
      <DialogContainer onDismiss={() => setRemoving(null)}>
        {removing ? (
          <AlertDialog
            variant="destructive"
            title={REMOVE_COPY.title(skillDisplayName(removing.skill))}
            primaryActionLabel={REMOVE_COPY.confirm}
            cancelLabel={REMOVE_COPY.cancel}
            onPrimaryAction={() => void confirmRemove(removing.skill, removing.after)}>
            {REMOVE_COPY.body(removing.skill.path)}
          </AlertDialog>
        ) : null}
      </DialogContainer>
    ),
  };
}

/**
 * 行与详情页的「更多」菜单：试一下 / 编辑 / 下载 / 在文件夹中显示 / 复制一份 / 移除。浏览器里只有「试一下」：
 * 其余要写盘、选本机位置或打开本机文件夹。
 */
export function SkillMoreMenu({
  skill,
  actions,
  label,
  onRemoved,
}: {
  skill: SkillSummary;
  actions: SkillActions;
  label: string;
  onRemoved?: () => void;
}) {
  const builtin = skill.origin === 'builtin';
  const personal = skill.origin === 'personal';
  const run = (key: string) => {
    if (key === 'try') actions.tryIt(skill);
    else if (key === 'edit') actions.open(skill, 'files');
    else if (key === 'download') actions.download(skill);
    else if (key === 'reveal') actions.reveal(skill);
    else if (key === 'duplicate') actions.duplicate(skill);
    else if (key === 'remove') actions.remove(skill, onRemoved);
  };
  return (
    <MenuTrigger align="end">
      <ActionButton isQuiet aria-label={label}>
        <More />
      </ActionButton>
      <Menu aria-label={MENU_COPY.label} onAction={(key) => run(String(key))} disabledKeys={skill.removable ? [] : ['remove']}>
        <MenuItem id="try" textValue={MENU_COPY.try}>
          <Play />
          <Text slot="label">{MENU_COPY.try}</Text>
        </MenuItem>
        {actions.web ? null : (
          <>
            {personal ? (
              <MenuItem id="edit" textValue={MENU_COPY.edit}>
                <Edit />
                <Text slot="label">{MENU_COPY.edit}</Text>
              </MenuItem>
            ) : null}
            <MenuItem id="download" textValue={MENU_COPY.download}>
              <Download />
              <Text slot="label">{MENU_COPY.download}</Text>
              <Text slot="description">{MENU_COPY.downloadHint}</Text>
            </MenuItem>
            <MenuItem id="reveal" textValue={MENU_COPY.reveal}>
              <FolderOpen />
              <Text slot="label">{MENU_COPY.reveal}</Text>
            </MenuItem>
            <MenuItem id="duplicate" textValue={MENU_COPY.duplicate}>
              <Duplicate />
              <Text slot="label">{MENU_COPY.duplicate}</Text>
              <Text slot="description">{builtin ? MENU_COPY.duplicateBuiltin : MENU_COPY.duplicateHint}</Text>
            </MenuItem>
            <MenuItem id="remove" textValue={MENU_COPY.remove}>
              <Delete />
              <Text slot="label">{MENU_COPY.remove}</Text>
              <Text slot="description">{skill.removable ? MENU_COPY.removeHint : MENU_COPY.removeBuiltin}</Text>
            </MenuItem>
          </>
        )}
      </Menu>
    </MenuTrigger>
  );
}
