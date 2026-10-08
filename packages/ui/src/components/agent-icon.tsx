import { createIcon } from '@react-spectrum/s2';

/**
 * 智能体（机器人）图标：S2 workflow 图标里没有这个语义，按原型的描边几何画在 20×20 网格上，
 * 1.5 笔宽、只吃 currentColor，放进按钮与 SideNav 的图标槽时与 S2 原件一样对齐。
 */
export const AgentIcon = createIcon((props) => (
  <svg {...props} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M6.4 6.6h7.2A2.3 2.3 0 0 1 15.9 8.9v4.4a2.3 2.3 0 0 1-2.3 2.3H6.4a2.3 2.3 0 0 1-2.3-2.3V8.9a2.3 2.3 0 0 1 2.3-2.3z" />
    <path d="M10 6.6V4.5" />
    <path d="M10 2.2a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3z" />
    <path d="M7.9 10.7h.01M12.1 10.7h.01" />
    <path d="M4.1 11.1H2.4M15.9 11.1h1.7" />
  </svg>
));
