// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CompositionBridgePick } from '@baocut/protocol';
import { COMPOSITION_PICK_SCRIPT, compositionPageScript } from './composition-bridge.ts';

/** 「选择元素」的拾取脚本（lite-editor §4.1、§11 第 12 条）：在 happy-dom 里装上，按节点核对说明。happy-dom 不排版，框不看。 */

type PickWindow = Window & {
  __baocutPickRegions?: unknown;
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
  delete win().__baocutPickRegions;
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

  it('页面登记了拾取区域（代码包规范 §4.5）：点落在区域里取最上面那个（后登记的），写成 region#id；落在外面照旧拾节点', () => {
    const canvas = html('<canvas id="overlay"></canvas>');
    const at = vi.spyOn(document, 'elementFromPoint').mockReturnValue(canvas);
    win().__baocutPickRegions = [
      { x: 100, y: 300, w: 600, h: 260, name: 'Title block', id: 'title' },
      { x: 104.4, y: 290.6, w: 560.5, h: 130.2, name: '  Upside   down ', role: 'heading' },
    ];
    expect(win().__baocutPick!(200, 350)).toEqual({
      selector: 'region',
      w: 561,
      h: 130,
      name: 'Upside down',
      role: 'heading',
      focusable: false,
      rect: { x: 104, y: 291, w: 561, h: 130 },
    });
    expect(win().__baocutPick!(200, 500)).toMatchObject({ selector: 'region#title', name: 'Title block' });
    expect(at).not.toHaveBeenCalled();
    expect(win().__baocutPick!(900, 900)).toMatchObject({ selector: 'canvas#overlay' });
    expect(at).toHaveBeenCalledWith(900, 900);
  });

  it('不合形的区域跳过：非有限数、没有面积、不是对象；id 不合规就当没有，name 截到 80 字；不是数组时不看', () => {
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(null);
    win().__baocutPickRegions = [
      { x: 0, y: 0, w: 100, h: 100, id: 'bad id!', name: 'x'.repeat(200) },
      null,
      'region',
      { x: Number.NaN, y: 0, w: 100, h: 100 },
      { x: 0, y: 0, w: 0, h: 100 },
    ];
    const pick = win().__baocutPick!(10, 10)!;
    expect(pick.selector).toBe('region');
    expect(pick.name).toHaveLength(80);
    expect(pick.name!.endsWith('\u2026')).toBe(true);
    win().__baocutPickRegions = { x: 0, y: 0, w: 100, h: 100 };
    expect(win().__baocutPick!(10, 10)).toBeNull();
  });

  it('一帧只看最后 500 项', () => {
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(null);
    const filler = Array.from({ length: 500 }, (_, i) => ({ x: 1000 + i, y: 1000, w: 1, h: 1 }));
    win().__baocutPickRegions = [{ x: 0, y: 0, w: 10, h: 10, id: 'old' }, ...filler];
    expect(win().__baocutPick!(5, 5)).toBeNull();
    win().__baocutPickRegions = [{ x: 0, y: 0, w: 10, h: 10, id: 'old' }, ...filler.slice(1)];
    expect(win().__baocutPick!(5, 5)).toMatchObject({ selector: 'region#old' });
  });

  it('整段注入脚本里有拾取，且不含 </script>', () => {
    const page = compositionPageScript();
    expect(page).toContain('__baocutPick');
    expect(page.slice('<script>'.length, -'</script>'.length)).not.toContain('</script>');
  });
});
