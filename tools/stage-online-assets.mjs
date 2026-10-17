// 把不随包的线上素材按 CDN 上的路径排进一个目录，供上传（packages/runtime-core/src/online-assets.ts）。
//
//   npm run stage:online-assets -- <输出目录>
//
// 目前只有动态贴纸。Codex Pets 不经 CDN：社区 pet 不转存，Runtime 从上游取。
// 目录里的相对路径就是 CDN 上的路径（`<基址>/<路径>`），整个目录原样传到桶的根。每个文件先按随包清单核对大小与 sha256，
// 对不上就停下：Runtime 只认清单里的字节。`manifest.json` 列出这次排进去的文件，便于核对上传结果。
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const out = args.find((arg) => !arg.startsWith('--'));
if (!out) {
  console.error('用法：stage-online-assets.mjs <输出目录>');
  process.exit(1);
}

const staged = [];
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

/** 按清单核对后拷到 `<输出目录>/<cdnPath>`。 */
function stage(source, cdnPath, expected) {
  const bytes = readFileSync(source);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== expected.bytes || sha256 !== expected.sha256) fail(`与清单不符：${path.relative(ROOT, source)}`);
  const target = path.join(out, ...cdnPath.split('/'));
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(source, target);
  staged.push({ path: cdnPath, bytes: bytes.length, sha256 });
}

// 动态贴纸：清单是 `stickers/anim/provenance.json`。
const animDir = path.join(ROOT, 'stickers', 'anim');
const animManifest = JSON.parse(readFileSync(path.join(animDir, 'provenance.json'), 'utf8'));
for (const name of readdirSync(animDir)
  .filter((name) => name.endsWith('.json') && name !== 'provenance.json')
  .sort()) {
  const entry = animManifest[name];
  if (!entry) fail(`清单里没有：stickers/anim/${name}`);
  stage(path.join(animDir, name), `stickers/anim/${name}`, entry);
}

writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify({ files: staged }, null, 2)}\n`);
const total = staged.reduce((sum, file) => sum + file.bytes, 0);
console.log(`排好 ${staged.length} 个文件（${(total / 1024 / 1024).toFixed(1)} MiB）：${path.resolve(out)}`);
console.log('把这个目录原样传到素材 CDN 的根（文件不改：内容变了换路径）。');
