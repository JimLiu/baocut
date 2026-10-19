/** BaoCut: ui overlays and icons from app-core-BE6n4d7F.js. */
import type { Dynamic } from "../../interop/legacy-dynamic";
import {
  React,
} from "../dependencies";
import {
  resolveUiDesignSystemValue2,
  useUiDesignSystemUseContext,
} from "./design-system";
import {
  resolveUiLinksAndFoundationUseContext2,
  resolveUiLinksAndFoundationValue12,
  useUiLinksAndFoundationUseSyncExternalStore2,
} from "./links-and-foundation";
import {
  MISSING_GLYPH_ALIASES,
  MISSING_GLYPH_DRAWINGS,
  MissingGlyphSvg,
} from "./missing-glyphs";
import {
  UiProviderAndLayersCreateContext12,
  UiProviderAndLayersCreateContext8,
  UiProviderAndLayersState,
  resolveUiProviderAndLayersCdsFontMonoOverride,
  resolveUiProviderAndLayersCdsPageBg,
  resolveUiProviderAndLayersUseContext,
  resolveUiProviderAndLayersUseContext2,
  resolveUiProviderAndLayersUseContext3,
  resolveUiProviderAndLayersUseContext4,
  resolveUiProviderAndLayersUseContext5,
  resolveUiProviderAndLayersUseContext6,
  resolveUiProviderAndLayersValue2,
  useUiProviderAndLayersUseContext,
} from "./provider-and-layers";
import type * as ReactComponentTypes from "react";

export const UiOverlaysAndIconsActionsRef: ReactComponentTypes.FC<{
  actionsRef: ReactComponentTypes.RefObject<{ close?: () => void } | null>;
  children?: ReactComponentTypes.ReactNode;
}> = ({
  actionsRef: actionsRef,
  children: children,
}) => {
  let [uniqueItemsState] = (0, React.useState)(
    (..._extraArguments: unknown[]) => new Set<Element>(),
  );
  let enabledRef = (0, React.useRef)(false);
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): Dynamic => (
      enabledRef.current && ((enabledRef.current = false), actionsRef.current?.close?.()),
      (..._extraArguments: unknown[]): undefined => {
        enabledRef.current = false;
        for (let uiOverlaysAndIconsActionsRefResult of uniqueItemsState)
          if (
            isUiOverlaysAndIconsNone(uiOverlaysAndIconsActionsRefResult) &&
            isUiOverlaysAndIconsDataOpen(uiOverlaysAndIconsActionsRefResult)
          ) {
            enabledRef.current = true;
          }
      }
    ),
    [actionsRef, uniqueItemsState],
  );
  return (
    <UiOverlaysAndIconsCreateContext5.Provider value={uniqueItemsState}>
      {children}
    </UiOverlaysAndIconsCreateContext5.Provider>
  );
};

export type IconSize =
  | "xs"
  | "sm"
  | "md"
  | "lg"
  | "xl"
  | "xxl"
  | "auto"
  | "auto-sm"
  | "auto-lg";

export interface CustomSvgIcon {
  viewBox: number;
  paths: readonly (
    | string
    | {
        d: string;
        strokeWidth?: ReactComponentTypes.SVGAttributes<SVGPathElement>["strokeWidth"];
      }
  )[];
}

interface IconAppearanceProps {
  size?: IconSize;
  customSize?: number;
  alt?: string;
  bold?: boolean;
  animated?: boolean;
}

type IconDomAttributes = ReactComponentTypes.DOMAttributes<
  HTMLElement | SVGSVGElement
>;

export type IconProps = IconAppearanceProps &
  IconDomAttributes &
  (
    | (Omit<
        ReactComponentTypes.SVGProps<SVGSVGElement>,
        keyof IconDomAttributes
      > & {
        customIcon: CustomSvgIcon;
        name?: string;
        icon?: { name: string };
      })
    | (Omit<
        ReactComponentTypes.ComponentPropsWithRef<"span">,
        keyof IconDomAttributes
      > & {
        customIcon?: undefined;
      } & (
          | { name: string; icon?: { name: string } }
          | { name?: undefined; icon: { name: string } }
        ))
  );

