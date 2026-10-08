/** 本包只用到的日志接口；Harness 的 `Logger` 在结构上满足它（Jobs 不依赖 Harness，架构设计 §13.1）。 */
export interface JobsLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export const silentLog: JobsLogger = {
  info() {},
  warn() {},
  error() {},
};
