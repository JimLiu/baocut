/**
 * BCF 编写层（React → JSON）—— 规范 §13 的最小可运行实现。
 *
 * 元素用 React JSX 编写（<Box>/<Text>/<Svg>/<Path>/<Use>…），
 * 组件用 defineComponent 声明：render 以「符号 props」（Proxy 占位符）执行一次，
 * 产出带 "$props.*" 绑定的参数化组件 JSON（规范 §13.2 的参数化编译）。
 * 求值结束后 React 元素即被丢弃 —— 运行时没有 React。
 */
import React, { type ReactElement, type ReactNode } from "react";

/* ── 宿主元素（serializer 认识的标签） ────────────────────────────── */
type AnyProps = Record<string, unknown> & { children?: ReactNode };
const host = (tag: string) => tag as unknown as (props: AnyProps) => ReactElement;

export const Box = host("bcf-box");
export const Text = host("bcf-text");
export const Image = host("bcf-image");
export const Svg = host("bcf-svg");
export const Path = host("bcf-path");
export const Group = host("bcf-group");
export const Use = host("bcf-use");

const TAG_TO_TYPE: Record<string, string> = {
  "bcf-box": "box",
  "bcf-text": "text",
  "bcf-image": "image",
  "bcf-svg": "svg",
  "bcf-path": "path",
  "bcf-group": "group",
  "bcf-use": "use",
};

/* ── 布局便利组件（模板设计 §3.6）─────────────────────────────────
   纯编写层语法糖：展开为带 layout 的 box，规范层不新增节点类型。 */
function flow(layout: "row" | "column", props: AnyProps): ReactElement {
  const { style, gap, ...rest } = props as AnyProps & { gap?: unknown };
  return React.createElement(Box, {
    ...rest,
    style: {
      ...(style as Record<string, unknown> | undefined),
      layout,
      ...(gap !== undefined ? { gap } : {}),
    },
  });
}

export function Row(props: AnyProps): ReactElement {
  return flow("row", props);
}

export function Column(props: AnyProps): ReactElement {
  return flow("column", props);
}

export function Grid(props: AnyProps & { columns?: number; gap?: unknown }): ReactElement {
  const { style, columns, gap, ...rest } = props;
  return React.createElement(Box, {
    ...rest,
    style: {
      ...(style as Record<string, unknown> | undefined),
      layout: "grid",
      ...(columns !== undefined ? { columns } : {}),
      ...(gap !== undefined ? { gap } : {}),
    },
  });
}

/** row/column 内的弹性占位 —— 编译为带 flex 的空 box。id / animate 透传。 */
export function Spacer(
  props: { id?: string; flex?: number; animate?: unknown } = {},
): ReactElement {
  const { flex, ...rest } = props;
  return React.createElement(Box, { ...rest, style: { flex: flex ?? 1 } });
}

/* ── 组件系统：符号 props 编译（规范 §13.2） ─────────────────────── */
export interface ComponentDef {
  doc?: string;
  props: Record<string, { type: string; default?: unknown }>;
  render: (props: Record<string, any>) => ReactElement;
}
export interface ComponentHandle {
  __bcfComponent: string;
}

const componentRegistry: Record<string, unknown> = {};

export function defineComponent(name: string, def: ComponentDef): ComponentHandle {
  // 符号 props：任何 prop 访问都返回 "$props.<key>" 占位符字符串，
  // 保证组件 JSON 是参数化的（同一定义、不同数据 → 不同画面）。
  const symbolic = new Proxy(
    {},
    { get: (_t, key) => `$props.${String(key)}` },
  ) as Record<string, any>;
  const root = toNode(def.render(symbolic));
  componentRegistry[name] = {
    ...(def.doc !== undefined ? { doc: def.doc } : {}),
    props: def.props,
    root,
  };
  return { __bcfComponent: name };
}

/* ── React 元素树 → BCF 元素节点 ─────────────────────────────────── */
function childArray(children: ReactNode): ReactNode[] {
  const out: ReactNode[] = [];
  const walk = (c: ReactNode) => {
    if (c == null || c === false || c === true) return;
    if (Array.isArray(c)) return c.forEach(walk);
    out.push(c);
  };
  walk(children);
  return out;
}

export function toNode(el: ReactNode): Record<string, unknown> {
  if (!React.isValidElement(el)) throw new Error(`toNode: 不是 React 元素: ${String(el)}`);
  const { type, props } = el as ReactElement & { props: AnyProps };

  if (typeof type === "function") {
    // 函数组件：编译期直接求值展开（规范 §13.1 —— 运行时无 React）
    return toNode((type as (p: AnyProps) => ReactElement)(props));
  }
  if (type === React.Fragment) throw new Error("toNode: Fragment 不能作为元素节点根");

  const bcfType = TAG_TO_TYPE[String(type)];
  if (!bcfType) throw new Error(`toNode: 未知宿主元素 <${String(type)}>`);

  const node: Record<string, unknown> = { type: bcfType };
  if (props.id !== undefined) node.id = props.id;

  if (bcfType === "text") {
    const kids = childArray(props.children);
    const text =
      props.text !== undefined
        ? props.text
        : kids.map((k) => (typeof k === "string" || typeof k === "number" ? String(k) : "")).join("");
    node.text = text;
  }
  if (bcfType === "image" && props.src !== undefined) node.src = props.src;
  if (bcfType === "svg" && props.viewBox !== undefined) node.viewBox = props.viewBox;
  if (bcfType === "path") {
    for (const k of ["d", "stroke", "strokeWidth", "fill"]) {
      if (props[k] !== undefined) node[k] = props[k];
    }
  }
  if (bcfType === "use") {
    const comp = props.component as ComponentHandle | string;
    node.component = typeof comp === "string" ? comp : comp.__bcfComponent;
    for (const k of ["props", "each", "layout", "stagger"]) {
      if (props[k] !== undefined) node[k] = props[k];
    }
  }
  if (props.style !== undefined) node.style = props.style;
  if (props.animate !== undefined) node.animate = props.animate;

  if (bcfType !== "text" && bcfType !== "path" && props.children !== undefined) {
    const kids = childArray(props.children).map(toNode);
    if (kids.length) node.children = kids;
  }
  return node;
}

/* ── 文档组装 ────────────────────────────────────────────────────── */
export interface ClipSpec {
  id: string;
  start: unknown;
  end?: unknown;
  dur?: number;
  z?: number;
  transitionIn?: unknown;
  transitionOut?: unknown;
  element?: ReactElement;
  camera?: unknown;
  layout?: unknown;
  lanes?: unknown;
  captions?: unknown;
}

export function clip(spec: ClipSpec): Record<string, unknown> {
  const { element, ...rest } = spec;
  const out: Record<string, unknown> = { ...rest };
  if (element) out.element = toNode(element);
  return out;
}

export function defineDoc(doc: Record<string, unknown>): Record<string, unknown> {
  return { ...doc, components: { ...componentRegistry } };
}
