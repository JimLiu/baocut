// i18n-ignore-file: 给模型的工具说明、错误与下一步
import path from 'node:path';
import { z } from 'zod';
import { BUILTIN_HOSTS, RpcError, builtinHost, hostStickerId, hostThumbnailPath, type BuiltinHost } from '@baocut/protocol';
import type { StickerPacks } from '../templates/sticker-packs.ts';
import { ToolError, type ToolInfo, type ToolSet } from './tool-catalog.ts';
import type { ToolPrincipal, ToolScope } from './tool-scope.ts';

/**
 * 内置主播（Agent 面设计 §4.3）：BaoCut 自带的原创卡通角色包，做虚拟主播时先从这里挑，用户要自己的形象才生成。
 * `hosts_list` 列出角色（外貌、画风、缩略图）；`hosts_show` 把一个角色包备好在本机（打包的应用第一次用时从素材 CDN 取，
 * 按清单核对），给出绝对路径与现成的 `importAsset`，之后照常 `edits_apply`。都不改视频。目录在 `@baocut/protocol` 的
 * `BUILTIN_HOSTS`，文件随贴纸放在 `stickers/hosts/`。
 */

export interface HostToolsDeps {
  stickers: Pick<StickerPacks, 'locate' | 'bundledFile'>;
  scope: ToolScope;
}

const schemas = {
  hosts_list: z.strictObject({
    style: z.enum(['anime', 'chibi']).optional().describe('可选。只列一种画风：anime（半身动漫）或 chibi（Q 版）'),
  }),
  hosts_show: z.strictObject({
    id: z.string().min(1).max(40).describe('角色 id：hosts_list 给出，如 rin'),
  }),
};

type ToolName = keyof typeof schemas;
type Args<N extends ToolName> = z.infer<(typeof schemas)[N]>;

const DEFINITIONS: Record<ToolName, ToolInfo> = {
  hosts_list: {
    title: '列出内置主播',
    description: [
      '列出 BaoCut 自带的虚拟主播角色（原创卡通角色包，会眨眼、对口型、做表情）。',
      '每个角色：id、名字（英文与中文）、画风（anime 半身动漫 / chibi Q 版）、性别（female / male / androgynous 中性）、看上去的年龄（child Q 版孩子气 / teen 十几岁 / twenties 二十多岁 / thirties 三十多岁）、外貌（发型、眼睛、衣服）与缩略图的本机路径（静止姿势的透明 WebP，可以直接看）。',
      '用户要虚拟主播又没有自己的角色时从这里挑两三个推荐：气质、适合的片子与配音建议在内置 skill virtual-host 的主播表（references/hosts.md）。用户要自己的形象或指定的长相时才生成新角色。用 hosts_show 取角色包。只读。',
    ].join('\n'),
    annotations: { readOnlyHint: true },
    effect: 'query',
    examples: [
      { title: '列出全部角色', args: {} },
      { title: '只看 Q 版', args: { style: 'chibi' } },
    ],
    surfaces: ['agent', 'cli'],
  },
  hosts_show: {
    title: '取内置主播的角色包',
    description: [
      '把一个内置主播的角色包（.bcpuppet）备好在本机，给出它的绝对路径与一条现成的 importAsset。',
      '打包的应用第一次用某个角色时从 BaoCut 素材 CDN 下载（几 MB，按清单核对大小与 sha256），之后用本机缓存。',
      '放进视频：把 importAsset 放进 edits_apply，与动作轨一起导入，再用 insertItems 放一个 {"type":"sticker","sticker":{"source":"asset"}}（见 edits_ops）。不改视频。',
    ].join('\n'),
    annotations: { readOnlyHint: true },
    effect: 'query',
    examples: [{ title: '取 Rin 的角色包', args: { id: 'rin' } }],
    surfaces: ['agent', 'cli'],
    positional: 'id',
  },
};

export class HostTools implements ToolSet {
  readonly schemas = schemas;
  readonly definitions = DEFINITIONS;
  readonly #deps: HostToolsDeps;

  constructor(deps: HostToolsDeps) {
    this.#deps = deps;
  }

  async dispatch(name: string, args: unknown, principal: ToolPrincipal): Promise<unknown> {
    switch (name as ToolName) {
      case 'hosts_list':
        return this.#list(args as Args<'hosts_list'>, principal);
      case 'hosts_show':
        return this.#show(args as Args<'hosts_show'>, principal);
      default:
        throw new ToolError('UNKNOWN_TOOL', `没有这个工具：${name}`);
    }
  }

  #list(args: Args<'hosts_list'>, principal: ToolPrincipal) {
    const { stickers, scope } = this.#deps;
    scope.authorize(principal, false);
    const hosts = BUILTIN_HOSTS.filter((host) => !args.style || host.style === args.style).map((host) => ({
      ...digest(host),
      thumbnail: stickers.bundledFile(hostThumbnailPath(host)),
    }));
    return { hosts, next: '挑好角色后用 hosts_show（id）取角色包与 importAsset。' };
  }

  async #show(args: Args<'hosts_show'>, principal: ToolPrincipal) {
    const { stickers, scope } = this.#deps;
    scope.authorize(principal, false);
    const host = builtinHost(args.id);
    if (!host) {
      throw new ToolError('HOST_NOT_FOUND', `没有内置主播 ${args.id}：内置主播的 id 是 ${BUILTIN_HOSTS.map((h) => h.id).join('、')}`);
    }
    let located: Awaited<ReturnType<StickerPacks['locate']>>;
    try {
      located = await stickers.locate(hostStickerId(host));
    } catch (error) {
      if (error instanceof RpcError) {
        throw new ToolError('HOST_UNAVAILABLE', `取不到 ${host.name} 的角色包：${error.message}。检查网络后再试，或换一个内置主播`);
      }
      throw error;
    }
    const file = path.join(located.root, located.file);
    return {
      ...digest(host),
      path: file,
      importAsset: { type: 'importAsset', path: file, name: host.name, ref: 'host', storage: 'managed' },
      next: '把 importAsset 放进 edits_apply（storage managed：角色包复制进视频），同一笔里导入动作轨（motionImportRef）并用 insertItems 放角色贴纸。',
    };
  }
}

function digest(host: BuiltinHost) {
  return { id: host.id, name: host.name, zh: host.zh, style: host.style, gender: host.gender, age: host.age, look: host.look };
}
