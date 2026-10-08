# 字幕设计补充字体

`subtitle-design-fonts.json` 固定六份字体的来源文件、SHA-256 和 OFL 许可文件。源文件是各字体以 OFL 1.1 许可发布的 WOFF2（文件名见清单各项的 `source`）。通过 fontTools 将 WOFF2 解压为 sfnt TTF，未修改名称或字形；对应版本由源文件与输出摘要标识。

Inter Medium、Poppins Black、Roboto Mono Medium、Playfair Display Regular/Italic、Oswald Bold 随 App/Runtime/Web 打包。实际字族名称以字体内部表为准，Poppins Black 单独注册。保留 OFL 正文；未覆盖文字使用既有 Noto/系统回退。增补字体追加至核心字体顺序尾部，避免改变旧 atlas face id。
