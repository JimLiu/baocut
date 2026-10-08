import { createContext, useContext } from 'react';
import type { EditOperation, TransactionReceipt, UndoTarget } from '@baocut/protocol';
import type { PreviewEngine } from './preview-engine.ts';

/**
 * 编辑器各部分共用的动作：播放与定位走预览引擎，修改走视频控制器（命令排队、带最新版本号）。
 * 视频内容与选区等状态在 store 里，各部分按需订阅。
 */
export interface EditorActions {
  engine: PreviewEngine;
  /** 定位播放头（秒）。播放中定位后接着播。 */
  seek(seconds: number): void;
  togglePlay(): void;
  pause(): void;
  /** 提交一笔修改。失败时错误由编辑器统一提示，这里返回 null。 */
  apply(operations: EditOperation[], label?: string): Promise<TransactionReceipt | null>;
  undo(target: UndoTarget): Promise<TransactionReceipt | null>;
}

export const EditorContext = createContext<EditorActions | null>(null);

export function useEditorActions(): EditorActions {
  const actions = useContext(EditorContext);
  if (!actions) throw new Error('EditorContext 缺失'); // i18n-ignore: 开发期断言，不给用户看
  return actions;
}
