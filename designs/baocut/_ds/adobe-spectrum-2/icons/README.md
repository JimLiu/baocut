# Spectrum 2 workflow 图标（原件）

58 枚，原样取自用户提供的 Spectrum 2 Design System 包 `assets/icons/`，一个数没改
（连 `fill="var(--iconPrimary, #222)"` 都保留，方便与上游逐字节对账）。

这里是**取值来源**，不是运行时资产：原型把用到的路径内联进
[`../../../app/icons.jsx`](../../../app/icons.jsx)（`.ic` 靠 `currentColor` 着色，
所以内联时把 `fill` 去掉了）。加图标时先翻这一目录，有就整条复制过去。

同一批原件在仓库里还有一份出货副本，可交叉核对：`apps/baocut/assets/icons/`
（小写连字符命名）。（第二份此前在 `skills/baocut/templates/studio/_ds/assets/icons/`，
随 Subtitle Studio 页面退役于 2026-09-02 删除。）
（第三份此前在 `apps/mac/Sources/VoiceInk/Resources/icons/`，随 Swift Mac 客户端
退役于 2026-09-02 移到 `apps/baocut/assets/icons/`。）

## 当前界面的使用规则

原型优先使用 `window.RSP.Icons`，Electron 使用 `@react-spectrum/s2/icons/*`；此目录保留原始几何作为参考。尺寸遵循[产品设计 §2.1](../../../../../docs/product/product-design.md#图标尺寸与语义)：Rail 与页面主要操作 20px，页面侧栏与紧凑内容 16px，指 SVG 画布而非可见路径范围。新建会话统一 AddCircle，Space 入口统一 Asset。不得把插画和组件 UI 图形纳入 workflow 尺寸覆盖。
