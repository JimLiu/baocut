import type { Id } from '@baocut/protocol';
import { ToastQueue } from '@react-spectrum/s2';
import { HOME_COPY } from '../../copy.ts';
import { RATIO_SIZE, type Ratio } from '../../model/new-flow.ts';
import type { RuntimeSession } from '../../runtime/session.ts';
import { useShell } from '../../state/shell-store.ts';

/**
 * 新建空白视频（原型 page-new.jsx `createBlank`）：不是提示词，也不经过 Agent。按画幅建一个空视频，直接在功能区打开。
 * 起始页的「新建空白视频」与 Space 的「新建空白视频」共用。没选项目时先建一个项目，视频放进去（同原先的固定流程）。
 */
export async function createBlankVideo(
  runtime: Pick<RuntimeSession, 'createProject' | 'createFlowVideo'>,
  projectId: Id | null,
  ratio: Ratio,
): Promise<boolean> {
  try {
    const into = projectId ?? (await runtime.createProject(HOME_COPY.blankVideoProject)).id;
    const { target } = await runtime.createFlowVideo({ projectId: into }, RATIO_SIZE[ratio]);
    useShell.getState().openVideo(target, { conversationId: null, projectId: into });
    ToastQueue.positive(HOME_COPY.blankVideoCreated, { timeout: 4000 });
    return true;
  } catch (error) {
    ToastQueue.negative(HOME_COPY.blankVideoFailed((error as Error).message), { timeout: 5000 });
    return false;
  }
}
