import { useEffect } from 'react';
import type { DocumentRecord, Id, Sequence } from '@baocut/protocol';
import { ToastQueue } from '@react-spectrum/s2';
import { aiTool, type AgentToolId } from '../../model/ai-tools.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useVideo } from '../../state/video-store.ts';
import { AiAgentToolPage } from './ai-tools-agent-page.tsx';
import { AI_TOOLS_COPY as C } from './ai-tools-copy.ts';
import { closeAiTool, useAiToolsNav } from './ai-tools-nav.ts';
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
 * 工具页的宿主（原型 panel-aitools.jsx `AiToolsPanel`，产品设计 §5.10）：编辑器没有「AI 工具」这一页，这里只放从别处打开的那一个工具页
 * （文稿、字幕、素材与时间线上的入口，见 `openAiTool`），返回时回到来的那一页；没有打开的工具页时自己让开。
 * 翻译字幕挂翻译设置页（提交后翻到字幕页看进度与收据）、翻译配音挂配音页（开始后留在原地看进度与收据）、识别说话人挂
 * 它的四态页（设置、运行、确认、收据都在原地，`SpeakerFlow`）；其余交给 Agent（`AiAgentToolPage`）。
 * 网页宿主没有这一页（见 editor-store 的 `hostPanelTab`）。
 */
export function AiToolsPanel({ sequence, documents }: { sequence: Sequence; documents: Record<Id, DocumentRecord> }) {
  const runtime = useRuntime();
  useEffect(() => bindTranslate({ runtime, toast: translateToast }), [runtime]);
  const videoId = useVideo((s) => s.video?.videoId ?? null);
  const page = useAiToolsNav((s) => (videoId ? (s.pages[videoId] ?? null) : null));
  const idle = !videoId || !page;
  useEffect(() => {
    if (idle) closeAiTool(videoId);
  }, [idle, videoId]);
  if (!videoId || !page) return null;

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
      tool={tool.id as AgentToolId}
      preset={page.preset}
      sequence={sequence}
      documents={documents}
      onBack={back}
    />
  );
}