export const UiOverlaysAndIconsCustomIcon: ReactComponentTypes.FC<IconProps> = (
  uiOverlaysAndIconsCustomIcon,
) => {
  let uiOverlaysAndIconsComfortable: string = resolveUiOverlaysAndIconsComfortable();
  if (uiOverlaysAndIconsCustomIcon.customIcon) {
    let {
      customIcon: uiOverlaysAndIconsCustomIcon13,
      size: uiOverlaysAndIconsCustomIcon20 = UiOverlaysAndIconsMd,
      alt: uiOverlaysAndIconsCustomIcon14,
      className: className2,
      style: uiOverlaysAndIconsCustomIcon15,
      name: uiOverlaysAndIconsCustomIcon16,
      icon: uiOverlaysAndIconsCustomIcon17,
      animated: uiOverlaysAndIconsCustomIcon18,
      ...uiOverlaysAndIconsCustomIcon19
    } = uiOverlaysAndIconsCustomIcon;
    let px2: Dynamic =
      UiOverlaysAndIconsMaster[
        resolveUiOverlaysAndIconsAuto(
          uiOverlaysAndIconsCustomIcon20,
          uiOverlaysAndIconsComfortable,
        )
      ].px;
    let fontSize: string = resolveUiOverlaysAndIconsValue6(px2);
    return (
      <svg
        data-cds={`Icon`}
        width={`1em`}
        height={`1em`}
        viewBox={`0 0 ${uiOverlaysAndIconsCustomIcon13.viewBox} ${uiOverlaysAndIconsCustomIcon13.viewBox}`}
        fill={`currentColor`}
        fillRule={`evenodd`}
        stroke={`none`}
        strokeLinecap={`round`}
        strokeLinejoin={`round`}
        xmlns={`http://www.w3.org/2000/svg`}
        style={{
          ...UiOverlaysAndIconsFlexShrink,
          fontSize: fontSize,
          ...uiOverlaysAndIconsCustomIcon15,
        }}
        className={className2}
        {...uiOverlaysAndIconsCustomIcon19}
        role={
          uiOverlaysAndIconsCustomIcon19.role ??
          (uiOverlaysAndIconsCustomIcon14 ? `img` : undefined)
        }
        aria-hidden={
          uiOverlaysAndIconsCustomIcon19[`aria-hidden`] ??
          (uiOverlaysAndIconsCustomIcon14 ? undefined : true)
        }
        aria-label={
          uiOverlaysAndIconsCustomIcon19[`aria-label`] ??
          (uiOverlaysAndIconsCustomIcon14 || undefined)
        }
      >
        {uiOverlaysAndIconsCustomIcon13.paths.map(
          (path, index, ..._extraArguments: unknown[]) =>
            typeof path == `string` ? (
              <path d={path} key={index} />
            ) : (
              <path
                d={path.d}
                fill={`none`}
                stroke={`currentColor`}
                strokeWidth={path.strokeWidth}
                vectorEffect={`non-scaling-stroke`}
                key={index}
              />
            ),
        )}
      </svg>
    );
  }
  let {
    bold: uiOverlaysAndIconsCustomIcon10 = false,
    animated: uiOverlaysAndIconsCustomIcon11 = false,
    alt: uiOverlaysAndIconsCustomIcon2,
    className: className,
    style: uiOverlaysAndIconsCustomIcon3,
    name: uiOverlaysAndIconsCustomIcon4,
    icon: uiOverlaysAndIconsCustomIcon5,
    size: uiOverlaysAndIconsCustomIcon6,
    customSize: uiOverlaysAndIconsCustomIcon7,
    customIcon: uiOverlaysAndIconsCustomIcon8,
    ...uiOverlaysAndIconsCustomIcon9
  } = uiOverlaysAndIconsCustomIcon;
  let name =
    uiOverlaysAndIconsCustomIcon.name ?? uiOverlaysAndIconsCustomIcon.icon.name;
  // BaoCut: 随包的图标字体缺这个字形时换成近似字形（missing-glyphs.tsx）。
  name = MISSING_GLYPH_ALIASES[name] ?? name;
  let cdsOpsz: Dynamic;
  let uiOverlaysAndIconsCustomIconResult: Dynamic;
  if (uiOverlaysAndIconsCustomIcon7 === undefined) {
    uiOverlaysAndIconsCustomIconResult = resolveUiOverlaysAndIconsAuto(
      uiOverlaysAndIconsCustomIcon6 ?? UiOverlaysAndIconsMd,
      uiOverlaysAndIconsComfortable,
    );
    cdsOpsz = UiOverlaysAndIconsMaster[uiOverlaysAndIconsCustomIconResult].px;
  } else {
    cdsOpsz = uiOverlaysAndIconsCustomIcon7;
    uiOverlaysAndIconsCustomIconResult = resolveUiOverlaysAndIconsValue8(cdsOpsz);
  }
  let stroke: Dynamic =
    UiOverlaysAndIconsMaster[uiOverlaysAndIconsCustomIconResult].stroke;
  if (uiOverlaysAndIconsCustomIcon10) {
    `strong` in stroke;
  }
  let UiOverlaysAndIconsIcons2Item: Dynamic = UiOverlaysAndIconsIcons2[name];
  let UiOverlaysAndIconsSecondaryItem: Dynamic =
    UiOverlaysAndIconsIcons2Item === undefined
      ? undefined
      : UiOverlaysAndIconsSecondary[name];
  let UiOverlaysAndIconsXxlItem: Dynamic =
    UiOverlaysAndIconsXxl[uiOverlaysAndIconsCustomIconResult];
  let strong: Dynamic =
    uiOverlaysAndIconsCustomIcon7 === undefined
      ? uiOverlaysAndIconsCustomIcon10 && UiOverlaysAndIconsXxlItem.strong !== undefined
        ? UiOverlaysAndIconsXxlItem.strong
        : UiOverlaysAndIconsXxlItem.regular
      : resolveUiOverlaysAndIconsFontSize(
          cdsOpsz,
          uiOverlaysAndIconsCustomIcon10 && `strong` in stroke
            ? stroke.strong
            : stroke.regular,
        );
  // BaoCut: 缺字形但有原版画法的名字照画 SVG，尺寸与线宽同字体图标（missing-glyphs.tsx）。
  let missingGlyphDrawing = MISSING_GLYPH_DRAWINGS[name];
  if (missingGlyphDrawing !== undefined) {
    // 调用方给的是 span 的 ref，挂不到 svg 上；目前没有调用方给图标传 ref。
    let { ref: _spanRef, ...missingGlyphSvgProps } = uiOverlaysAndIconsCustomIcon9;
    return (
      <MissingGlyphSvg
        drawing={missingGlyphDrawing}
        px={cdsOpsz}
        strokePx={
          uiOverlaysAndIconsCustomIcon10 && `strong` in stroke
            ? stroke.strong
            : stroke.regular
        }
        data-cds={`Icon`}
        data-icon={name}
        style={{
          ...UiOverlaysAndIconsFlexShrink,
          fontSize: strong.fontSize,
          ...uiOverlaysAndIconsCustomIcon3,
        }}
        className={className}
        {...missingGlyphSvgProps}
        role={
          missingGlyphSvgProps.role ??
          (uiOverlaysAndIconsCustomIcon2 ? `img` : undefined)
        }
        aria-hidden={
          missingGlyphSvgProps[`aria-hidden`] ??
          (uiOverlaysAndIconsCustomIcon2 ? undefined : true)
        }
        aria-label={
          missingGlyphSvgProps[`aria-label`] ??
          (uiOverlaysAndIconsCustomIcon2 || undefined)
        }
      />
    );
  }
  let uiOverlaysAndIconsCustomIcon12: Dynamic =
    uiOverlaysAndIconsCustomIcon11 && uiOverlaysAndIconsSet.has(name);
  let UiOverlaysAndIconsAnimDurItem: Dynamic = uiOverlaysAndIconsCustomIcon12
    ? UiOverlaysAndIconsAnimDur[name]
    : undefined;
  let UiOverlaysAndIconsAnimDurOutItem: Dynamic = uiOverlaysAndIconsCustomIcon12
    ? UiOverlaysAndIconsAnimDurOut[name]
    : undefined;
  let cdsAnimEase: Dynamic = uiOverlaysAndIconsCustomIcon12
    ? UiOverlaysAndIconsAnimEase[name]
    : undefined;
  let record2: Dynamic = uiOverlaysAndIconsCustomIcon12
    ? {
        ...strong,
        "--cds-opsz": cdsOpsz,
        "--cds-wght": strong.fontWeight,
        ...(UiOverlaysAndIconsAnimDurItem !== undefined && {
          "--cds-anim-dur": `${UiOverlaysAndIconsAnimDurItem}ms`,
        }),
        ...(UiOverlaysAndIconsAnimDurOutItem !== undefined && {
          "--cds-anim-dur-out": `${UiOverlaysAndIconsAnimDurOutItem}ms`,
        }),
        ...(cdsAnimEase !== undefined && {
          "--cds-anim-ease": cdsAnimEase,
        }),
      }
    : strong;
  return (
    <span
      data-cds={`Icon`}
      data-cds-anim={uiOverlaysAndIconsCustomIcon12 ? `` : undefined}
      data-cds-anim-loop={
        uiOverlaysAndIconsCustomIcon12 && uiOverlaysAndIconsSet2.has(name)
          ? ``
          : undefined
      }
      style={
        uiOverlaysAndIconsCustomIcon3
          ? {
              ...record2,
              ...uiOverlaysAndIconsCustomIcon3,
            }
          : record2
      }
      className={className}
      {...uiOverlaysAndIconsCustomIcon9}
      role={
        uiOverlaysAndIconsCustomIcon9.role ??
        (uiOverlaysAndIconsCustomIcon2 ? `img` : undefined)
      }
      aria-hidden={
        uiOverlaysAndIconsCustomIcon9[`aria-hidden`] ??
        (uiOverlaysAndIconsCustomIcon2 ? undefined : true)
      }
      aria-label={
        uiOverlaysAndIconsCustomIcon9[`aria-label`] ??
        (uiOverlaysAndIconsCustomIcon2 || undefined)
      }
    >
      {UiOverlaysAndIconsSecondaryItem !== undefined && (
        <span data-cds-icon-layer={`secondary`} aria-hidden={`true`}>
          {String.fromCodePoint(UiOverlaysAndIconsSecondaryItem)}
        </span>
      )}
      {UiOverlaysAndIconsIcons2Item === undefined
        ? null
        : String.fromCodePoint(UiOverlaysAndIconsIcons2Item)}
    </span>
  );
};

