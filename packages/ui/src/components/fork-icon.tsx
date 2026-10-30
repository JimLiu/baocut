import { createIcon } from '@react-spectrum/s2';

/**
 * 分叉图标（回合页脚「从这一轮分叉」、线程顶上「分叉自…」）：S2 没有分支的语义，`Split` 是剪刀不能借。按原型 icons.jsx `fork`
 * 的描边几何画在 20×20 网格上——左边一条主干连上下两个节点，右上的节点弯下来并进主干；1.5 笔宽、只吃 currentColor。
 */
export const ForkIcon = createIcon((props) => (
  <svg {...props} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 6.2v7.6" />
    <path d="M14 6.2c0 3.6-8 3-8 6.6" />
    <path d="M6 2.1a2.05 2.05 0 1 0 0 4.1 2.05 2.05 0 0 0 0-4.1z" />
    <path d="M14 2.1a2.05 2.05 0 1 0 0 4.1 2.05 2.05 0 0 0 0-4.1z" />
    <path d="M6 13.8a2.05 2.05 0 1 0 0 4.1 2.05 2.05 0 0 0 0-4.1z" />
  </svg>
));
