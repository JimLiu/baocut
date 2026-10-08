import path from 'node:path';
import { RpcError } from '@baocut/protocol';
import type { TrustedPrincipal } from '../gateway.ts';
import type { RpcHandlers } from '../handlers.ts';
import type { MediaRegistry } from '../media.ts';
import type { ExportService } from '../exports/export-service.ts';
import type { FontService } from './font-service.ts';
import { RcFonts } from '@baocut/protocol/messages/runtime-core';

type FontMethod =
  | 'fonts.resolve'
  | 'fonts.catalogue'
  | 'fonts.download'
  | 'fonts.downloaded'
  | 'fonts.remove'
  | 'fonts.clear'
  | 'fonts.sample'
  | 'fonts.usage';

/**
 * `fonts.*` 的处理函数（架构设计 §9.1），由 `handlers.ts` 并进方法表。下载与删除改的是这台机器的字体缓存，只给界面与 CLI：
 * Web 服务的白名单里没有 `fonts.*`，这里对浏览器与对外服务再挡一次（`fonts.resolve` 对它们只解析、不下载）。
 */
export function fontMethods(
  fonts: () => FontService,
  media: MediaRegistry,
  exports: () => Pick<ExportService, 'fontCensus'>,
): Pick<RpcHandlers['methods'], FontMethod> {
  const own = (principal: TrustedPrincipal) => principal.kind !== 'service' && principal.kind !== 'web';
  const ownOnly = (principal: TrustedPrincipal) => {
    if (!own(principal)) throw new RpcError('forbidden', RcFonts.manageOnlyInAppOrCli());
  };
  return {
    // 引擎挑好 face，这里给它所在的文件发读取句柄（限定到那一个文件，界面按区间取表）；下载缓存里的文件同样。
    'fonts.resolve': async (p, principal) => {
      const { faces, missing } = await fonts().resolve(p.faces, {
        download: (p.download ?? false) && own(principal),
        submitter: { kind: 'connection', id: principal.connectionId },
      });
      return {
        faces: await Promise.all(
          faces.map(async ({ path: file, ...face }) => ({ ...face, file: await media.issue(path.dirname(file), path.basename(file)) })),
        ),
        missing,
      };
    },
    'fonts.catalogue': (p) => fonts().catalogueList(p),
    'fonts.download': (p, principal) => {
      ownOnly(principal);
      return fonts().download(p, { kind: 'connection', id: principal.connectionId });
    },
    'fonts.downloaded': () => fonts().downloaded(),
    'fonts.remove': (p, principal) => {
      ownOnly(principal);
      return fonts().remove(p);
    },
    'fonts.clear': (_p, principal) => {
      ownOnly(principal);
      return fonts().clear();
    },
    // 样张会联网：同下载一样只给界面与 CLI。
    'fonts.sample': (p, principal) => {
      ownOnly(principal);
      return fonts().sample(p);
    },
    // 清点在 Render Worker 里排字（与导出同一份冻结）；状态与下载在字体服务。
    'fonts.usage': async (p, principal) => {
      ownOnly(principal);
      const census = await exports().fontCensus({
        videoId: p.videoId,
        ...(p.sequenceId ? { sequenceId: p.sequenceId } : {}),
        ...(p.burnCaptions !== undefined ? { burnCaptions: p.burnCaptions } : {}),
      });
      return fonts().usage(census, { download: p.download ?? false, submitter: { kind: 'connection', id: principal.connectionId } });
    },
  };
}