export const UiOverlaysAndIconsValue: ReactComponentTypes.FC<{
  children?: ReactComponentTypes.ReactNode;
}> = ({
  children: children,
}) => {
  return (
    <UiOverlaysAndIconsCreateContext.Provider value={false}>
      <UiOverlaysAndIconsCreateContext2.Provider value={`div`}>
        <UiOverlaysAndIconsCreateContext4.Provider value={null}>
          <UiOverlaysAndIconsCreateContext3.Provider value={null}>
            {children}
          </UiOverlaysAndIconsCreateContext3.Provider>
        </UiOverlaysAndIconsCreateContext4.Provider>
      </UiOverlaysAndIconsCreateContext2.Provider>
    </UiOverlaysAndIconsCreateContext.Provider>
  );
};

export interface SurfaceProps {
  children?: ReactComponentTypes.ReactNode;
  className?: string;
  style?: ReactComponentTypes.CSSProperties;
  surface?: string;
  density?: "compact" | "comfortable";
  companionModalCatcher?: boolean;
  closeOnActivityHide?: boolean;
}

export const UiOverlaysAndIconsSurface: ReactComponentTypes.FC<SurfaceProps> = ({
  children: children,
  className: className,
  style: style,
  surface: surface,
  density: density,
  companionModalCatcher = false,
  closeOnActivityHide = false,
}) => {
  let uiOverlaysAndIconsValue4: Dynamic = resolveUiOverlaysAndIconsValue4(
    resolveUiLinksAndFoundationValue12,
    useUiOverlaysAndIconsUseContext(closeOnActivityHide),
  );
  let uiProviderAndLayersUseContext2: Dynamic = resolveUiProviderAndLayersUseContext2();
  let dataDensity: Dynamic = density ?? uiProviderAndLayersUseContext2;
  let dataMode: Dynamic = useUiProviderAndLayersUseContext();
  let dataCdsTheme: Dynamic = useUiDesignSystemUseContext();
  let dataPlatform: Dynamic = resolveUiProviderAndLayersUseContext3();
  let uiProviderAndLayersUseContext4: Dynamic = resolveUiProviderAndLayersUseContext4();
  let dataFont: Dynamic =
    useUiLinksAndFoundationUseSyncExternalStore2(
      uiProviderAndLayersUseContext4 === undefined,
    ) ?? uiProviderAndLayersUseContext4;
  let uiProviderAndLayersUseContext5: Dynamic = resolveUiProviderAndLayersUseContext5();
  let dataCdsFizzyLake: Dynamic = resolveUiLinksAndFoundationUseContext2();
  let dataPageBg: Dynamic = resolveUiProviderAndLayersUseContext();
  let uiProviderAndLayersUseContext6: Dynamic = resolveUiProviderAndLayersUseContext6();
  let surface2: Dynamic = surface ?? uiProviderAndLayersUseContext6;
  let style2: Dynamic =
    surface2 || uiProviderAndLayersUseContext5 !== undefined || style
      ? {
          ...resolveUiProviderAndLayersCdsPageBg(surface2),
          ...resolveUiProviderAndLayersCdsFontMonoOverride(
            uiProviderAndLayersUseContext5,
          ),
          ...style,
        }
      : undefined;
  return (
    <div
      ref={uiOverlaysAndIconsValue4}
      className={resolveUiDesignSystemValue2(`cds-root pointer-events-auto`, className)}
      data-cds-portal={``}
      data-density={dataDensity}
      data-mode={dataMode}
      data-cds-theme={dataCdsTheme}
      data-platform={dataPlatform}
      data-font={dataFont}
      data-cds-fizzy-lake={dataCdsFizzyLake}
      data-page-bg={dataPageBg}
      style={style2}
      onPointerDown={companionModalCatcher ? resolveUiOverlaysAndIconsTouch : undefined}
      onMouseDown={
        companionModalCatcher ? resolveUiOverlaysAndIconsCurrentTarget : undefined
      }
      onDragStart={companionModalCatcher ? installUiOverlaysAndIconsEvent : undefined}
    >
      <UiProviderAndLayersState.Provider value={dataDensity}>
        <UiProviderAndLayersCreateContext8.Provider value={surface2}>
          <UiProviderAndLayersCreateContext12.Provider value={true}>
            <UiOverlaysAndIconsCreateContext6.Provider value={false}>
              <UiOverlaysAndIconsValue>{children}</UiOverlaysAndIconsValue>
            </UiOverlaysAndIconsCreateContext6.Provider>
          </UiProviderAndLayersCreateContext12.Provider>
        </UiProviderAndLayersCreateContext8.Provider>
      </UiProviderAndLayersState.Provider>
    </div>
  );
};

export const UiOverlaysAndIconsIcon: ReactComponentTypes.FC<{
  icon: ReactComponentTypes.ReactNode;
}> = ({
  icon: icon,
}) => {
  return (
    <span className={`flex size-icon shrink-0 items-center justify-center`}>
      {resolveUiOverlaysAndIconsValue9(icon) ? (
        <UiOverlaysAndIconsCustomIcon name={icon} size={`auto`} />
      ) : (
        icon
      )}
    </span>
  );
};

function resolveUiOverlaysAndIconsValue(
  element?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  return element?.ownerDocument.defaultView?.ResizeObserver;
}

var UiOverlaysAndIconsDataCdsOverlay: string;

var UiOverlaysAndIconsStyles: string;

function resolveUiOverlaysAndIconsCurrent(
  ref?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  return (...uiOverlaysAndIconsCurrent: Dynamic[]): Dynamic =>
    (ref.current as Dynamic)(...uiOverlaysAndIconsCurrent);
}

function resolveUiOverlaysAndIconsCurrent2(
  ref?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  return (...uiOverlaysAndIconsCurrent2: Dynamic[]): Dynamic =>
    ref.current?.(...uiOverlaysAndIconsCurrent2);
}

function useUiOverlaysAndIconsUseInsertionEffect(
  uiOverlaysAndIconsUseInsertionEffect?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let uiOverlaysAndIconsUseInsertionEffectRef: Dynamic = (0, React.useRef)(
    uiOverlaysAndIconsUseInsertionEffect,
  );
  (0, React.useInsertionEffect)(
    (..._extraArguments: unknown[]): undefined => {
      uiOverlaysAndIconsUseInsertionEffectRef.current =
        uiOverlaysAndIconsUseInsertionEffect;
    },
    [uiOverlaysAndIconsUseInsertionEffect],
  );
  let [uiOverlaysAndIconsCurrent2State]: Dynamic = (0, React.useState)(
    (..._extraArguments: unknown[]): Dynamic =>
      resolveUiOverlaysAndIconsCurrent2(
        uiOverlaysAndIconsUseInsertionEffectRef,
      ),
  );
  return uiOverlaysAndIconsUseInsertionEffect === undefined
    ? undefined
    : uiOverlaysAndIconsCurrent2State;
}

