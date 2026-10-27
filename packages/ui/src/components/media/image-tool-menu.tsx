import type { SpaceEntry } from '@baocut/protocol';
import { ActionButton, Menu, MenuItem, MenuTrigger, Text, ToastQueue } from '@react-spectrum/s2';
import Tools from '@react-spectrum/s2/icons/Tools';
import { toolById, type ToolId } from '../../model/tool-catalog.ts';
import { IMAGE_EDIT_OPS } from '../../model/tools-image-edit.ts';
import { M as EDIT } from '../../model/tools-image-edit-copy.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { openImageEditWithPath } from '../tools/image-edit-sources.ts';
import { ENTRY_TOOL_COPY as COPY } from '../tools/tools-copy.ts';
import { useEntryTools } from '../tools/use-entry-tools.ts';

/*
 * 图片查看器表头的「用工具处理…」（设计稿 media-preview-image-chrome.jsx `MediaImageToolMenu`）：进工具页时这张图已经选好。
 * Space 里的图片条目列 Space 查看框底栏同一组工具；本机文件（`localPath`）列五个图片编辑工具（放大、去除物体、去水印、重绘、扩图）。
 * 会话附件与视频素材不是工具能直接读的输入，不出这个菜单。`onLeave` 在去工具页之前关掉查看器。
 */

export function ImageToolMenu({
  entry,
  path,
  name,
  onLeave,
}: {
  entry: SpaceEntry | null;
  path: string | null;
  name: string;
  onLeave?: () => void;
}) {
  const runtime = useRuntime();
  const entryTools = useEntryTools(entry?.kind === 'image' ? entry : null);
  const tools =
    entryTools?.tools ?? (path ? IMAGE_EDIT_OPS.map((o) => ({ id: o.toolId, name: toolById(o.toolId)?.name ?? o.toolId })) : []);
  if (!tools.length) return null;
  const pick = (id: ToolId) => {
    if (entryTools) {
      onLeave?.();
      entryTools.openTool(id);
    } else if (path) {
      void openImageEditWithPath(runtime, id, path).then((ok) =>
        ok ? onLeave?.() : ToastQueue.neutral(EDIT.notImages, { timeout: 5000 }),
      );
    }
  };
  return (
    <MenuTrigger align="end">
      <ActionButton isQuiet>
        <Tools />
        <Text>{COPY.menu}</Text>
      </ActionButton>
      <Menu aria-label={COPY.menuLabel(name)} onAction={(key) => pick(String(key) as ToolId)}>
        {tools.map((t) => (
          <MenuItem key={t.id} id={t.id} textValue={t.name}>
            <Text slot="label">{t.name}</Text>
          </MenuItem>
        ))}
      </Menu>
    </MenuTrigger>
  );
}
