import { useCurrentFrame, useVideoConfig } from "@baocut/program";

/** 整幅填色，帧号编码进红绿两通道：r = frame % 256，g = frame / 256。 */
export function Frames() {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  return <rect width={width} height={height} fill={`rgb(${frame % 256},${Math.floor(frame / 256)},7)`} />;
}