function useUiOverlaysAndIconsUseInsertionEffect2(
  uiOverlaysAndIconsUseInsertionEffect2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let uiOverlaysAndIconsUseInsertionEffect2Ref: Dynamic = (0, React.useRef)(
    uiOverlaysAndIconsUseInsertionEffect2,
  );
  (0, React.useInsertionEffect)(
    (..._extraArguments: unknown[]): undefined => {
      uiOverlaysAndIconsUseInsertionEffect2Ref.current =
        uiOverlaysAndIconsUseInsertionEffect2;
    },
    [uiOverlaysAndIconsUseInsertionEffect2],
  );
  let [uiOverlaysAndIconsCurrentState]: Dynamic = (0, React.useState)(
    (..._extraArguments: unknown[]): Dynamic =>
      resolveUiOverlaysAndIconsCurrent(
        uiOverlaysAndIconsUseInsertionEffect2Ref,
      ),
  );
  return uiOverlaysAndIconsCurrentState;
}

function resolveUiOverlaysAndIconsDetail(
  event?: Dynamic,
  ..._extraArguments: unknown[]
): undefined {
  if (
    !(
      event.detail <= 1 ||
      event.button !== 0 ||
      event.target.closest?.(
        `input:not([type='hidden']):not([disabled]),[contenteditable]:not([contenteditable='false']),textarea:not([disabled])`,
      )
    )
  ) {
    event.preventDefault();
  }
}

function resolveUiOverlaysAndIconsValue2(
  uiOverlaysAndIconsValue2?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  return uiOverlaysAndIconsValue2
    ? (
        uiOverlaysAndIconsValue22?: Dynamic,
        ..._extraArguments: unknown[]
      ): undefined => {
        uiOverlaysAndIconsValue2(uiOverlaysAndIconsValue22);
        resolveUiOverlaysAndIconsDetail(uiOverlaysAndIconsValue22);
      }
    : resolveUiOverlaysAndIconsDetail;
}

var UiOverlaysAndIconsCreateContext: Dynamic;

var UiOverlaysAndIconsCreateContext2: ReactComponentTypes.Context<
  "div" | "span"
>;

var UiOverlaysAndIconsCreateContext3: Dynamic;

var UiOverlaysAndIconsCreateContext4: Dynamic;

var UiOverlaysAndIconsHttpWwwW3Org1999Xhtml: string;

function resolveUiOverlaysAndIconsNamespaceURI(
  uiOverlaysAndIconsNamespaceURI?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let uiOverlaysAndIconsNamespaceURI2: Dynamic = uiOverlaysAndIconsNamespaceURI;
  return uiOverlaysAndIconsNamespaceURI2?.nodeType === 1
    ? uiOverlaysAndIconsNamespaceURI2.namespaceURI
    : undefined;
}

function resolveUiOverlaysAndIconsValue3(
  uiOverlaysAndIconsValue3?: Dynamic,
  ..._extraArguments: unknown[]
) {
  return (
    resolveUiOverlaysAndIconsNamespaceURI(uiOverlaysAndIconsValue3) ===
    UiOverlaysAndIconsHttpWwwW3Org1999Xhtml
  );
}

var UiOverlaysAndIconsCreateContext5: ReactComponentTypes.Context<Set<Element> | null>;

function isUiOverlaysAndIconsNone(
  uiOverlaysAndIconsNone?: Dynamic,
  ..._extraArguments: unknown[]
) {
  if (!uiOverlaysAndIconsNone.isConnected) return false;
  for (
    let uiOverlaysAndIconsNone2: Dynamic = uiOverlaysAndIconsNone;
    uiOverlaysAndIconsNone2 !== null;
    uiOverlaysAndIconsNone2 = uiOverlaysAndIconsNone2.parentElement
  )
    if (
      resolveUiOverlaysAndIconsValue3(uiOverlaysAndIconsNone2) &&
      uiOverlaysAndIconsNone2.style.display === `none`
    )
      return true;
  return false;
}

function isUiOverlaysAndIconsDataOpen(
  node?: Dynamic,
  ..._extraArguments: unknown[]
) {
  for (let isUiOverlaysAndIconsDataOpenResult of node.children as Dynamic)
    if (isUiOverlaysAndIconsDataOpenResult.hasAttribute(`data-open`))
      return true;
  return false;
}

function useUiOverlaysAndIconsUseContext(
  uiOverlaysAndIconsUseContext?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let useContext: Dynamic = (0, React.useContext)(
    UiOverlaysAndIconsCreateContext5,
  );
  let elementRef: Dynamic = (0, React.useRef)(null);
  (0, React.useEffect)(
    (..._extraArguments: unknown[]): Dynamic => {
      let element: Dynamic = elementRef.current;
      if (
        !(
          !uiOverlaysAndIconsUseContext ||
          useContext === null ||
          element === null
        )
      ) {
        useContext.add(element);
        return (..._extraArguments: unknown[]): undefined => {
          useContext.delete(element);
        };
      }
    },
    [useContext, uiOverlaysAndIconsUseContext],
  );
  return elementRef;
}

function resolveUiOverlaysAndIconsFixed(
  uiOverlaysAndIconsFixed?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let uiProviderAndLayersValue2: Dynamic =
    resolveUiProviderAndLayersValue2(options);
  return uiProviderAndLayersValue2 === null ||
    uiProviderAndLayersValue2.parentElement !== uiOverlaysAndIconsFixed
    ? null
    : uiProviderAndLayersValue2.childElementCount === 0 &&
        uiProviderAndLayersValue2.style.position === `fixed`
      ? uiProviderAndLayersValue2
      : null;
}

function isUiOverlaysAndIconsActiveElement(
  uiOverlaysAndIconsActiveElement?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
) {
  let uiOverlaysAndIconsFixed: Dynamic = resolveUiOverlaysAndIconsFixed(
    uiOverlaysAndIconsActiveElement,
    options,
  );
  if (uiOverlaysAndIconsFixed === null) return false;
  let uiProviderAndLayersValue2: Dynamic = resolveUiProviderAndLayersValue2(
    uiOverlaysAndIconsFixed.ownerDocument.activeElement,
  );
  let parentElement: Dynamic =
    uiOverlaysAndIconsActiveElement.parentElement ??
    uiOverlaysAndIconsActiveElement;
  return (
    uiProviderAndLayersValue2 === null ||
    !parentElement.contains(uiProviderAndLayersValue2)
  );
}

function resolveUiOverlaysAndIconsTouch(
  event?: Dynamic,
  ..._extraArguments: unknown[]
): undefined {
  if (
    event.pointerType !== `touch` &&
    isUiOverlaysAndIconsActiveElement(event.currentTarget, event.target)
  ) {
    event.preventDefault();
  }
}

function resolveUiOverlaysAndIconsCurrentTarget(
  event?: Dynamic,
  ..._extraArguments: unknown[]
): undefined {
  if (isUiOverlaysAndIconsActiveElement(event.currentTarget, event.target)) {
    event.preventDefault();
  }
}

var UiOverlaysAndIconsState: Dynamic;

