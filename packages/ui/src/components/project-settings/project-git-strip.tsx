import { useState } from 'react';
import type { Id } from '@baocut/protocol';
import { ActionButton, ProgressCircle, StatusLight, Text } from '@react-spectrum/s2';
import Settings from '@react-spectrum/s2/icons/Settings';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { canCommit, gitLight, inRepo, lastCommitText } from '../../model/project-git.ts';
import { useNow } from '../use-now.ts';
import { PROJECT_SETTINGS_COPY as C } from './project-settings-copy.ts';
import { useGitCommit, useProjectGit, type GitNote } from './use-project-git.ts';

/**
 * 版本记录对话框底部那一条项目的 git（原型 project-git.jsx `ProjectGitStrip`）：状态灯、上次提交或这次提交的结果、
 * 「提交到 git」与「项目设置」。项目设置是另一个模态对话框，`onOpenSettings` 先关掉版本记录再打开它。
 */
export function ProjectGitStrip({ projectId, onOpenSettings }: { projectId: Id; onOpenSettings(): void }) {
  const now = useNow(30_000);
  const { status, loadError } = useProjectGit(projectId);
  const [note, setNote] = useState<GitNote | null>(null);
  const { busy, commit } = useGitCommit(projectId, setNote);
  const light = status ? gitLight(status) : null;
  const line = note ? note.text : loadError ? C.loadFailed(loadError) : status ? lastCommitText(status.lastCommit, now) : null;
  const negative = note ? note.tone === 'negative' : Boolean(loadError);
  return (
    <div className={strip} role="group" aria-label={C.stripLabel}>
      <span className={key}>{C.gitHeading}</span>
      {light ? (
        <StatusLight variant={light.tone} size="S">
          {light.label}
        </StatusLight>
      ) : loadError ? null : (
        <ProgressCircle size="S" isIndeterminate aria-label={C.loading} />
      )}
      {line ? (
        <span className={lineText({ isNegative: negative })} title={line}>
          {line}
        </span>
      ) : null}
      <span className={grow} />
      {status && inRepo(status) ? (
        <ActionButton size="S" isQuiet isDisabled={!canCommit(status) || busy} onPress={commit}>
          {busy ? <ProgressCircle size="S" isIndeterminate aria-label={C.committing} /> : null}
          <Text>{busy ? C.committing : C.commit}</Text>
        </ActionButton>
      ) : null}
      <ActionButton size="S" isQuiet onPress={onOpenSettings}>
        <Settings />
        <Text>{C.projectSettings}</Text>
      </ActionButton>
    </div>
  );
}

const NARROW = '@media (max-width: 720px)';

const strip = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 12, rowGap: 4, marginBottom: 8, color: 'gray-700' });
const key = style({ fontWeight: 'bold', color: 'gray-900' });
/** 窄屏：上次提交或结果那一句换到下一行，可以折行。 */
const lineText = style<{ isNegative: boolean }>({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: { default: 'nowrap', [NARROW]: 'normal' },
  flexBasis: { default: 'auto', [NARROW]: 'full' },
  order: { default: 0, [NARROW]: 1 },
  color: { default: 'gray-700', isNegative: 'red-900' },
});
const grow = style({ flexGrow: 1 });
