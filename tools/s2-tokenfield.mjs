/** React Aria 3.52.1 counts DOM children as segments, but native IME may split a text segment.
 * Keep its token/zero-width-space handling, then project its DOM position onto coalesced text.
 * Shared by Electron/Web and the prototype bundle; fail closed if the pinned patch point changes.
 */
export function patchTokenFieldSelection(source) {
  const signature = /function ([$\w]+\$var\$getPosition)\(container, node, offset, isRangeEnd = false\) \{/g;
  const matches = [...source.matchAll(signature)];
  if (source.includes('const position = ' + matches[0]?.[1] + 'DOM(') || matches.length !== 1 || !source.includes('index: offset,') || !source.includes('let originalNode = node;')) {
    throw new Error('React Aria token-field selection patch point changed; review the IME workaround');
  }
  const name = matches[0][1];
  const wrapper = `function ${name}(container, node, offset, isRangeEnd = false) {
    const position = ${name}DOM(container, node, offset, isRangeEnd);
    let index = 0;
    let textLength = 0;
    let inText = false;
    for (let i = 0; i < container.childNodes.length; i++) {
        const child = container.childNodes[i];
        // The trailing BR is only a caret placeholder, not a model segment.
        if (child.nodeName === 'BR') {
            if (i === position.index) return {index, offset: inText ? textLength : 0};
            continue;
        }
        if (child.nodeType === Node.TEXT_NODE) {
            if (i === position.index) return {index, offset: textLength + position.offset};
            textLength += child.textContent.length;
            inText = true;
        } else {
            if (inText) { index++; textLength = 0; inText = false; }
            if (i === position.index) return {index, offset: position.offset};
            index++;
        }
    }
    return {index, offset: inText ? textLength : 0};
}
function ${name}DOM(container, node, offset, isRangeEnd = false) {`;
  return source.replace(matches[0][0], wrapper);
}

const TOKEN_FIELD = /[/\\]react-aria[/\\]dist[/\\]private[/\\]tokenfield[/\\]useTokenField\.(?:mjs|js)$/;

/** Vite production transforms and dependency prebundling must apply the identical patch. */
export function tokenFieldSelectionPlugin() {
  return {
    name: 'baocut:token-field-selection',
    enforce: 'pre',
    transform(source, id) {
      if (TOKEN_FIELD.test(id.split('?')[0])) return {code: patchTokenFieldSelection(source), map: null};
    },
    config() {
      return {optimizeDeps: {esbuildOptions: {plugins: [{
        name: 'baocut:token-field-selection',
        setup(build) {
          build.onLoad({filter: TOKEN_FIELD}, async ({path}) => {
            const {readFile} = await import('node:fs/promises');
            return {contents: patchTokenFieldSelection(await readFile(path, 'utf8')), loader: 'js'};
          });
        },
      }]}}};
    },
  };
}
