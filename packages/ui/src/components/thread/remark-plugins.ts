import remarkCjkFriendly from 'remark-cjk-friendly/parseOnly';
import remarkCjkFriendlyGfmStrikethrough from 'remark-cjk-friendly-gfm-strikethrough/parseOnly';
import remarkGfm from 'remark-gfm';

/**
 * 界面里渲染 Markdown 统一用的 remark 插件：GFM，加上 CJK 友好的强调与删除线规则。
 * CommonMark 的定界规则要求 `**` 外侧是空白或标点，`建议**确定**后`、`**粗体。**接着` 这类中日韩写法会原样露出星号；
 * remark-cjk-friendly 放宽了这一条，GFM 的 `~~` 同理由 remark-cjk-friendly-gfm-strikethrough 处理。只做解析，界面不回写 Markdown。
 */
export const remarkPlugins = [remarkGfm, remarkCjkFriendly, remarkCjkFriendlyGfmStrikethrough];
