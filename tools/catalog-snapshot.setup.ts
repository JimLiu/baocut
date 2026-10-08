import { writeCatalogSnapshot } from './catalog-snapshot.ts';

/** vitest 的 globalSetup：测试前按当前的工具目录写 CLI 的离线快照（生成物，不进 git）。 */
export default function setup(): void {
  writeCatalogSnapshot();
}
