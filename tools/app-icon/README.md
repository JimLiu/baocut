# BaoCut App 图标

App 图标的绘制源码与导出脚本。图形由三条横向轨道拼成一个圆角播放键，一根带星芒的播放头把它切开；一块品牌色底砖、白色图形、一档浅色片段，整张图三种颜色。设计思路见 [`docs/design/brand/app-icon.md`](../../docs/design/brand/app-icon.md)。

| 文件 | 作用 |
| --- | --- |
| `app-icon.mjs` | 绘制源码。几何在 `GEOMETRY`，配色变体在 `VARIANTS`；`svg(variant, { shadow })` 出 1024 画布的 SVG 字符串，纯函数，不依赖浏览器 |
| `render.mjs` | 导出脚本。用仓库自带的 Electron 在 canvas 里按每个目标尺寸各自绘制 SVG（不从大图缩小），写出下表全部生成物 |

生成物不手改，改完 `app-icon.mjs` 后在仓库根重跑：

```bash
npm run icons                                 # 写回仓库里的全部生成物
node tools/app-icon/render.mjs --out /tmp/x   # 只写到临时目录预览
```

| 生成物 | 内容 |
| --- | --- |
| `designs/baocut/assets/app-icon.svg` | 1024 画布的矢量版，含 macOS 模板投影；原型的更新对话框用它 |
| `apps/desktop/build/icon.png` | 1024 PNG，含模板投影 |
| `apps/desktop/build/icon.icns` | iconset 16–512 各含 @2x，含模板投影，`iconutil` 打包 |
| `apps/desktop/build/icon.ico` | 16 / 20 / 24 / 32 / 40 / 48 / 64 / 128 / 256 的 32 位 PNG 条目，**不含**投影（Windows 不期待图标自带投影） |

依赖：`node_modules/electron`（根 `npm ci` 已装）与 macOS 自带的 `iconutil`，因此只能在 macOS 上运行。也正因为导出只能在 macOS 上做，这几个生成物**提交进 git**（[仓库约定 §「生成物不进 git」](../../docs/repo-conventions.md)的例外）：Windows 打包工作流在 Windows runner 上直接读提交的 `icon.ico`，原型与 electron-builder 也直接读文件，不在构建时重新导出。Electron 启动时打印的 `sandbox_extension_issue_file` 一行是无害的提示。
