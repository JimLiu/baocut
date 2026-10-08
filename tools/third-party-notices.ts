import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/** BaoCut 许可、源码声明与第三方原始许可的分发清单；桌面、Web 构建和安装包共用。 */
export const DISTRIBUTED_NOTICES = [
  { source: 'LICENSE', fileName: 'LICENSE' },
  { source: 'THIRD_PARTY_NOTICES.md', fileName: 'THIRD_PARTY_NOTICES.md' },
  { source: 'crates/model-runtime/licenses/speech-swift.txt', fileName: 'crates/model-runtime/licenses/speech-swift.txt' },
] as const;

/** 声明缺失时让构建失败，避免只分发可执行代码。 */
export function thirdPartyNotices(root: string): Plugin {
  return {
    name: 'baocut:third-party-notices',
    apply: 'build',
    generateBundle() {
      for (const { source, fileName } of DISTRIBUTED_NOTICES) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(resolve(root, source)) });
      }
    },
  };
}
