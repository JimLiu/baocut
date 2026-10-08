import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';
import sirv from 'sirv';
import {build, watchBuild} from './build/build.mjs';
const root = fileURLToPath(new URL('.', import.meta.url));

function prototypePlugin() {
  let stopWatching = () => {};
  return {
    name: 'baocut-prototype',
    async configureServer(server) {
      await build();
      // These precompiled IIFEs run as classic scripts; Vite's import rewriting
      // would inject ESM syntax and change their global loading contract.
      const serveBundles = sirv(root, {dev: true, extensions: [], setHeaders(res) {
        res.setHeader('Content-Type', 'text/javascript');
        res.setHeader('Cache-Control', 'no-cache');
      }});
      // Keep bookmarked prototype URLs and their relative assets working.
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/baocut/')) req.url = req.url.slice('/baocut'.length);
        if (/^\/(generated\/[^/]+\.js|vendor\/react-spectrum-s2\/react-spectrum-s2\.js)(?:\?|$)/.test(req.url ?? '')) {
          return serveBundles(req, res, next);
        }
        next();
      });
      stopWatching = watchBuild(
        () => server.ws.send({type: 'full-reload', path: '*'}),
        error => {
          server.config.logger.error(error.stack ?? String(error));
          server.ws.send({type: 'error', err: {message: error.message, stack: error.stack, plugin: 'baocut-prototype'}});
        },
      );
      server.httpServer?.once('close', stopWatching);
    },
    // Also clean up if listening fails (for example, an occupied port).
    closeBundle() { stopWatching(); },
  };
}

export default defineConfig({
  root,
  appType: 'mpa',
  publicDir: false,
  optimizeDeps: {noDiscovery: true, include: []},
  server: {
    host: '127.0.0.1',
    port: 4331,
    strictPort: true,
    watch: {ignored: ['**/generated/**', '**/*.html', '**/app/model-help.js', '**/app/model-home-templates-data.js']},
  },
  plugins: [prototypePlugin()],
});
