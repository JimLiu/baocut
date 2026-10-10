import { useEffect } from 'react';
import type { DocumentRecord, Id, Sequence } from '@baocut/protocol';
import { ToastQueue } from '@react-spectrum/s2';
import { aiTool, type AgentToolId } from '../../model/ai-tools.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useDirectory } from '../../state/directory-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { useVideo } from '../../state/video-store.ts';
import { useBindAiToolRun } from './ai-tool-direct-view.tsx';
import { AiAgentToolPage } from './ai-tools-agent-page.tsx';
import { AI_TOOLS_COPY as C } from './ai-tools-copy.ts';
import { AiToolsList } from './ai-tools-list.tsx';
import { closeAiTool, syncAiToolAgentRuns, useAiToolsNav } from './ai-tools-nav.ts';
import { AiToolSoon } from './ai-tools-soon.tsx';
import { DubFlow } from './dub-flow.tsx';
import { SpeakerFlow } from './speaker-flow.tsx';
import { TranslateFlow } from './translate-flow.tsx';
import { bindTranslate, type TranslateDeps } from './translate-run.ts';
import { EDITOR_COPY as E } from './editor-copy.ts';

const translateToast: TranslateDeps['toast'] = (kind, message, undo) =>
  ToastQueue[kind](
    message,
    undo
      ? {
          timeout: 5000,
          actionLabel: E.undo,
          onAction: undo,
          shouldCloseOnAction: true,
        }
      : { timeout: 5000 },
  );

/**
 * AI 工具 Tab（原型 panel-aitools.jsx `AiToolsPanel`，产品设计 §5.10）：没有打开的工具页时是列表页（`AiToolsList`），
 * 点一行或别的面板带着范围的入口（`openAiTool`）打开那个工具页，「返回」回列表。
 * 翻译字幕挂翻译设置页（提交后翻到字幕页看进度与收据）、翻译配音挂配音页（开始后留在原地看进度与收据）、识别说话人挂
 * 它的四态页（设置、运行、确认、收据都在原地，`SpeakerFlow`）；其余交给 Agent（`AiAgentToolPage`）。
 * 网页宿主没有这个 Tab（见 editor-store 的 `hostPanelTab`）。
 */
export function AiToolsPanel({ sequence, documents }: { sequence: Sequence; documents: Record<Id, DocumentRecord> }) {
  const runtime = useRuntime();
  useEffect(() => bindTranslate({ runtime, toast: translateToast }), [runtime]);
  // 直接调模型的任务在列表页也要收尾（列表上的状态、回到工具页时的结果）。
  useBindAiToolRun();
  // 重启前交给 Agent 的找可剪的口、刷新过期译文：那条会话还在跑就接上，跑完了就不再画进度卡。
  const ready = useDirectory((s) => s.ready);
  const conversations = useDirectory((s) => s.conversations);
  const queues = useShell((s) => s.queues);
  useEffect(() => syncAiToolAgentRuns({ ready, conversations, queued: (id) => !!queues[id]?.length }), [ready, conversations, queues]);
  const videoId = useVideo((s) => s.video?.videoId ?? null);
  const page = useAiToolsNav((s) => (videoId ? (s.pages[videoId] ?? null) : null));
  if (!videoId) return null;
  if (!page) return <AiToolsList videoId={videoId} sequence={sequence} documents={documents} />;

  const back = () => closeAiTool(videoId);
  const tool = aiTool(page.tool);
  if (tool.id === 'translate') {
    // 进度、问题与收据都在字幕页：提交后翻过去。
    return (
      <TranslateFlow
        videoId={videoId}
        documents={documents}
        backLabel={C.back}
        onBack={back}
        onStarted={() => closeAiTool(videoId, 'subtitle')}
      />
    );
  }
  // 配音的进度、跑到一半的授权询问、失败重试与收据都在配音页上：开始后留在原地。
  if (tool.id === 'dub') return <DubFlow videoId={videoId} documents={documents} onBack={back} />;
  // 识别结果先进确认页、应用后留收据：都在这一页上。
  if (tool.id === 'speakers') return <SpeakerFlow videoId={videoId} sequence={sequence} documents={documents} onBack={back} />;
  if (tool.tier === 'soon') return <AiToolSoon tool={tool} onBack={back} />;
  return (
    <AiAgentToolPage
      key={tool.id}
      videoId={videoId}
      tool={tool.id as AgentToolId}
      preset={page.preset}
      sequence={sequence}
      documents={documents}
      onBack={back}
    />
  );
}
