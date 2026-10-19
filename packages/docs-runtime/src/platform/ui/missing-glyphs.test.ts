import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  MISSING_GLYPH_ALIASES,
  MISSING_GLYPH_DRAWINGS,
  MissingGlyphSvg,
} from "./missing-glyphs";
import {
  initializeUiOverlaysAndIconsStep1,
  UiOverlaysAndIconsCustomIcon,
} from "./overlays-and-icons";

vi.mock("../dependencies", () => ({ React }));
// 图标按界面密度选默认尺寸；测试只传 customSize，密度固定为 comfortable。
vi.mock("./provider-and-layers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./provider-and-layers")>()),
  resolveUiProviderAndLayersUseContext2: () => "comfortable",
}));

function attribute(markup: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(markup)?.[1];
}

describe("MissingGlyphSvg", () => {
  it("uses the 16 grid up to 18px and converts the stroke to grid units", () => {
    const drawing = MISSING_GLYPH_DRAWINGS.Heading1!;
    const small = renderToStaticMarkup(
      createElement(MissingGlyphSvg, { drawing, px: 16, strokePx: 1 }),
    );
    expect(attribute(small, "viewBox")).toBe("0 0 16 16");
    expect(attribute(small, "stroke-width")).toBe("1");
    const custom = renderToStaticMarkup(
      createElement(MissingGlyphSvg, { drawing, px: 14, strokePx: 1 }),
    );
    expect(attribute(custom, "viewBox")).toBe("0 0 16 16");
    expect(attribute(custom, "stroke-width")).toBe("1.143");
    const medium = renderToStaticMarkup(
      createElement(MissingGlyphSvg, { drawing, px: 20, strokePx: 1.2 }),
    );
    expect(attribute(medium, "viewBox")).toBe("0 0 20 20");
    expect(attribute(medium, "stroke-width")).toBe("1.2");
  });

  it("falls back to the other grid when one is empty", () => {
    const markup = renderToStaticMarkup(
      createElement(MissingGlyphSvg, {
        drawing: { master16: [], master20: [{ cx: 10, cy: 10, r: 7 }] },
        px: 16,
        strokePx: 1,
      }),
    );
    expect(attribute(markup, "viewBox")).toBe("0 0 20 20");
    expect(markup).toContain("<circle");
  });
});

describe("UiOverlaysAndIconsCustomIcon missing glyph fallback", () => {
  beforeAll(() => {
    initializeUiOverlaysAndIconsStep1();
  });

  it("draws names that have an original drawing as SVG at the font icon size", () => {
    for (const name of Object.keys(MISSING_GLYPH_DRAWINGS)) {
      const markup = renderToStaticMarkup(
        createElement(UiOverlaysAndIconsCustomIcon, { name, customSize: 20, bold: true }),
      );
      expect(markup.startsWith("<svg")).toBe(true);
      expect(attribute(markup, "data-icon")).toBe(name);
      expect(attribute(markup, "data-cds")).toBe("Icon");
      expect(attribute(markup, "viewBox")).toBe("0 0 20 20");
      expect(attribute(markup, "aria-hidden")).toBe("true");
      expect(markup).not.toMatch(/customsize|bold=/i);
    }
  });

  it("maps aliased names to a glyph the icon table has", () => {
    for (const [name, target] of Object.entries(MISSING_GLYPH_ALIASES)) {
      expect(MISSING_GLYPH_DRAWINGS[target]).toBeUndefined();
      const aliased = renderToStaticMarkup(
        createElement(UiOverlaysAndIconsCustomIcon, { name }),
      );
      const direct = renderToStaticMarkup(
        createElement(UiOverlaysAndIconsCustomIcon, { name: target }),
      );
      expect(aliased).toBe(direct);
      expect(aliased).toMatch(/[-]/u);
    }
  });
});
