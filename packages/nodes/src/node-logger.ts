/**
 * 本包用到的日志接口；Harness 的 `Logger` 在结构上满足它。令牌、配对码与转写文本都不进日志。
 */
export interface NodeLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export const silentNodeLog: NodeLogger = {
  info() {},
  warn() {},
  error() {},
};