function installUiOverlaysAndIconsEvent(
  event?: Dynamic,
  ..._extraArguments: unknown[]
): undefined {
  let currentTarget: Dynamic = event.currentTarget;
  let installUiOverlaysAndIconsEventResult: Dynamic = null;
  for (let installUiOverlaysAndIconsEventResult3 of currentTarget.children as Dynamic)
    if (
      ((installUiOverlaysAndIconsEventResult = resolveUiOverlaysAndIconsFixed(
        currentTarget,
        installUiOverlaysAndIconsEventResult3,
      )),
      installUiOverlaysAndIconsEventResult !== null)
    )
      break;
  if (installUiOverlaysAndIconsEventResult === null) return;
  let installUiOverlaysAndIconsEventResult2: Dynamic =
    installUiOverlaysAndIconsEventResult;
  if (
    UiOverlaysAndIconsState !== null &&
    UiOverlaysAndIconsState.event === event.nativeEvent
  ) {
    installUiOverlaysAndIconsEventResult2.style.pointerEvents = `none`;
    let restoreAll2: Dynamic = UiOverlaysAndIconsState.restoreAll;
    UiOverlaysAndIconsState.restoreAll = (
      ..._extraArguments: unknown[]
    ): undefined => {
      installUiOverlaysAndIconsEventResult2.style.pointerEvents = ``;
      restoreAll2();
    };
    return;
  }
  UiOverlaysAndIconsState?.restoreAll();
  installUiOverlaysAndIconsEventResult2.style.pointerEvents = `none`;
  let ownerDocument2: Dynamic =
    installUiOverlaysAndIconsEventResult2.ownerDocument;
  let record2: Dynamic = {
    event: event.nativeEvent,
    restoreAll: (..._extraArguments: unknown[]): undefined => {
      installUiOverlaysAndIconsEventResult2.style.pointerEvents = ``;
      for (let installUiOverlaysAndIconsEventResult3 of uiOverlaysAndIconsDragendDropPointerdownValues as Dynamic)
        ownerDocument2.removeEventListener(
          installUiOverlaysAndIconsEventResult3,
          restoreAll,
          true,
        );
      if (UiOverlaysAndIconsState === record2) {
        UiOverlaysAndIconsState = null;
      }
    },
  };
  let restoreAll: Dynamic = (..._extraArguments: unknown[]): Dynamic =>
    record2.restoreAll();
  UiOverlaysAndIconsState = record2;
  for (let installUiOverlaysAndIconsEventResult3 of uiOverlaysAndIconsDragendDropPointerdownValues as Dynamic)
    ownerDocument2.addEventListener(
      installUiOverlaysAndIconsEventResult3,
      restoreAll,
      true,
    );
}

var uiOverlaysAndIconsDragendDropPointerdownValues: string[];

var UiOverlaysAndIconsCreateContext6: Dynamic;

function resolveUiOverlaysAndIconsCurrent3(
  ref?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  if (typeof ref == `function`) return ref(options);
  if (ref) {
    ref.current = options;
  }
}

