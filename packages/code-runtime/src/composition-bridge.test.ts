// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CompositionBridgePick } from '@baocut/protocol';
import { COMPOSITION_PICK_SCRIPT, compositionPageScript } from './composition-bridge.ts';

/** 「选择元素」的拾取脚本（lite-editor §4.1、§11 第 12 条）：在 happy-dom 里装上，按节点核对说明。happy-dom 不排版，框不看。 */

type PickWindow = Window & {
  __baocutPick?: (x: number, y: number) => CompositionBridgePick | null;
  __baocutDescribe?: (node: Element | null) => CompositionBridgePick | null;
};
const win = () => window as unknown as PickWindow;

beforeAll(() => {
  new Function(COMPOSITION_PICK_SCRIPT)();
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const html = (markup: string): Element => {
  const holder = document.createElement('div');
  holder.innerHTML = markup;
  document.body.append(holder);
  return holder.firstElementChild!;
};
const describeNode = (node: Element | null) => win().__baocutDescribe!(node);

describe('拾取脚本', () => {
  it('装上 __baocutPick 与 __baocutDescribe；再装一次不覆盖', () => {
    const first = win().__baocutPick;
    expect(typeof first).toBe('function');
    expect(typeof win().__baocutDescribe).toBe('function');
    new Function(COMPOSITION_PICK_SCRIPT)();
    expect(win().__baocutPick).toBe(first);
  });

  it('选择器是 tag#id.class.class：小写 tag，至多两个 class', () => {
    expect(describeNode(html('<DIV id="box" class="a b c"></DIV>'))?.selector).toBe('div#box.a.b');
    expect(describeNode(html('<span class="only"></span>'))?.selector).toBe('span.only');
    expect(describeNode(html('<p></p>'))?.selector).toBe('p');
  });

  it('角色：显式的 role 优先，否则按标签的隐式角色；没有就省略', () => {
    expect(describeNode(html('<div role="tab list"></div>'))?.role).toBe('tab');
    expect(describeNode(html('<button>Play</button>'))?.role).toBe('button');
    expect(describeNode(html('<a href="#x">Go</a>'))?.role).toBe('link');
    expect(describeNode(html('<a>Anchor</a>'))?.role).toBeUndefined();
    expect(describeNode(html('<img alt="Logo">'))?.role).toBe('img');
    expect(describeNode(html('<h2>Title</h2>'))?.role).toBe('heading');
    expect(describeNode(html('<input>'))?.role).toBe('textbox');
    expect(describeNode(html('<input type="checkbox">'))?.role).toBe('checkbox');
    expect(describeNode(html('<ul><li>x</li></ul>'))?.role).toBe('list');
    expect(describeNode(html('<video></video>'))?.role).toBe('video');
    const plain = describeNode(html('<div>text</div>'));
    expect(plain && 'role' in plain).toBe(false);
  });

  it('名称：aria-label → alt → title → 去空白的文字，至多 80 字', () => {
    expect(describeNode(html('<button aria-label="Play" title="t">x</button>'))?.name).toBe('Play');
    expect(describeNode(html('<img alt="Logo" title="t">'))?.name).toBe('Logo');
    expect(describeNode(html('<div title="Tip">x</div>'))?.name).toBe('Tip');
    expect(describeNode(html('<p>  Hello \n  <b>world</b>  </p>'))?.name).toBe('Hello world');
    const long = describeNode(html(`<p>${'word '.repeat(40)}</p>`))!;
    expect(long.name!.length).toBe(80);
    expect(long.name!.endsWith('…')).toBe(true);
    const empty = describeNode(html('<div></div>'));
    expect(empty && 'name' in empty).toBe(false);
  });

  it('键盘可聚焦：tabIndex >= 0 且没禁用', () => {
    expect(describeNode(html('<button>x</button>'))?.focusable).toBe(true);
    expect(describeNode(html('<button disabled>x</button>'))?.focusable).toBe(false);
    expect(describeNode(html('<div>x</div>'))?.focusable).toBe(false);
    expect(describeNode(html('<div tabindex="0">x</div>'))?.focusable).toBe(true);
    expect(describeNode(html('<a href="#x">x</a>'))?.focusable).toBe(true);
  });

  it('框四舍五入，w、h 与框相同', () => {
    const node = html('<div id="box"></div>');
    vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({ left: 10.4, top: 20.6, width: 99.5, height: 50.2 } as DOMRect);
    expect(describeNode(node)).toEqual({ selector: 'div#box', w: 100, h: 50, focusable: false, rect: { x: 10, y: 21, w: 100, h: 50 } });
  });

  it('按点拾：取 elementFromPoint 的那个节点；html、body、没有节点与非有限坐标是 null', () => {
    const node = html('<button id="play">Play</button>');
    const at = vi.spyOn(document, 'elementFromPoint').mockReturnValue(node);
    expect(win().__baocutPick!(12, 34)).toMatchObject({ selector: 'button#play', role: 'button', name: 'Play', focusable: true });
    expect(at).toHaveBeenCalledWith(12, 34);
    at.mockReturnValue(document.body);
    expect(win().__baocutPick!(1, 1)).toBeNull();
    at.mockReturnValue(document.documentElement);
    expect(win().__baocutPick!(1, 1)).toBeNull();
    at.mockReturnValue(null);
    expect(win().__baocutPick!(1, 1)).toBeNull();
    expect(win().__baocutPick!(Number.NaN, 1)).toBeNull();
  });

  it('整段注入脚本里有拾取，且不含 </script>', () => {
    const page = compositionPageScript();
    expect(page).toContain('__baocutPick');
    expect(page.slice('<script>'.length, -'</script>'.length)).not.toContain('</script>');
  });
});
