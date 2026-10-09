# 字体探针

这些字体只包含本项目原创的多边形轮廓，以 CC0-1.0 发布。
安装 Python 与 `fonttools` 后，从仓库根重新生成：

```sh
python3 crates/render-raster/tests/fixtures/fonts/mk_colr_probe.py
python3 crates/render-raster/tests/fixtures/fonts/mk-cjk-fallback-probe.py
```

- `ColrProbe.ttf` 验证 COLR/CPAL 渲染与预乘颜色。
- `cjk-fallback-probe.ttf` 只覆盖 U+20BB7（𠮷）。探针使用 `Source Han Sans SC`
  族名，以进入已有的 CJK 回退链；它不包含该字体的任何轮廓。测试把探针与内置
  Arimo、Noto Sans SC 组合使用，不依赖本机装了哪些字体。