function collectUiOverlaysAndIconsSome(
  ...collectUiOverlaysAndIconsSome2: Dynamic[]
): Dynamic {
  return (
    collectUiOverlaysAndIconsSome3?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => {
    let mappedCollectUiOverlaysAndIconsSome: Dynamic =
      collectUiOverlaysAndIconsSome2.map(
        (rolldownNImport2?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
          resolveUiOverlaysAndIconsCurrent3(
            rolldownNImport2,
            collectUiOverlaysAndIconsSome3,
          ),
      );
    if (
      mappedCollectUiOverlaysAndIconsSome.some(
        (
          mappedCollectUiOverlaysAndIconsSome2?: unknown,
          ..._extraArguments: unknown[]
        ) => typeof mappedCollectUiOverlaysAndIconsSome2 == `function`,
      )
    )
      return (..._extraArguments: unknown[]): undefined => {
        collectUiOverlaysAndIconsSome2.forEach(
          (
            rolldownNImport2?: Dynamic,
            index?: Dynamic,
            ..._extraArguments: unknown[]
          ): undefined => {
            let mappedCollectUiOverlaysAndIconsSomeItem: Dynamic =
              mappedCollectUiOverlaysAndIconsSome[index];
            if (typeof mappedCollectUiOverlaysAndIconsSomeItem == `function`) {
              mappedCollectUiOverlaysAndIconsSomeItem();
            } else {
              resolveUiOverlaysAndIconsCurrent3(rolldownNImport2, null);
            }
          },
        );
      };
  };
}

function resolveUiOverlaysAndIconsValue4(
  uiOverlaysAndIconsValue4?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  return (0, React.useMemo)(
    (..._extraArguments: unknown[]): Dynamic =>
      collectUiOverlaysAndIconsSome(uiOverlaysAndIconsValue4, options, context),
    [uiOverlaysAndIconsValue4, options, context],
  );
}

function resolveUiOverlaysAndIconsValue5(
  uiOverlaysAndIconsValue5?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let useUiOverlaysAndIconsUseInsertionEffect22: Dynamic =
    useUiOverlaysAndIconsUseInsertionEffect2(uiOverlaysAndIconsValue5);
  return useUiOverlaysAndIconsUseInsertionEffect2(
    (
      uiOverlaysAndIconsValue52?: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic =>
      collectUiOverlaysAndIconsSome(
        useUiOverlaysAndIconsUseInsertionEffect22,
        options,
      )(uiOverlaysAndIconsValue52),
  );
}

var UiOverlaysAndIconsCdsRemScale: string;

var UiOverlaysAndIconsState2: string;

var resolveUiOverlaysAndIconsValue6: (uiOverlaysAndIconsValue6?: Dynamic, ..._extraArguments: unknown[]) => string;

var UiOverlaysAndIconsIcons: Dynamic;

var UiOverlaysAndIconsMaster: Dynamic;

var uiOverlaysAndIconsXsSmMdLgValues: string[];

function resolveUiOverlaysAndIconsAuto(
  uiOverlaysAndIconsAuto?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  return uiOverlaysAndIconsAuto === `auto`
    ? options
    : uiOverlaysAndIconsAuto === `auto-sm` ||
        uiOverlaysAndIconsAuto === `auto-lg`
      ? (uiOverlaysAndIconsXsSmMdLgValues[
          uiOverlaysAndIconsXsSmMdLgValues.indexOf(options) +
            (uiOverlaysAndIconsAuto === `auto-lg` ? 1 : -1)
        ] ?? options)
      : uiOverlaysAndIconsAuto;
}

var UiOverlaysAndIconsMd: IconSize;

function resolveUiOverlaysAndIconsComfortable(..._extraArguments: unknown[]) {
  return resolveUiProviderAndLayersUseContext2() === `comfortable`
    ? `md`
    : `sm`;
}

function resolveUiOverlaysAndIconsValue7(
  uiOverlaysAndIconsValue7: Dynamic = UiOverlaysAndIconsMd,
  ..._extraArguments: unknown[]
): Dynamic {
  return resolveUiOverlaysAndIconsAuto(
    uiOverlaysAndIconsValue7,
    resolveUiOverlaysAndIconsComfortable(),
  );
}

function resolveUiOverlaysAndIconsValue8(
  uiOverlaysAndIconsValue8?: Dynamic,
  ..._extraArguments: unknown[]
): string {
  let uiOverlaysAndIconsXsSmMdLgValueItem: string =
    uiOverlaysAndIconsXsSmMdLgValues[0];
  let amount: number = 1 / 0;
  for (let resolveUiOverlaysAndIconsValue8Result of uiOverlaysAndIconsXsSmMdLgValues as Dynamic) {
    let abs: number = Math.abs(
      UiOverlaysAndIconsMaster[resolveUiOverlaysAndIconsValue8Result].px -
        uiOverlaysAndIconsValue8,
    );
    if (abs <= amount) {
      amount = abs;
      uiOverlaysAndIconsXsSmMdLgValueItem =
        resolveUiOverlaysAndIconsValue8Result;
    }
  }
  return uiOverlaysAndIconsXsSmMdLgValueItem;
}

var UiOverlaysAndIconsIcons2: Dynamic;

var UiOverlaysAndIconsSecondary: Dynamic;

var uiOverlaysAndIconsSet: Dynamic;

var uiOverlaysAndIconsSet2: Dynamic;

var UiOverlaysAndIconsAnimDur: Dynamic;

var UiOverlaysAndIconsAnimDurOut: Dynamic;

var UiOverlaysAndIconsAnimEase: Dynamic;

var UiOverlaysAndIconsWght: Dynamic;

var uiOverlaysAndIconsState: number;
var uiOverlaysAndIconsState2: number;

function resolveUiOverlaysAndIconsRound(
  uiOverlaysAndIconsRound?: Dynamic,
  options?: Dynamic,
  context?: Dynamic,
  ..._extraArguments: unknown[]
) {
  let amount = (uiOverlaysAndIconsRound * options) / context;
  let {
    lo: UiOverlaysAndIconsWghtItem,
    hi: UiOverlaysAndIconsWghtItem2,
  }: Dynamic = UiOverlaysAndIconsWght[`${options}`];
  let amount2 =
    (amount - UiOverlaysAndIconsWghtItem) /
    (UiOverlaysAndIconsWghtItem2 - UiOverlaysAndIconsWghtItem);
  let total: Dynamic =
    uiOverlaysAndIconsState +
    (uiOverlaysAndIconsState2 - uiOverlaysAndIconsState) * amount2;
  return (
    Math.round(
      Math.max(
        uiOverlaysAndIconsState,
        Math.min(uiOverlaysAndIconsState2, total),
      ) * 10,
    ) / 10
  );
}

var UiOverlaysAndIconsFlexShrink: {
    flexShrink: number;
};

function resolveUiOverlaysAndIconsFontSize(
  uiOverlaysAndIconsFontSize?: Dynamic,
  options?: Dynamic,
  ..._extraArguments: unknown[]
) {
  let count = uiOverlaysAndIconsFontSize <= 18 ? 16 : 20;
  return {
    fontSize: resolveUiOverlaysAndIconsValue6(uiOverlaysAndIconsFontSize),
    fontWeight: resolveUiOverlaysAndIconsRound(
      options,
      count,
      uiOverlaysAndIconsFontSize,
    ),
  };
}

function resolveUiOverlaysAndIconsStroke(
  uiOverlaysAndIconsStroke?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let {
    px: UiOverlaysAndIconsMasterItem,
    stroke: UiOverlaysAndIconsMasterItem2,
  }: Dynamic = UiOverlaysAndIconsMaster[uiOverlaysAndIconsStroke];
  return Object.freeze({
    regular: Object.freeze(
      resolveUiOverlaysAndIconsFontSize(
        UiOverlaysAndIconsMasterItem,
        UiOverlaysAndIconsMasterItem2.regular,
      ),
    ),
    ...(`strong` in UiOverlaysAndIconsMasterItem2 && {
      strong: Object.freeze(
        resolveUiOverlaysAndIconsFontSize(
          UiOverlaysAndIconsMasterItem,
          UiOverlaysAndIconsMasterItem2.strong,
        ),
      ),
    }),
  });
}

var UiOverlaysAndIconsXxl: Dynamic;

function resolveUiOverlaysAndIconsValue9(
  uiOverlaysAndIconsValue9?: unknown,
  ..._extraArguments: unknown[]
): uiOverlaysAndIconsValue9 is string {
  return typeof uiOverlaysAndIconsValue9 == `string`;
}

// BaoCut: called by platform-core-initialize in the recovered source order.
export function initializeUiOverlaysAndIconsStep1(): void {
  (UiOverlaysAndIconsDataCdsOverlay = `data-cds-overlay`);
  `${UiOverlaysAndIconsDataCdsOverlay}`;
  (UiOverlaysAndIconsStyles = `input:not([type='hidden']):not([disabled]),[contenteditable]:not([contenteditable='false']),textarea:not([disabled])`);
  Object.freeze({
    onMouseDown: resolveUiOverlaysAndIconsDetail,
  });
  (UiOverlaysAndIconsCreateContext = (0, React.createContext)(false));
  (UiOverlaysAndIconsCreateContext2 = (0, React.createContext)<"div" | "span">(`div`));
  (UiOverlaysAndIconsCreateContext3 = (0, React.createContext)(null));
  (UiOverlaysAndIconsCreateContext4 = (0, React.createContext)(null));
  (UiOverlaysAndIconsHttpWwwW3Org1999Xhtml = `http://www.w3.org/1999/xhtml`);
  (UiOverlaysAndIconsCreateContext5 = (0, React.createContext)<Set<Element> | null>(null));
  (UiOverlaysAndIconsState = null);
  (uiOverlaysAndIconsDragendDropPointerdownValues = [
    `dragend`,
    `drop`,
    `pointerdown`,
  ]);
  (UiOverlaysAndIconsCreateContext6 = (0, React.createContext)(false));
  (UiOverlaysAndIconsCdsRemScale = `--cds-rem-scale`);
  (UiOverlaysAndIconsState2 = `calc(16rem * var(${UiOverlaysAndIconsCdsRemScale}, 1))`);
  `${UiOverlaysAndIconsState2}${UiOverlaysAndIconsState2}`;
  (resolveUiOverlaysAndIconsValue6 = (
    uiOverlaysAndIconsValue6?: Dynamic,
    ..._extraArguments: unknown[]
  ) =>
    `calc(${uiOverlaysAndIconsValue6 / 16}rem * var(${UiOverlaysAndIconsCdsRemScale}, 1))`);
  (UiOverlaysAndIconsIcons = {
    icons: {
      Activity: 57344,
      Add: 57345,
      AddCircle: 57346,
      Agent: 57347,
      Alarm: 57348,
      Android: 57349,
      Ant: 57350,
      Apple: 57351,
      Archive: 57352,
      ArrowDown: 57353,
      ArrowDownCircle: 57354,
      ArrowInSquare: 57355,
      ArrowLeft: 57356,
      ArrowLeftCircle: 57357,
      ArrowOutSquare: 57358,
      ArrowReturn: 57359,
      ArrowRight: 57360,
      ArrowRightCircle: 57361,
      ArrowSplitRight: 57362,
      ArrowUp: 57363,
      ArrowUpCircle: 57364,
      ArrowUpRight: 57365,
      ArrowsOut: 57366,
      Artifacts: 57367,
      Atom: 57368,
      Attachment: 57369,
      Batch: 57370,
      Beaker: 57371,
      Binoculars: 57372,
      Book: 57373,
      BookClosed: 57374,
      BookText: 57375,
      Box: 57376,
      BrowseSelect: 57377,
      Bullhorn: 57378,
      Cache: 57379,
      Calendar: 57380,
      Camera: 57381,
      Capacity: 57382,
      CaretDown: 57383,
      CaretDownUp: 57384,
      CaretLeft: 57385,
      CaretRight: 57386,
      CaretUp: 57387,
      CaretUpDown: 57388,
      ChangesPlusMinus: 57389,
      ChangesPlusMinusFilled: 57390,
      Chart: 57391,
      ChartLine: 57392,
      Chat: 57393,
      ChatAdd: 57394,
      ChatAddFilled: 57395,
      ChatDelete: 57396,
      ChatDeleteFilled: 57397,
      ChatFilled: 57398,
      ChatSimple: 57399,
      ChatSimpleFilled: 57400,
      Chats: 57401,
      ChatsFilled: 57402,
      Check: 57403,
      CheckCircle: 57404,
      CheckCircleFilled: 57405,
      CheckDouble: 57406,
      Checklist: 57407,
      ChecklistFilled: 57408,
      Clipboard: 57409,
      ClipboardArrow: 57410,
      Clock: 57411,
      Cloud: 57412,
      CloudFilled: 57413,
      CloudSlash: 57414,
      CloudSlashFilled: 57415,
      Code: 57416,
      CodeBlock: 57417,
      CodeBrackets: 57418,
      CodeFilled: 57419,
      CoffeeCup: 57420,
      Collapse: 57421,
      CommandCard: 57422,
      CommandLine: 57423,
      CommandLineFilled: 57424,
      CommandLinePrompt: 57425,
      Compact: 57426,
      Computer: 57427,
      Concierge: 57428,
      Connectors: 57429,
      Copy: 57430,
      Create: 57431,
      CreditCard: 57432,
      Cursor: 57433,
      CursorFilled: 57434,
      DNA: 57435,
      Database: 57436,
      Disconnect: 57437,
      Dispatch: 57438,
      DollarSign: 57439,
      DotsCircle: 57440,
      DotsHorizontal: 57441,
      DotsVertical: 57442,
      Download: 57443,
      Edit: 57444,
      Email: 57445,
      Evals: 57446,
      Expand: 57447,
      ExtendedThinking: 57448,
      Eye: 57449,
      EyeSlash: 57450,
      Fastforward: 57451,
      File: 57452,
      FileAdd: 57453,
      FileUpload: 57454,
      Files: 57455,
      Filter: 57456,
      Flag: 57457,
      Folder: 57458,
      FolderOpen: 57459,
      FolderPlus: 57460,
      Ghost: 57461,
      GhostFilled: 57462,
      Gift: 57463,
      GitBranch: 57464,
      GitCommit: 57465,
      GitDiff: 57466,
      GitFork: 57467,
      GitMerge: 57468,
      GitMergeConflict: 57469,
      GitMergedSimple: 57470,
      GitPullRequest: 57471,
      GitPullRequestClosed: 57472,
      GitPullRequestDraft: 57473,
      Globe: 57474,
      GraduationCap: 57475,
      Grid: 57476,
      Hand: 57477,
      HandHeart: 57478,
      Haptics: 57479,
      Help: 57480,
      History: 57481,
      Home: 57482,
      ID: 57483,
      Image: 57484,
      Indent: 57485,
      InfoSimple: 57486,
      Info: 57487,
      Interactive: 57488,
      Key: 57489,
      Keyboard: 57490,
      Laptop: 57491,
      LaptopFilled: 57492,
      LaptopSlash: 57493,
      Library: 57494,
      Lightbulb: 57495,
      Lightning: 57496,
      Link: 57497,
      LinkSimple: 57498,
      ListAdd: 57499,
      ListBullet: 57500,
      ListNumbered: 57501,
      Location: 57502,
      LocationQuestionMark: 57503,
      LocationSlash: 57504,
      Lock: 57505,
      LockOpen: 57506,
      LockShield: 57507,
      Logout: 57508,
      Mailbox: 57509,
      MapPin: 57510,
      Mcp: 57511,
      Memory: 57512,
      Mention: 57513,
      Menu: 57514,
      Microphone: 57515,
      MicrophoneFilled: 57516,
      MicrophoneSlash: 57517,
      Minus: 57518,
      MobilePhone: 57519,
      Moon: 57520,
      MoonFilled: 57521,
      MoonStars: 57522,
      Note: 57523,
      Notification: 57524,
      NotificationSlash: 57525,
      Organization: 57526,
      Owl: 57527,
      Palette: 57528,
      PaletteFilled: 57529,
      PaperPlane: 57530,
      Pause: 57531,
      Phone: 57532,
      Pin: 57533,
      PinFilled: 57534,
      PinSlash: 57535,
      Placeholder: 57536,
      Play: 57537,
      PlayCircle: 57538,
      PlayCircleFilled: 57539,
      PlayFilled: 57540,
      Plugin: 57541,
      Press: 57542,
      Pro: 57543,
      Prohibit: 57544,
      Projects: 57545,
      ProjectsFilled: 57546,
      ProjectsX: 57547,
      Prompt: 57548,
      Recording: 57549,
      Reorder: 57551,
      Research: 57552,
      Screenshare: 57553,
      Scroll: 57554,
      Search: 57555,
      SearchCircle: 57556,
      Select: 57557,
      Settings: 57558,
      Shapes: 57559,
      ArrowBendUpRight: 57560,
      ShareAndroid: 57561,
      Share: 57562,
      ShieldSearch: 57563,
      Shuffle: 57564,
      Sidebar: 57565,
      SidebarClose: 57566,
      SidebarOpen: 57567,
      Signpost: 57568,
      SlashShortcutCommand: 57569,
      Slides: 57570,
      Sort: 57571,
      Speaker: 57572,
      Spinner: 57573,
      Spreadsheet: 57574,
      Star: 57575,
      StarFilled: 57576,
      StarSlash: 57577,
      Stop: 57578,
      StopCircle: 57579,
      StopFilled: 57580,
      Styles: 57581,
      Sun: 57582,
      SunFilled: 57583,
      SunHorizon: 57584,
      Tasks: 57585,
      Team: 57586,
      Temperature: 57587,
      TemperatureSimple: 57588,
      TextAa: 57589,
      TextBold: 57590,
      TextItalics: 57591,
      TextUnderline: 57592,
      ThumbsDown: 57593,
      ThumbsDownFilled: 57594,
      ThumbsUp: 57595,
      ThumbsUpFilled: 57596,
      Timer: 57597,
      Toggles: 57598,
      Token: 57599,
      Tool: 57600,
      Trash: 57601,
      Trust: 57602,
      Upload: 57603,
      User: 57604,
      UserCircle: 57605,
      Users: 57606,
      Verified: 57607,
      Voice: 57608,
      Warning: 57609,
      WarningCircle: 57610,
      WarningShield: 57611,
      Workspace: 57612,
      Wrench: 57613,
      WrenchFilled: 57614,
      X: 57615,
      XCircle: 57616,
      GitMergeQueue: 57617,
      Orbit: 57618,
      SidebarRight: 57619,
      Bluetooth: 57621,
      BluetoothSlash: 57622,
      Bookmark: 57623,
      ComputerClassic: 57624,
      Linux: 57625,
      Windows: 57626,
      AgentSimple: 57627,
      AgentsSimple: 57628,
      ArrowClockwise: 57629,
      ArrowCounterClockwise: 57630,
      MinimizeBottomLeft: 57631,
      MinimizeBottomRight: 57632,
      MinimizeTopLeft: 57633,
      MinimizeTopRight: 57634,
      EyeFrame: 57635,
      Frame: 57636,
      Hammer: 57637,
      HealthConnect: 57638,
      Heart: 57639,
      Scale: 57640,
      ArrowDownLeft: 57641,
      ArrowDownRight: 57642,
      ArrowUpLeft: 57643,
      Bank: 57644,
      Goal: 57645,
      ProgressQuarter: 57646,
      UsageGaugeHigh: 57647,
      UsageGaugeMiddle: 57648,
      EditFilled: 57649,
      Quote: 57650,
      MemorySlash: 57651,
      AddLarge: 57652,
      Ticket: 57653,
      WindowNew: 57654,
      BookmarkFilled: 57655,
      AlignStretch: 57656,
      ArrowLine: 57657,
      Crop: 57658,
      Diagram: 57659,
      Dropdown: 57660,
      Eraser: 57661,
      EyeDropper: 57662,
      FrameHash: 57663,
      Heading1: 57664,
      Heading2: 57665,
      Heading3: 57666,
      JustifyCenter: 57667,
      LineHeight: 57668,
      LineSegment: 57669,
      Outdent: 57670,
      Sigma: 57671,
      Table: 57672,
      TextAlignCenter: 57673,
      TextAlignJustify: 57674,
      TextAlignLeft: 57675,
      TextAlignRight: 57676,
      TextHighlight: 57677,
      TextT: 57678,
      ZoomIn: 57679,
      ZoomOut: 57680,
      AlignCenter: 57681,
      AlignEnd: 57682,
      AlignStart: 57683,
      CornerBottomLeft: 57684,
      CornerBottomRight: 57685,
      CornerTopLeft: 57686,
      CornerTopRight: 57687,
      JustifyEnd: 57688,
      JustifySpaceBetween: 57689,
      JustifyStart: 57690,
      LetterSpacing: 57691,
      TableCellSplit: 57692,
      TableCellsMerge: 57693,
      TableColumnDelete: 57694,
      TableColumnInsertLeft: 57695,
      TableColumnInsertRight: 57696,
      TableRowDelete: 57697,
      TableRowInsertAbove: 57698,
      TableRowInsertBelow: 57699,
      Smiley: 57719,
      SmileyAdd: 57720,
      SideBottom: 57721,
      SideLeft: 57722,
      SideRight: 57723,
      SideTop: 57724,
      Comment: 57729,
      CommentFilled: 57730,
      FolderLink: 57732,
      ArrowBendUpLeft: 57733,
      Circle: 57734,
      Github: 57735,
      Images: 57736,
      SpeakerSlash: 57737,
      CirclesAdd: 57738,
    },
    secondary: {
      AlignCenter: 57700,
      AlignEnd: 57701,
      AlignStart: 57702,
      CornerBottomLeft: 57703,
      CornerBottomRight: 57704,
      CornerTopLeft: 57705,
      CornerTopRight: 57706,
      JustifyEnd: 57707,
      JustifySpaceBetween: 57708,
      JustifyStart: 57709,
      LetterSpacing: 57710,
      TableCellSplit: 57711,
      TableCellsMerge: 57712,
      TableColumnDelete: 57713,
      TableColumnInsertLeft: 57714,
      TableColumnInsertRight: 57715,
      TableRowDelete: 57716,
      TableRowInsertAbove: 57717,
      TableRowInsertBelow: 57718,
      SideBottom: 57725,
      SideLeft: 57726,
      SideRight: 57727,
      SideTop: 57728,
      JustifyCenter: 57731,
    },
    next: 57739,
    wght: {
      16: {
        lo: 0.8,
        hi: 1.25,
      },
      20: {
        lo: 1.125,
        hi: 1.8,
      },
    },
    anim: [
      `Artifacts`,
      `Chart`,
      `Chats`,
      `Clock`,
      `Code`,
      `Download`,
      `Lightbulb`,
      `Palette`,
      `Projects`,
      `Signpost`,
      `Tasks`,
      `Tool`,
    ],
    animLoop: [`Code`],
    animDur: {
      Palette: 800,
    },
    animDurOut: {
      Palette: 0,
    },
    animEase: {
      Palette: `ease-out`,
    },
  });
  (UiOverlaysAndIconsMaster = {
    xs: {
      px: 12,
      master: `small`,
      stroke: {
        regular: 0.8,
      },
    },
    sm: {
      px: 16,
      master: `small`,
      stroke: {
        regular: 1,
        strong: 1.25,
      },
    },
    md: {
      px: 20,
      master: `base`,
      stroke: {
        regular: 1.2,
        strong: 1.5,
      },
    },
    lg: {
      px: 24,
      master: `base`,
      stroke: {
        regular: 1.4,
      },
    },
    xl: {
      px: 28,
      master: `base`,
      stroke: {
        regular: 1.6,
      },
    },
    xxl: {
      px: 32,
      master: `base`,
      stroke: {
        regular: 1.8,
      },
    },
  });
  (uiOverlaysAndIconsXsSmMdLgValues = [`xs`, `sm`, `md`, `lg`, `xl`, `xxl`]);
  (UiOverlaysAndIconsMd = `md`);
  (UiOverlaysAndIconsIcons2 = UiOverlaysAndIconsIcons.icons);
  (UiOverlaysAndIconsSecondary = UiOverlaysAndIconsIcons.secondary ?? {});
  (uiOverlaysAndIconsSet = new (Set as Dynamic)(
    UiOverlaysAndIconsIcons.anim ?? [],
  ));
  (uiOverlaysAndIconsSet2 = new (Set as Dynamic)(
    UiOverlaysAndIconsIcons.animLoop ?? [],
  ));
  (UiOverlaysAndIconsAnimDur = UiOverlaysAndIconsIcons.animDur ?? {});
  (UiOverlaysAndIconsAnimDurOut = UiOverlaysAndIconsIcons.animDurOut ?? {});
  (UiOverlaysAndIconsAnimEase = UiOverlaysAndIconsIcons.animEase ?? {});
  (UiOverlaysAndIconsWght = UiOverlaysAndIconsIcons.wght);
  ([uiOverlaysAndIconsState, uiOverlaysAndIconsState2] = [400, 700]);
  (UiOverlaysAndIconsFlexShrink = {
    flexShrink: 0,
  });
  (UiOverlaysAndIconsXxl = Object.freeze({
    xs: resolveUiOverlaysAndIconsStroke(`xs`),
    sm: resolveUiOverlaysAndIconsStroke(`sm`),
    md: resolveUiOverlaysAndIconsStroke(`md`),
    lg: resolveUiOverlaysAndIconsStroke(`lg`),
    xl: resolveUiOverlaysAndIconsStroke(`xl`),
    xxl: resolveUiOverlaysAndIconsStroke(`xxl`),
  }));
}

export { UiOverlaysAndIconsCreateContext, UiOverlaysAndIconsCreateContext2, UiOverlaysAndIconsCreateContext3, UiOverlaysAndIconsCreateContext4, UiOverlaysAndIconsCreateContext6, UiOverlaysAndIconsDataCdsOverlay, UiOverlaysAndIconsMaster, UiOverlaysAndIconsStyles, resolveUiOverlaysAndIconsValue, resolveUiOverlaysAndIconsValue2, resolveUiOverlaysAndIconsValue3, resolveUiOverlaysAndIconsValue4, resolveUiOverlaysAndIconsValue5, resolveUiOverlaysAndIconsValue6, resolveUiOverlaysAndIconsValue7, resolveUiOverlaysAndIconsValue9, useUiOverlaysAndIconsUseInsertionEffect, useUiOverlaysAndIconsUseInsertionEffect2 };
