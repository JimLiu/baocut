import { memo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import { remarkPlugins } from '../thread/remark-plugins.ts';
import '../thread/agent-thread.css';

/**
 * 章节表脚本的只读渲染（轻量编辑器设计 §7：不复用协作文档编辑器，按会话正文的 Markdown 样式 `bc-amd` 画）。
 * 脚本里的图与文分开存（动效视频设计 §2.2 的 `imageRefs`），正文里的图不画；链接只显示文字，不在侧栏里跳走。
 */
const components: Components = {
  img: () => null,
  a: ({ children }) => <span>{children}</span>,
};

export const ScriptMarkdown = memo(function ScriptMarkdown({ text }: { text: string }) {
  return (
    <div className="bc-amd">
      <Markdown remarkPlugins={remarkPlugins} components={components}>
        {text}
      </Markdown>
    </div>
  );
});
