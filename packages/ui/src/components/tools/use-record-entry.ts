import type { ToolGroupKey } from '../../model/tool-catalog.ts';
import { RC } from '../recording/recording-copy.ts';
import { blockText, useRecordingEntry } from '../recording/recording-host.tsx';
import { useHomeProjectId } from '../start/use-home-project.ts';
import { GALLERY_COPY } from './tools-copy.ts';

/**
 * 工具总览与侧栏上的「屏幕录制」（屏幕录制设计 §11「入口」，设计稿 model-tools.js `RECORD_ENTRY`）：放在「视频文件」组的最前面。
 * 它不是工具：不在工具目录（`TOOL_IDS`）与 `tools.list` 里，没有工作台页与路由，点了打开录制面板，录成 Home 此刻用的项目里的一个新视频
 * （与 Home 的「录制」同一判定）。Web 与不能录的宿主不显示；Runtime 说不能录（远程、平台不支持）或正在录时置灰，`disabled` 是原因。
 */
export const RECORD_ENTRY_GROUP: ToolGroupKey = 'video-file';

export interface RecordEntry {
  name: string;
  desc: string;
  result: string;
  disabled: string | null;
  onPress(): void;
}

export function useRecordEntry(): RecordEntry | null {
  const recording = useRecordingEntry();
  const projectId = useHomeProjectId(null);
  if (recording.entry.kind === 'hidden') return null;
  return {
    name: GALLERY_COPY.recordName,
    desc: RC.recordTip,
    result: GALLERY_COPY.recordResult,
    disabled: recording.entry.kind === 'disabled' ? blockText(recording.entry.block) : null,
    onPress: () => recording.open({ target: { home: { projectId } } }),
  };
}
