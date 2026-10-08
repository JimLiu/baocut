import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/** 内嵌的 PDF 字体、CMap、WASM 与 HTML 清理库的许可随桌面和 Web 构建一起交付。 */
export function pdfLicenses(root: string): Plugin {
  const files = [
    'pdfjs-dist/LICENSE', 'pdfjs-dist/cmaps/LICENSE',
    'pdfjs-dist/standard_fonts/LICENSE_FOXIT', 'pdfjs-dist/standard_fonts/LICENSE_LIBERATION',
    'pdfjs-dist/wasm/LICENSE_JBIG2', 'pdfjs-dist/wasm/LICENSE_OPENJPEG', 'pdfjs-dist/wasm/LICENSE_QCMS',
    'pdfjs-dist/wasm/LICENSE_PDFJS_JBIG2', 'pdfjs-dist/wasm/LICENSE_PDFJS_OPENJPEG', 'pdfjs-dist/wasm/LICENSE_PDFJS_QCMS',
    'dompurify/LICENSE', 'dompurify/LICENSE-MPL',
    'file-type/license', 'strtok3/LICENSE.txt', 'token-types/LICENSE.txt',
    '@tokenizer/inflate/LICENSE', '@borewit/text-codec/LICENSE.txt', 'uint8array-extras/license',
  ];
  return { name: 'baocut:pdf-licenses', apply: 'build', generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'assets/file-preview-licenses.txt',
      source: files.map(file => `${file}\n\n${readFileSync(resolve(root, 'node_modules', file), 'utf8')}`).join('\n\n') });
  } };
}
