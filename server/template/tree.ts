import { createElement, type ReactNode } from "react";
import * as PDF from "@react-pdf/renderer";
import type { CvTemplate } from "../../src/templates";
import { components } from "./guest";

const styleKeys = new Set(`fontFamily fontSize fontWeight fontStyle color backgroundColor lineHeight letterSpacing textAlign textDecoration textTransform opacity display position top right bottom left width height minWidth maxWidth minHeight maxHeight flex flexDirection flexWrap flexGrow flexShrink flexBasis alignItems alignSelf justifyContent gap rowGap columnGap padding paddingTop paddingRight paddingBottom paddingLeft paddingHorizontal paddingVertical margin marginTop marginRight marginBottom marginLeft marginHorizontal marginVertical borderWidth borderTopWidth borderBottomWidth borderLeftWidth borderRightWidth borderColor borderTopColor borderBottomColor borderLeftColor borderRightColor borderStyle borderRadius`.split(" "));
const propsAllowed = new Set(`style key id wrap break fixed minPresenceAhead orphans widows size orientation title author subject keywords creator producer language src d fill stroke strokeWidth cx cy r rx ry x y x1 x2 y1 y2 width height viewBox points transform clipPath fillRule`.split(" "));
const builtInFonts = new Set(["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique", "Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic", "Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"]);

export function registerFonts(template: Pick<CvTemplate, "fonts">) {
  const variants = new Set<string>();
  for (const font of template.fonts) {
    const key = `${font.family}/${font.weight}/${font.style}`;
    if (builtInFonts.has(font.family) || variants.has(key)) throw new Error("Duplicate or reserved font family/variant");
    variants.add(key);
    const data = Buffer.from(font.data, "base64");
    if (data.toString("base64") !== font.data || data.length > 1_050_000 || !["00010000", "4f54544f"].includes(data.subarray(0, 4).toString("hex"))) throw new Error("Fonts must be valid base64 TTF or OTF files");
    PDF.Font.register({ family: font.family, src: `data:font/ttf;base64,${font.data}`, fontWeight: font.weight, fontStyle: font.style });
  }
  PDF.Font.registerHyphenationCallback(word => [word]);
}

export function buildTree(value: unknown, template: Pick<CvTemplate, "fonts">): ReactNode {
  let count = 0;
  const fonts = new Set([...builtInFonts, ...template.fonts.map(f => f.family)]);
  function styles(value: unknown, depth = 0): unknown {
    if (depth > 8) throw new Error("Style nesting exceeds limit");
    if (Array.isArray(value)) return value.map(v => styles(v, depth + 1));
    if (value === null || value === false || value === undefined) return {};
    if (typeof value !== "object") throw new Error("Invalid style");
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (!styleKeys.has(key) || !["number", "string"].includes(typeof item) || (typeof item === "number" && (!Number.isFinite(item) || Math.abs(item) > 10000)) || (typeof item === "string" && (item.length > 100 || /url\s*\(|[<>]/i.test(item)))) throw new Error(`Unsupported style: ${key}`);
      if (key === "fontFamily" && !fonts.has(String(item))) throw new Error("Font family must be a PDF built-in or supplied asset");
      if (key === "fontSize" && (typeof item !== "number" || item < 6 || item > 96)) throw new Error("Font size must be 6–96pt");
      output[key] = item;
    }
    return output;
  }
  function visit(node: unknown, depth: number, parent: string): ReactNode {
    if (++count > 10000 || depth > 50) throw new Error("Template tree exceeds limits");
    if (node === null || typeof node === "boolean") return null;
    if (typeof node === "string" || typeof node === "number") {
      if (parent !== "Text" && parent !== "Link") {
        if (String(node).trim()) throw new Error("Text must be inside Text or Link");
        return null;
      }
      return String(node);
    }
    if (Array.isArray(node)) return node.map(n => visit(n, depth + 1, parent));
    if (!node || typeof node !== "object") throw new Error("Invalid template node");
    const { type, props, children } = node as { type: string; props: Record<string, unknown>; children: unknown[] };
    if (type === "Fragment") return visit(children, depth + 1, parent);
    if (!(components as readonly string[]).includes(type) || !props || !Array.isArray(children)) throw new Error("Unsupported PDF component");
    if ((parent === "root" && type !== "Document") || (type === "Document" && parent !== "root") || (parent === "Document" && type !== "Page") || (type === "Page" && parent !== "Document")) throw new Error("Expected Document containing Page components");
    const clean: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(props)) {
      if (!propsAllowed.has(key)) throw new Error(`Unsupported component prop: ${key}`);
      if (key === "style") { clean.style = styles(item); continue; }
      if (!["string", "number", "boolean"].includes(typeof item) || String(item).length > 20000 || (typeof item === "number" && (!Number.isFinite(item) || Math.abs(item) > 10000))) throw new Error(`Invalid prop: ${key}`);
      if (key === "src" && (type !== "Link" || !/^(https?:\/\/|mailto:|tel:)/i.test(String(item)))) throw new Error("Only HTTP, mailto or tel links are supported");
      if (key === "size" && !["A4", "LETTER", "LEGAL", "A5"].includes(String(item))) throw new Error("Unsupported paper size");
      clean[key] = item;
    }
    if (type === "Page" && !clean.style) clean.style = { fontFamily: "Helvetica" };
    return createElement(PDF[type as keyof typeof PDF] as unknown as React.ComponentType<Record<string, unknown>>, clean, ...children.map(n => visit(n, depth + 1, type)));
  }
  return visit(value, 0, "root");
}
