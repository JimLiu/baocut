import type { VersionRef } from '@baocut/protocol';

/** 素材字节怎么变成能画的东西；`release` 在缓存丢掉它时调用（例如销毁播放器实例）。 */
export interface AssetDecoder<T> {
  /** 缓存键的一部分：同一个素材可以按不同的解码器各解一份。 */
  readonly name: string;
  decode(response: Response): Promise<T>;
  release?(value: T): void;
}

export type AssetState<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'failed'; message: string };

/** 画帧时要用的素材内容从哪里来（界面里是视频的素材缓存）：还没有就去取，取到之后由缓存通知重画。 */
export interface AssetSource {
  get<T>(asset: VersionRef, decoder: AssetDecoder<T>): AssetState<T>;
}
