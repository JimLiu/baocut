import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './rc-ai-tools.zh-Hans.ts';
import { zhHant } from './rc-ai-tools.zh-Hant.ts';
import { ja } from './rc-ai-tools.ja.ts';
import { ko } from './rc-ai-tools.ko.ts';
import { es } from './rc-ai-tools.es.ts';
import { fr } from './rc-ai-tools.fr.ts';
import { de } from './rc-ai-tools.de.ts';
import { nl } from './rc-ai-tools.nl.ts';
import { ptBR } from './rc-ai-tools.pt-BR.ts';
import { it } from './rc-ai-tools.it.ts';
import { ru } from './rc-ai-tools.ru.ts';
import { pl } from './rc-ai-tools.pl.ts';
import { tr } from './rc-ai-tools.tr.ts';
import { vi } from './rc-ai-tools.vi.ts';

/** AI 工具的「直接调模型」（`ai-tool` 流程，`ai-tools/ai-tool-pipeline.ts`）：流程名、步骤、错误与编辑历史里的名字。英文是键与类型的来源。 */
const en = {
  label: "AI tool (direct model call)",
  description: "Sends a prompt with this video's transcript, chapters and attachments straight to a text model, with no agent or conversation. Polish and chapters are written to the video as one undoable change; the other tools return text to read and copy.",
  stepPrepare: "Gather context",
  stepGenerate: "Call the model",
  stepApply: "Write to video",
  paramsInvalid: (p: { key: string }) => `Parameter ${p.key} is missing or invalid`,
  videoNotOpen: "The video is not open",
  noStructuredOutput: (p: { model: string }) => `Model ${p.model} doesn't support structured output, so it can't polish the transcript or write chapters`,
  noTranscript: "The video has no transcript. Transcribe it first.",
  multipleTranscripts: "The video has more than one transcript. Use documentId to choose one.",
  notSpeech: (p: { documentId: string }) => `Document ${p.documentId} is not a transcript`,
  nothingInRange: "There's no transcript in this range",
  outputInvalid: "The model's reply wasn't in the expected format. Retry, or try another model.",
  polishMismatch: "The model's corrections don't line up with the transcript's words, so nothing was written",
  noChapters: "The model didn't return any usable chapters",
  sourceChanged: "The transcript changed while the model was working, so nothing was written. Retry to use the current version.",
  videoClosed: "The video was closed",
  rejected: "The change was rejected, so nothing was written to the video",
  transactionPolish: "Polish transcript",
  transactionChapters: "Generate chapters",
  notReady: "The Runtime is still starting. Try again in a moment.",
};

export type RcAiToolsMessages = typeof en;

export const RcAiTools = defineCatalog('rcAiTools', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
