import { defineMessages, type Money } from '@baocut/protocol';
import { zhHans } from './services-mcp-copy.zh-Hans.ts';
import { zhHant } from './services-mcp-copy.zh-Hant.ts';
import { ja } from './services-mcp-copy.ja.ts';
import { ko } from './services-mcp-copy.ko.ts';
import { es } from './services-mcp-copy.es.ts';
import { fr } from './services-mcp-copy.fr.ts';
import { de } from './services-mcp-copy.de.ts';
import { nl } from './services-mcp-copy.nl.ts';
import { ptBR } from './services-mcp-copy.pt-BR.ts';
import { it } from './services-mcp-copy.it.ts';
import { ru } from './services-mcp-copy.ru.ts';
import { pl } from './services-mcp-copy.pl.ts';
import { tr } from './services-mcp-copy.tr.ts';
import { vi } from './services-mcp-copy.vi.ts';

/** MCP 服务页的文案：访问等级、开放范围、工具目录与去向、最近请求、外发授权（译文在 `services-mcp-copy.<语言>.ts`）。 */
const en = {
  levels: {
    read: { title: 'Read only', desc: 'View video info, transcripts, and processing status' },
    ask: { title: 'Ask before changes', desc: 'Confirm in BaoCut before transcribing, editing, exporting, or generating' },
    auto: { title: 'Allow without asking', desc: 'Writes, tasks, and generation run right away without confirmation; best when only you use it' },
  },
  scopeAll: (total: number) => `All videos (${total})`,
  scopeNone: 'No videos exposed',
  scopeOne: (name: string) => `“${name}”`,
  scopeSome: (n: number) => `${n} selected videos`,
  access: (level: string) => `${level} · Token required`,
  subOn: (scope: string, access: string) => `${scope} · ${access}`,
  subOff: (scope: string, access: string) => `When started: ${scope} · ${access}`,
  groups: {
    read: { label: 'Read', hint: 'Read only; doesn’t change videos and answers right away' },
    edit: { label: 'Edit', hint: 'Writes to the video; each call is one undoable step' },
    job: { label: 'Tasks', hint: 'Long-running work; returns a task ID right away. Use jobs_inspect for progress and results' },
    generate: { label: 'Generate', hint: 'Synthesizes speech from text and creates images from prompts; no video needed' },
  },
  tools: {
    videos_list: 'List videos',
    videos_create: 'Create video',
    videos_inspect: 'Inspect video',
    documents_read: 'Read documents',
    edits_apply: 'Edit video',
    edits_undo: 'Undo edits',
    captions_create: 'Create subtitle layer',
    videos_frames: 'Grab video frames',
    videos_history: 'View edit history',
    documents_put: 'Write document',
    assets_import: 'Import assets',
    compositions_import: 'Import motion graphic',
    compositions_preview: 'Preview motion graphic',
    assets_prune: 'Clean up unused assets',
    chapters_adopt: 'Adopt source chapters',
    edits_ops: 'View edit operations',
    models_capabilities: 'See model capabilities',
    models_list: 'List local model bundles',
    transcribe: 'Transcribe',
    translate: 'Translate',
    dub: 'Translate & dub',
    speak: 'Synthesize speech',
    image: 'Generate image',
    jobs_inspect: 'Check tasks',
    jobs_wait: 'Wait for task',
    jobs_list: 'List tasks',
    jobs_cancel: 'Cancel task',
    jobs_retry: 'Retry failed pipeline',
    export: 'Export',
    space_list: 'List items in Space',
    space_search: 'Search transcripts across videos',
    projects_list: 'List projects',
    skills_list: 'List skills',
    skills_read: 'Read skill',
    library_list: 'List library',
    library_show: 'View library item',
    download: 'Download from link',
  },
  gates: {
    answer: 'Answers directly',
    auto: 'Runs directly',
    ask: 'Asks before calling',
    hidden: 'Not offered with read-only access',
  },
  toolsSummary: (exposed: number, total: number, ask: number, writes: number) => {
    const tail = ask ? ` · ${ask} ask before calling` : writes ? ' · No confirmation needed' : ' · All read only';
    return `${exposed} of ${total} tools offered${tail}`;
  },
  outcomes: {
    ok: 'Succeeded',
    denied: 'Not allowed',
    videoNotFound: 'Video not in scope',
    unknownTool: 'Tool not offered',
  },
  requestLine: (tool: string, video: string) => `${tool} · “${video}”`,
  joinKinds: (labels: readonly string[]) => labels.join(', '),
  grantLine: (kinds: string, recipient: string, purpose: string, estimate: Money | null) =>
    `Will send ${kinds} to ${recipient} (${purpose})${estimate ? ` · About ${estimate.amount} ${estimate.currency}` : ''}`,
};

export type ServicesMcpMessages = typeof en;
export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
