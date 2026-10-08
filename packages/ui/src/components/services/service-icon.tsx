import type { ComponentProps } from 'react';
import { createIcon } from '@react-spectrum/s2';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import Code from '@react-spectrum/s2/icons/Code';
import DeviceMultiscreen from '@react-spectrum/s2/icons/DeviceMultiscreen';
import GlobeGrid from '@react-spectrum/s2/icons/GlobeGrid';
import type { ServiceId } from '../../model/services.ts';

/**
 * MCP 协议标识：S2 workflow 图标里没有，按原型 designs/baocut/app/icons.jsx `mcp` 的描边几何画在 20×20 网格上，
 * 1.5 笔宽、只吃 currentColor；只用于 MCP 服务入口（产品设计 §2.1）。
 */
export const McpIcon = createIcon((props) => (
  <svg {...props} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.85 9.46 L9.64 2.67 C10.58 1.73 12.1 1.73 13.03 2.67 C13.97 3.61 13.97 5.13 13.03 6.07 L7.91 11.19" />
    <path d="M7.98 11.12 L13.03 6.07 C13.97 5.13 15.49 5.13 16.43 6.07 L16.46 6.1 C17.4 7.04 17.4 8.56 16.46 9.5 L10.32 15.63 C10.01 15.95 10.01 16.45 10.32 16.77 L11.58 18.03" />
    <path d="M11.34 4.37 L6.31 9.39 C5.38 10.33 5.38 11.85 6.31 12.78 C7.25 13.72 8.77 13.72 9.71 12.78 L14.73 7.76" />
  </svg>
));

/** 停止：原型 icons.jsx `stop`（Pause 派生的空心圆角方框）；S2 没有对应的 workflow 图标。 */
export const StopIcon = createIcon((props) => (
  <svg {...props} viewBox="0 0 20 20" fill="currentColor">
    <path d="M15.75,18H4.25c-1.24072,0-2.25-1.00977-2.25-2.25V4.25c0-1.24023,1.00928-2.25,2.25-2.25h11.5c1.24072,0,2.25,1.00977,2.25,2.25v11.5c0,1.24023-1.00928,2.25-2.25,2.25ZM4.25,3.5c-.41357,0-.75.33691-.75.75v11.5c0,.41309.33643.75.75.75h11.5c.41357,0,.75-.33691.75-.75V4.25c0-.41309-.33643-.75-.75-.75H4.25Z" />
  </svg>
));

/**
 * 四项服务的标识（原型 page-services.jsx `ServiceIcon`）：MCP 用协议标识，远端算力是多屏，Web 是地球；
 * 模型接口原型里没有自己的图标（它是 Web 服务页的一节），用 S2 的 Code（接口）。出错时换成警告。
 */
export const SERVICE_ICON = { mcp: McpIcon, remote: DeviceMultiscreen, web: GlobeGrid, 'model-api': Code } as const;

export function ServiceIcon({
  id,
  error = false,
  styles,
}: {
  id: ServiceId;
  error?: boolean;
  styles?: ComponentProps<typeof GlobeGrid>['styles'];
}) {
  const Icon = error ? AlertTriangle : SERVICE_ICON[id];
  return <Icon styles={styles} />;
}
