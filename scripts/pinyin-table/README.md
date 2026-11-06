# pinyin-table

生成内置 skill `virtual-host` 对口型用的汉字读音表 `skills/baocut/built-in-skills/virtual-host/scripts/pinyin-table.mjs`。口型只看声母、韵母，不看声调，所以表里是去掉声调的拼音（ü 写成 `v`，女 = `nv`），按音节分组，一个音节一行。

## 用法

需要 macOS 与 Node 22.18+（直接跑 `.ts`）。读音来自 macOS Foundation 自带的 ICU Han-Latin 转写（`NSStringTransformMandarinToLatin`），不联网、不装包：

```bash
node scripts/pinyin-table/generate.ts
```

- `--out`：写到别处（默认就是上面的表）。

脚本打印收了多少字、多少音节、多少字没有读音（转写原样返回的生僻字，查表时当作不认识的字处理）以及文件字节数。表要留在 skill 单文件 256 KB 的上限以内，现在约 85 KB。

## 范围与限制

- 覆盖 CJK 统一表意文字（U+4E00–U+9FFF）与扩展 A（U+3400–U+4DBF）。
- 每个字只有一个读音（ICU 给的最常见读音）。多音字在词里读法不同时（银行 `hang`、了解 `liao`），由 `visemes.mjs` 里的词表纠正；词表只收口型确实不同的常用词。
- 数据许可：ICU 的转写数据随 Unicode License V3 发布，见 `THIRD_PARTY_NOTICES.md`。
