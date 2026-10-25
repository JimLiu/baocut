import { describe, expect, it } from 'vitest';
import type { TrustedPrincipal } from '../gateway.ts';
import type { FontService } from './font-service.ts';
import { fontMethods } from './font-methods.ts';

describe('fontMethods', () => {
  it('fonts.resolve：浏览器与对外服务只解析、不下载；桌面与 CLI 照请求', async () => {
    const downloads: boolean[] = [];
    const service = {
      resolve: async (_faces: unknown, options: { download: boolean }) => {
        downloads.push(options.download);
        return { faces: [], missing: [] };
      },
    } as unknown as FontService;
    const methods = fontMethods(() => service, {} as never, () => ({}) as never);
    const params = { faces: [{ family: 'Lobster', weight: 400, italic: false }], download: true };
    for (const kind of ['web', 'service', 'desktop', 'cli'] as const) {
      const principal: TrustedPrincipal = { connectionId: `c_${kind}`, kind, name: kind };
      expect(await methods['fonts.resolve'](params, principal)).toEqual({ faces: [], missing: [] });
    }
    expect(downloads).toEqual([false, false, true, true]);
  });
});
