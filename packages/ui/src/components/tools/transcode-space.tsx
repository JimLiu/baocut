import type { Id } from '@baocut/protocol';
import { KIND_LABEL } from '../../model/space.ts';
import { addEntryInput, entryIdOfInput, fileName } from '../../model/tools-transcode.ts';
import type { FileVideoToolId } from '../../model/tool-catalog.ts';
import { useSpace } from '../../state/space-store.ts';
import { SpacePicker } from './tool-video-picker.tsx';
import { TRANSCODE_COPY } from './tools-copy.ts';

/*
 * 压缩、合并、提取音频的 Space 输入（架构设计 §7.9「Space 条目作输入」）：列表里的条目记成 `space:<entryId>`，
 * 这里给它们起名字，并画「从 Space 添加…」的选择器——选一条就加到列表末尾。
 */

export interface InputName {
  name: string;
  sub: string;
}

/** 列表项的名字与第二行：本机文件是文件名与完整路径，Space 条目是条目名与「Space · 种类」。 */
export function useInputName(): (input: string) => InputName {
  const entries = useSpace((s) => s.entries);
  return (input) => {
    const entryId = entryIdOfInput(input);
    if (!entryId) return { name: fileName(input), sub: input };
    const entry = entries.find((e) => e.id === entryId);
    return entry ? { name: entry.name, sub: TRANSCODE_COPY.spaceItem(KIND_LABEL[entry.kind]) } : { name: entryId, sub: TRANSCODE_COPY.spaceGone };
  };
}

/** 从 Space 选条目加进列表：已经加过的再选不重复加。 */
export function SpaceInputs({
  tool,
  inputs,
  onChange,
}: {
  tool: FileVideoToolId;
  inputs: readonly string[];
  onChange: (inputs: string[]) => void;
}) {
  const last = [...inputs].reverse().map(entryIdOfInput).find((id): id is Id => !!id) ?? null;
  return <SpacePicker tool={tool} data={null} value={last} onChange={(entryId) => onChange(addEntryInput(inputs, entryId))} />;
}
