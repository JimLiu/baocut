import { toolById, type ToolId } from '../model/tool-catalog.ts';
import { plannedReason } from '../model/tools-gallery.ts';
import { DubTool } from './tools/dub-tool.tsx';
import { ImageTool } from './tools/image-tool.tsx';
import { LinkTool } from './tools/link-tool.tsx';
import { PlannedTool } from './tools/planned-tool.tsx';
import { TextTool } from './tools/text-tool.tsx';
import { CompressTool, ExtractAudioTool, MergeTool } from './tools/transcode-tool.tsx';
import { ToolsGallery } from './tools/tools-gallery.tsx';
import { TranscribeTool } from './tools/transcribe-tool.tsx';
import { TranslateTool } from './tools/translate-tool.tsx';
import { TtsTool } from './tools/tts-tool.tsx';

/**
 * 工具（产品设计 §2.1、§2.7，设计稿 page-tools.jsx）：没带工具时是总览；每个工具一页工作台（压缩、合并、提取音频共用一页，
 * 页顶切换）；还没有后端的工具深链进来时说「即将推出」和原因。
 */
export function ToolsPage({ tool }: { tool?: ToolId }) {
  const info = toolById(tool);
  if (!info) return <ToolsGallery />;
  const reason = plannedReason(info.id);
  if (reason) return <PlannedTool tool={info} reason={reason} />;
  switch (info.id) {
    case 'transcribe':
      return <TranscribeTool />;
    case 'translate-subtitles':
      return <TranslateTool />;
    case 'dub':
      return <DubTool />;
    case 'link-import':
      return <LinkTool />;
    case 'synthesize-speech':
      return <TtsTool />;
    case 'generate-image':
      return <ImageTool />;
    case 'generate-text':
      return <TextTool />;
    case 'compress-video':
      return <CompressTool />;
    case 'merge-video':
      return <MergeTool />;
    case 'extract-audio':
      return <ExtractAudioTool />;
    default:
      return <ToolsGallery />;
  }
}
