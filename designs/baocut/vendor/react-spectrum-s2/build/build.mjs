/* Rebuild the vendored S2 bundle: `node build.mjs [--out <dir>]` (default: the folder above this one,
   i.e. next to the files the pages load). NODE_MODULES points at any install that has
   @react-spectrum/s2 1.7.1 + esbuild; see ../README.md. */
import {createRequire} from 'module';
import path from 'path';
import fs from 'fs';
import {fileURLToPath} from 'url';
import {fontOverride} from './font-override.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const NODE_MODULES = process.env.NODE_MODULES || path.resolve(HERE, '../../../node_modules');
const outArg = process.argv.indexOf('--out');
const OUT = path.resolve(outArg > -1 ? process.argv[outArg + 1] : path.join(HERE, '..'));
const require = createRequire(NODE_MODULES.replace(/\/?$/, '/'));
const esbuild = require('esbuild');
const locales = ['zh-CN','en-US'];
const localeRe = /[a-z]{2}-[A-Z]{2}/;
const srcRe = /[/\\](@react-stately|@react-aria|@react-spectrum|react-stately|react-aria|react-aria-components|@internationalized)[/\\]/;
const shim = {
  name: 'react-globals',
  setup(b) {
    b.onResolve({filter: /^(react|react-dom|react\/jsx-runtime|react\/jsx-dev-runtime|react-dom\/client)$/}, a => ({path: a.path, namespace: 'rg'}));
    b.onLoad({filter: /.*/, namespace: 'rg'}, a => {
      if (a.path === 'react') return {contents: 'module.exports = window.React;', loader: 'js'};
      if (a.path === 'react-dom' || a.path === 'react-dom/client') return {contents: 'module.exports = window.ReactDOM;', loader: 'js'};
      return {contents: `
        var R = window.React;
        function jsx(type, props, key) {
          var p = {}, children, has = false;
          for (var k in props) { if (k === 'children') { children = props[k]; has = true; } else p[k] = props[k]; }
          if (key !== undefined) p.key = '' + key;
          return has ? R.createElement(type, p, children) : R.createElement(type, p);
        }
        function jsxs(type, props, key) {
          var p = {}, children = [];
          for (var k in props) { if (k === 'children') children = props[k]; else p[k] = props[k]; }
          if (key !== undefined) p.key = '' + key;
          return R.createElement.apply(R, [type, p].concat(children));
        }
        exports.jsx = jsx; exports.jsxs = jsxs; exports.jsxDEV = jsx; exports.Fragment = R.Fragment;`, loader: 'js'};
    });
    // keep only zh-CN and en-US message catalogues
    b.onResolve({filter: localeRe}, a => {
      if (!srcRe.test(a.importer)) return;
      const m = a.path.match(localeRe);
      if (m && !locales.includes(m[0])) return {path: 'empty', namespace: 'empty'};
    });
    b.onLoad({filter: /.*/, namespace: 'empty'}, () => ({contents: 'module.exports = {};', loader: 'js'}));
    // no remote font loading: the canvas has no network; artboards set the type stack themselves
    b.onResolve({filter: /font-faces\.css$/}, () => ({path: 'empty.css', namespace: 'emptycss'}));
    b.onLoad({filter: /.*/, namespace: 'emptycss'}, () => ({contents: '', loader: 'css'}));
    // Tabs-guard: the overflow check can run before any tab has rendered
    b.onLoad({filter: /[/\\]s2[/\\]dist[/\\]private[/\\]Tabs\.mjs$/}, async a => {
      const fs = require('fs');
      let src = fs.readFileSync(a.path, 'utf8');
      const before = "let lastTabRect = lastTab.getBoundingClientRect();";
      if (!src.includes(before)) throw new Error('Tabs patch point not found');
      src = src.replace(before, "if (!lastTab) return;\n        " + before);
      return {contents: src, loader: 'js'};
    });
    b.onLoad({filter: /[/\\]s2[/\\]dist[/\\]private[/\\]Fonts\.mjs$/}, () => ({contents: 'export function Fonts() { return null; }', loader: 'js'}));
  }
};
const r = await esbuild.build({
  entryPoints: [path.join(HERE, 'entry.js')], bundle: true, format: 'iife', globalName: 'RSP', platform: 'browser',
  outfile: path.join(OUT, 'react-spectrum-s2.js'), nodePaths: [NODE_MODULES], minify: true, target: 'es2022', legalComments: 'none',
  define: {'process.env.NODE_ENV': '"production"'}, plugins: [shim], metafile: true, logLevel: 'warning',
  banner: {js: '/* @react-spectrum/s2 1.7.1 + @react-spectrum/ai 0.4.0 (Apache-2.0) bundled for canvas artboards; React comes from the page. */'},
});
console.log(Object.entries(r.metafile.outputs).map(([k,v]) => k + ' ' + v.bytes).join('\n'));
// the font override is keyed on S2's class hashes, so it is regenerated with every build
const fontCss = path.join(OUT, 'react-spectrum-s2-font.css');
fs.writeFileSync(fontCss, fontOverride(fs.readFileSync(path.join(OUT, 'react-spectrum-s2.css'), 'utf8')));
console.log(fontCss);
