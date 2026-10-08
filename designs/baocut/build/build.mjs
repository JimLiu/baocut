/* Reproducible static prototypes: npm ci && npm run build (from designs/baocut). */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {transform, build as bundle} from 'esbuild';
import {helpModule} from './help-content.mjs';
import {HOME_TEMPLATES_DATA, homeTemplatesModule} from './home-templates.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const check = process.argv.includes('--check');
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 12);
function emit(file, text) {
  const target = path.join(root, file);
  if (check) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) throw new Error(`Stale build: ${file}. Run npm run build.`);
  } else if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) {
    // 内容没变就不写：watch 监听 app/，生成进 app/ 的数据模块每次都写会自己触发下一轮。
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, text);
  }
  return `${file}?v=${hash(text)}`;
}
export async function build() {
  // 先于入口：Home 模板库的数据从仓库顶层 templates/ 生成，入口随后把它当普通源文件读进来。
  emit('app/model-help.js', helpModule(path.resolve(root, '../..')));
  emit(HOME_TEMPLATES_DATA, homeTemplatesModule(path.resolve(root, '../../templates')));
  const runtimeResult = await bundle({
    stdin: {contents: "import * as React from 'react'; import * as ReactDOM from 'react-dom'; import {createRoot} from 'react-dom/client'; window.React = React; window.ReactDOM = {...ReactDOM, createRoot};", resolveDir:root},
    bundle:true, write:false, format:'iife', minify:true, target:'es2022',
    define:{'process.env.NODE_ENV':'"production"'}, legalComments:'inline'
  });
  const runtime = runtimeResult.outputFiles[0].text;
  const licenses = [
    ['React', 'react/LICENSE'], ['React DOM', 'react-dom/LICENSE'], ['Scheduler', 'scheduler/LICENSE'],
    ['Lottie Web', 'lottie-web/LICENSE.md'], ['JSZip', 'jszip/LICENSE.markdown'],
    ['markdown-it', 'markdown-it/LICENSE'], ['linkify-it', 'linkify-it/LICENSE'], ['mdurl', 'mdurl/LICENSE'],
    ['uc.micro', 'uc.micro/LICENSE.txt'], ['entities', 'entities/LICENSE'], ['punycode.js', 'punycode.js/LICENSE-MIT.txt']
  ].map(([name, file]) => name + '\n' + read('node_modules/' + file)).join('\n\n');
  emit('generated/licenses.txt', licenses.trimEnd() + '\n');
  const runtimeURL = emit('generated/react.js', runtime);
  const media = ['lottie-web/build/player/lottie.min.js', 'jszip/dist/jszip.min.js']
    .map(file => read('node_modules/' + file)).join('\n;\n');
  const mediaURL = emit('generated/media.js', media);
  /* npm 包按入口打进编译后的 JS（不另开 <script>）：入口模板里写 <script data-npm="名字"></script>，
     只有声明了它的入口带上这份 IIFE。markdown-it 只给 App 的 Agent 消息流用，Web 入口不声明。 */
  const NPM = {
    'markdown-it': "import markdownit from 'markdown-it'; window.BC_MARKDOWN_IT = markdownit;",
  };
  const npmCode = {};
  for (const [name, contents] of Object.entries(NPM)) {
    const out = await bundle({stdin: {contents, resolveDir: root}, bundle: true, write: false, format: 'iife', minify: true,
      target: 'es2022', legalComments: 'inline'});
    npmCode[name] = out.outputFiles[0].text;
  }
  const spectrumURL = 'vendor/react-spectrum-s2/react-spectrum-s2.js?v=' + hash(read('vendor/react-spectrum-s2/react-spectrum-s2.js'));
  const manifest = {};
  for (const [key, file] of [['app', 'BaoCut.html'], ['web', 'BaoCutWeb.html'], ['components', 'Components.html']]) {
    let html = read(`build/entries/${key}.html`);
    const sources = [], styles = [], fonts = [];
    const scripts = [], vendor = [];
    html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/g, (_, attrs, body) => {
      const src = attrs.match(/src="([^"]+)"/)?.[1]?.split('?')[0];
      const npm = attrs.match(/data-npm="([^"]+)"/)?.[1];
      if (npm) { if (!npmCode[npm]) throw new Error(`Unknown data-npm module: ${npm}`); vendor.push(npmCode[npm]); }
      else if (src?.startsWith('app/')) { sources.push(src); scripts.push(read(src)); }
      else if (!src) scripts.push(body);
      return '';
    });
    html = html.replace(/<link\b[^>]*>/g, tag => {
      const href = tag.match(/href="([^"]+)"/)?.[1];
      if (!tag.includes('rel="stylesheet"')) return '';
      if (href.startsWith('https:')) fonts.push(href);
      else styles.push(href.split('?')[0]);
      return '';
    });
    const js = await transform(scripts.join('\n;\n'), {loader:'jsx', target:'es2022', minify:true, legalComments:'inline'});
    const jsURL = emit(`generated/${key}.js`, vendor.concat([js.code]).join('\n;\n'));
    // Rebase local CSS assets relative to generated/, retaining original stylesheet order and layers.
    // Each asset carries a hash of its content, so a redrawn icon is not served from the browser cache.
    const css = styles.map(file => read(file).replace(/url\((['"]?)([^)'"\s]+)\1\)/g, (all, quote, url) => {
      if (/^(data:|https?:|\/|#)/.test(url)) return all;
      const [, plain, rest = ''] = url.match(/^([^?#]*)(.*)$/);
      const asset = path.posix.join(path.posix.dirname(file), plain);
      const version = !rest.startsWith('?') && fs.existsSync(path.join(root, asset)) ? `?v=${hash(fs.readFileSync(path.join(root, asset)))}` : '';
      return `url(${quote}../${asset}${version}${rest}${quote})`;
    })).join('\n');
    const cssURL = emit(`generated/${key}.css`, (await transform(css, {loader:'css', minify:true, legalComments:'inline'})).code);
    // Optional measurement stays DOM-readable, with no logging or persistent telemetry.
    html = html.replace('</head>', `<script>${read('build/measure.js')}</script>\n<link rel="stylesheet" href="${cssURL}">\n</head>`);
    const fontLoader = `(() => {
      const fonts = ${JSON.stringify(fonts)};
      const load = href => { const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = href; document.head.append(link); };
      let uiLoaded = false, videoLoaded = false;
      const observer = new MutationObserver(() => {
        if (!uiLoaded && document.getElementById('root')?.firstElementChild) {
          uiLoaded = true; requestAnimationFrame(() => requestAnimationFrame(() => fonts.slice(0,1).forEach(load)));
        }
        if (!videoLoaded && document.querySelector('.editcol')) { videoLoaded = true; fonts.slice(1).forEach(load); }
        if (uiLoaded && (videoLoaded || fonts.length < 2)) observer.disconnect();
      });
      observer.observe(document.getElementById('root'), {childList:true, subtree:true});
    })();`;
    html = html.replace('</body>', `<script>${fontLoader}</script>\n<script defer src="${runtimeURL}"></script>\n${key === 'components' ? '' : `<script defer src="${mediaURL}"></script>\n`}<script defer src="${spectrumURL}"></script>\n<script defer src="${jsURL}"></script>\n</body>`);
    html = '<!-- Generated by build/build.mjs; edit build/entries/' + key + '.html and app/ sources. -->\n' + html.replace(/<!--(?! Generated)[\s\S]*?-->/g, '').replace(/\n\s*\n/g,'\n');
    emit(file, html);
    if (key === 'app') emit('index.html', html.replace('</head>', '<script>if (!location.hash) history.replaceState(null, "", location.pathname + location.search + "#/home");</script>\n</head>'));
    manifest[key] = {file, sources, styles, js:jsURL, css:cssURL, bytes:Buffer.byteLength(js.code)};
    console.log(`${key}: ${sources.length} source modules → ${Math.round(Buffer.byteLength(js.code)/1024)} KiB compiled JavaScript`);
  }
  emit('generated/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
}
export function watchBuild(onBuilt = () => {}, onError = console.error) {
  let timer, running = false, pending = false, closed = false;
  const watchers = [];
  async function rebuild() {
    if (closed) return;
    if (running) { pending = true; return; }
    running = true;
    try { await build(); if (!closed) onBuilt(); } catch (e) { if (!closed) onError(e); }
    finally { running = false; if (pending) { pending = false; void rebuild(); } }
  }
  function schedule(_event, filename) {
    if (closed || ['model-help.js', 'model-home-templates-data.js'].includes(String(filename))) return;
    clearTimeout(timer); timer = setTimeout(rebuild, 100);
  }
  for (const dir of ['app', 'build', 'assets', '../../templates']) watchers.push(fs.watch(path.join(root, dir), {recursive:true}, schedule));
  for (const file of ['../../packages/ui/src/model/help-guides.ts', '../../packages/ui/src/model/help-guides.zh-Hans.ts', 'vendor/react-spectrum-s2/react-spectrum-s2.js']) {
    watchers.push(fs.watch(path.join(root, file), schedule));
  }
  return () => { closed = true; clearTimeout(timer); watchers.forEach(watcher => watcher.close()); };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await build();
  if (process.argv.includes('--watch')) {
    watchBuild();
    console.log('Watching prototype sources, assets, templates and shared help content; refresh the browser after a rebuild.');
  }
}
