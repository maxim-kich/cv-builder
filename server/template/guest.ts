import { build } from "esbuild";
import { getQuickJS } from "quickjs-emscripten";
import type { ResumeData } from "../../src/types";

export const components = ["Document", "Page", "View", "Text", "Link", "Svg", "Path", "Rect", "Circle", "Line", "Polygon", "Polyline", "Ellipse", "G", "Defs", "ClipPath"] as const;

// All imports resolve to virtual modules. No source is evaluated by Node or React.
export async function evaluateTemplate(source: string, resume: ResumeData, showLanguageDots: boolean): Promise<unknown> {
  const compiled = await build({
    stdin: { contents: source, loader: "tsx", resolveDir: "/" },
    bundle: true, write: false, format: "iife", globalName: "Template", platform: "neutral",
    jsxFactory: "__pdf.h", jsxFragment: "__pdf.Fragment", logLevel: "silent",
    plugins: [{ name: "guest-imports", setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        if (!["react", "@react-pdf/renderer"].includes(args.path)) throw new Error("Only react and @react-pdf/renderer imports are supported");
        return { path: args.path, namespace: "guest" };
      });
      builder.onLoad({ filter: /.*/, namespace: "guest" }, args => ({ contents: args.path === "react"
        ? "export const createElement = __pdf.h; export const Fragment = __pdf.Fragment; export default {createElement, Fragment};"
        : components.map(name => `export const ${name} = '${name}';`).join("\n") + "\nexport const StyleSheet = {create: v => v};", loader: "js" }));
    } }],
  });
  const engine = await getQuickJS();
  const runtime = engine.newRuntime();
  runtime.setMemoryLimit(24 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  const deadline = Date.now() + 1000;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const context = runtime.newContext();
  try {
    const program = `
      const __pdf = {
        Fragment: 'Fragment',
        h(type, props, ...children) {
          if (typeof type === 'function') return type({...props, children});
          return {type, props: props || {}, children};
        }
      };
      ${compiled.outputFiles[0].text}
      JSON.stringify(__pdf.h(Template.default, {resume: ${JSON.stringify(resume)}, showLanguageDots: ${JSON.stringify(showLanguageDots)}}));
    `;
    const result = context.evalCode(program);
    if (result.error) { result.error.dispose(); throw new Error("Template execution failed or exceeded limits"); }
    try {
      const serialized = context.getString(result.value);
      if (serialized.length > 2_000_000) throw new Error("Template output exceeds limit");
      return JSON.parse(serialized);
    } finally { result.value.dispose(); }
  } finally { context.dispose(); runtime.dispose(); }
}
