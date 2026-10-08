// i18n-ignore-file: 给模型的工具说明、错误与下一步
import { z } from 'zod';
import { RpcError, type LibraryEntry, type LibraryEntrySummary, type LibraryName } from '@baocut/protocol';
import type { LibraryService } from '../library/library-service.ts';
import { ToolError, type ToolInfo, type ToolSet } from './tool-catalog.ts';
import type { ToolPrincipal, ToolScope } from './tool-scope.ts';

/**
 * 用户库的只读工具（架构设计 §5.9；Agent 面设计 §4.3）：`library_list` 列出术语表、音色与品牌库的条目摘要，`library_show` 取一个
 * 条目的内容（术语表的词条、音色的说明与参考录音的事实、品牌素材）。三个面都有，规划模式下也能用；写入、导入导出与音色克隆
 * 不在目录里（管理面，只由用户在界面或 CLI 里做）。结果里没有库在本机的存放路径。
 */

export interface LibraryToolsDeps {
  library: Pick<LibraryService, 'list' | 'get'>;
  scope: ToolScope;
}

/** 三个库，与协议的 `LibraryName` 一一对应（少一个时类型检查不过）。 */
const LIBRARY_NAMES = ['glossaries', 'voices', 'brand'] as const;
type MissingLibrary = Exclude<LibraryName, (typeof LIBRARY_NAMES)[number]>;
const _allLibraries: MissingLibrary extends never ? true : never = true;
void _allLibraries;

const LIBRARY_LABEL = '术语表 glossaries、音色 voices、品牌库 brand';

const schemas = {
  library_list: z.strictObject({
    library: z.enum(LIBRARY_NAMES).optional().describe(`可选。只列一个库：${LIBRARY_LABEL}；不给时三个库都列`),
    kind: z
      .string()
      .min(1)
      .max(40)
      .optional()
      .describe(
        '可选。只列这一种：术语表是 transcription（识别用）或 translation（翻译用），音色是 voice，品牌库是 image、video、sticker、font、color、captionStyle',
      ),
  }),
  library_show: z.strictObject({
    library: z.enum(LIBRARY_NAMES).describe(`条目所在的库：${LIBRARY_LABEL}`),
    id: z.string().min(1).max(200).describe('条目的 id：library_list 给出'),
  }),
};

type ToolName = keyof typeof schemas;
type Args<N extends ToolName> = z.infer<(typeof schemas)[N]>;

const DEFINITIONS: Record<ToolName, ToolInfo> = {
  library_list: {
    title: '列出用户库',
    description: [
      '列出用户库里的术语表、音色与品牌素材（摘要）。',
      '每个条目：库、id、名字、种类、版本与更新时间；术语表另有词条数与是否默认启用，音色另有有没有授权声明与各服务商上克隆的状态。内容用 library_show 取。',
      '只读；修改、导入与音色克隆由用户在 BaoCut 里做。',
    ].join('\n'),
    annotations: { readOnlyHint: true },
    effect: 'query',
    examples: [
      { title: '列出全部条目', args: {} },
      { title: '翻译用的术语表', args: { library: 'glossaries', kind: 'translation' } },
    ],
    surfaces: ['agent', 'mcp', 'cli'],
  },
  library_show: {
    title: '查看用户库条目',
    description: [
      '取用户库里一个条目的内容。',
      '术语表给出全部词条（识别用的是规范写法与常见误写，翻译用的是源词、译法与说明）与语言；音色给出名字、语言、参考录音的逐字稿与文件事实、授权声明与克隆状态；品牌素材给出文件事实、颜色值或字幕样式。',
      '只读；不返回文件本身，也不给本机路径。',
    ].join('\n'),
    annotations: { readOnlyHint: true },
    effect: 'query',
    examples: [{ title: '查看一份术语表', args: { library: 'glossaries', id: 'lib_0123456789abcdef' } }],
    surfaces: ['agent', 'mcp', 'cli'],
    positional: 'id',
  },
};

export class LibraryTools implements ToolSet {
  readonly schemas = schemas;
  readonly definitions = DEFINITIONS;
  readonly #deps: LibraryToolsDeps;

  constructor(deps: LibraryToolsDeps) {
    this.#deps = deps;
  }

  async dispatch(name: string, args: unknown, principal: ToolPrincipal): Promise<unknown> {
    switch (name as ToolName) {
      case 'library_list':
        return this.#list(args as Args<'library_list'>, principal);
      case 'library_show':
        return this.#show(args as Args<'library_show'>, principal);
      default:
        throw new ToolError('UNKNOWN_TOOL', `没有这个工具：${name}`);
    }
  }

  #list(args: Args<'library_list'>, principal: ToolPrincipal) {
    const { library, scope } = this.#deps;
    scope.authorize(principal, false);
    const { entries } = library.list({
      ...(args.library !== undefined ? { library: args.library } : {}),
      ...(args.kind !== undefined ? { kind: args.kind } : {}),
    });
    return { entries: entries.map(digestSummary), next: '条目的内容用 library_show（library 与 id）取。' };
  }

  #show(args: Args<'library_show'>, principal: ToolPrincipal) {
    const { library, scope } = this.#deps;
    scope.authorize(principal, false);
    let entry: LibraryEntry;
    try {
      ({ entry } = library.get({ library: args.library, id: args.id }));
    } catch (error) {
      if (error instanceof RpcError && error.code === 'not-found') {
        throw new ToolError('LIBRARY_ENTRY_NOT_FOUND', `${args.library} 里没有条目 ${args.id}：用 library_list 给出的 id`);
      }
      throw error;
    }
    return digestEntry(entry);
  }
}

function digestSummary(summary: LibraryEntrySummary) {
  return {
    library: summary.library,
    id: summary.id,
    name: summary.name,
    kind: summary.kind,
    version: summary.version,
    updatedAt: summary.updatedAt,
    ...(summary.termCount !== undefined ? { termCount: summary.termCount } : {}),
    ...(summary.defaultEnabled !== undefined ? { defaultEnabled: summary.defaultEnabled } : {}),
    ...(summary.consentDeclared !== undefined ? { consentDeclared: summary.consentDeclared } : {}),
    ...(summary.clones ? { clones: summary.clones } : {}),
  };
}

/** 文件只给事实（名字、类型、大小、摘要），不给存放位置。 */
function fileFacts(file: { fileName: string; mediaType: string; byteLength: number; sha256: string }) {
  return { fileName: file.fileName, mediaType: file.mediaType, byteLength: file.byteLength, sha256: file.sha256 };
}

function digestEntry(entry: LibraryEntry) {
  const head = { library: entry.library, id: entry.id, version: entry.version, updatedAt: entry.updatedAt };
  switch (entry.library) {
    case 'glossaries':
      return { ...head, ...(entry as LibraryEntry<'glossaries'>).content };
    case 'voices': {
      const { content, clones } = entry as LibraryEntry<'voices'>;
      return {
        ...head,
        name: content.name,
        kind: 'voice',
        language: content.language,
        origin: content.origin,
        transcript: content.transcript,
        reference: fileFacts(content.reference),
        consentDeclared: content.consent.declared,
        clones: Object.entries(clones ?? {}).map(([providerId, clone]) => ({ providerId, state: clone.state, createdAt: clone.createdAt })),
      };
    }
    case 'brand': {
      const content = (entry as LibraryEntry<'brand'>).content;
      if ('file' in content) return { ...head, name: content.name, kind: content.kind, file: fileFacts(content.file) };
      return { ...head, ...content };
    }
  }
}
