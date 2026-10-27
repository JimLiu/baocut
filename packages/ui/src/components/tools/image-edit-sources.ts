import type { ImageSource } from '../../model/tools-image-edit.ts';
import { imageEditOpOfTool } from '../../model/tools-image-edit.ts';
import { fileName } from '../../model/tools-transcode.ts';
import type { ToolId } from '../../model/tool-catalog.ts';
import type { useRuntime } from '../../runtime/context.tsx';
import { useShell } from '../../state/shell-store.ts';
import { useTools } from '../../state/tools-store.ts';

/*
 * 图片编辑工具的来源图怎么读进来：本机文件与 Space 条目都经媒体通道拿地址、按真像素量尺寸。工具页与图片查看器的「用工具处理…」共用。
 */

type Runtime = ReturnType<typeof useRuntime>;

/** 读一张本机图片：经媒体通道拿地址，按真像素量尺寸；读不出时 null。 */
export async function loadLocal(runtime: Runtime, path: string): Promise<ImageSource | null> {
  try {
    const handle = await runtime.resolveMedia({ localPath: path });
    const size = await naturalSize(handle.url);
    return size ? { input: path, name: fileName(path), url: handle.url, ...size } : null;
  } catch {
    return null;
  }
}

/** 读一张 Space 里的图片：经媒体通道按条目拿地址，按真像素量尺寸；读不出时 null。 */
export async function loadEntry(runtime: Runtime, entryId: string): Promise<Omit<ImageSource, 'name'> | null> {
  try {
    const handle = await runtime.resolveMedia({ entryId });
    const size = await naturalSize(handle.url);
    return size ? { input: `space:${entryId}`, url: handle.url, ...size } : null;
  } catch {
    return null;
  }
}

function naturalSize(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((done) => {
    const img = new Image();
    img.onload = () => done(img.naturalWidth && img.naturalHeight ? { width: img.naturalWidth, height: img.naturalHeight } : null);
    img.onerror = () => done(null);
    img.src = url;
  });
}

/**
 * 查看器里的本机图片「用工具处理…」：照预选 Space 条目的规矩放进来源（能批量的接在后面，单张的替换），再去那个工具页。
 * 不是图片编辑工具、或读不出这张图时返回 false。
 */
export async function openImageEditWithPath(runtime: Runtime, toolId: ToolId, path: string): Promise<boolean> {
  const op = imageEditOpOfTool(toolId);
  const src = op ? await loadLocal(runtime, path) : null;
  if (!op || !src) return false;
  const { imageEdit, patchImageEdit } = useTools.getState();
  patchImageEdit({ sources: op.batch ? [...imageEdit.sources.filter((s) => s.input !== src.input), src] : [src], selections: {} });
  useShell.getState().go({ tab: 'tools', tool: toolId });
  return true;
}
