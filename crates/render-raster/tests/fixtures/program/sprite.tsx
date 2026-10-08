import { asset } from "@baocut/program";
import { Label } from "./parts/label";

/** 左半贴 `files` 里的 dot.svg，右半是一个带文字的 HTML 盒子。 */
export function Sprite(props: { src?: string; odd?: boolean }) {
  return (
    <>
      <rect width={32} height={16} fill="#102030" />
      <image href={asset(props.src ?? "dot.svg")} x={0} y={0} width={16} height={16} />
      <Label odd={props.odd} />
    </>
  );
}
