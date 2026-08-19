// BaoCut Subtitle Studio — 面板工具行里的样式选择器（原型 app/style-picker.jsx
// 的 Studio 版）。最高频的样式动作是"换一套预设"，不该为它打开整个 Style 面板：
// 触发器显示当前预设名，下拉列出预设并给当前项打勾，末项进入完整样式编辑。
//
// 与原型的差异（Studio 没有对应模型，不做占位）：
//   · 自定义样式库（保存/重命名/删除/MRU、"Your styles" 分组）—— Studio 的样式
//     是单份项目覆盖层（bcs:style），没有样式库；
//   · ctx 只影响"编辑样式…"的落点参数与控件标签，预设表两端共用一份
//     （Studio 的预设已经同时描述原文行与译文行）。
(() => {
const { useState, useRef } = React;
const { Ic, Menu, useApp, toast } = window;
const SP = window.BCS_STYLE_PRESETS;
if (!SP) throw new Error('style-presets.js failed to load');

const CONTROL_LABEL = { sub: '字幕样式', bi: '双语样式' };

function StylePicker({ ctx = 'sub', disabled }) {
  const app = useApp();
  const btnRef = useRef(null);
  const [open, setOpen] = useState(false);
  const style = app.doc.style;
  const label = SP.labelFor(style);
  const selected = SP.selectedId(style);
  const controlLabel = CONTROL_LABEL[ctx] || CONTROL_LABEL.sub;
  // 完整样式编辑 = 打开覆盖右侧 pane 的样式层（studio/style-layer.jsx）。
  const openStyle = () => app.openStyle(ctx);

  return (
    <>
      <button ref={btnRef} className="vk-stylebtn" disabled={disabled}
        data-tip={controlLabel} aria-label={controlLabel}
        aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen(true)}>
        <span className="vk-stylebtn__lab">{label}</span>
        <Ic name="chevron-down" size={12} />
      </button>
      {open ? (
        <Menu anchorRef={btnRef} onClose={() => setOpen(false)} width={232} items={[
          // 分组顺序与「预设」tab 的画廊同一份（style-presets.js groups()），
          // 免得同一批预设在两个入口里排得不一样。
          ...SP.groups().flatMap((group, index) => [
            ...(index ? ['-'] : []),
            ...group.presets.map((p) => ({
              label: p.name,
              suffix: selected === p.id ? '✓' : undefined,
              suffixAccent: true,
              onClick: () => {
                app.setStyle({ preset: p.id, ...p.style }, ctx);
                toast('已应用「' + p.name + '」', { variant: 'positive' });
              },
            })),
          ]),
          '-',
          { icon: 'color', label: '编辑样式…', onClick: openStyle },
        ]} />
      ) : null}
    </>
  );
}

Object.assign(window, { StylePicker });
})();
