import { useEffect, useRef } from "react";
import type { RichTextBlock, RichTextSpan } from "./types";

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function spansToHtml(spans: RichTextSpan[]): string {
  return spans.map((span) => {
    let value = escapeHtml(span.text).replaceAll("\n", "<br>");
    if (span.bold) value = `<strong>${value}</strong>`;
    if (span.italic) value = `<em>${value}</em>`;
    return value;
  }).join("");
}

function modelToHtml(blocks: RichTextBlock[]): string {
  let html = "";
  let listOpen = false;
  for (const block of blocks) {
    if (block.type === "bullet") {
      if (!listOpen) { html += "<ul>"; listOpen = true; }
      html += `<li>${spansToHtml(block.spans)}</li>`;
    } else {
      if (listOpen) { html += "</ul>"; listOpen = false; }
      html += `<p>${spansToHtml(block.spans)}</p>`;
    }
  }
  return html + (listOpen ? "</ul>" : "");
}

function readSpans(node: Node, marks: Pick<RichTextSpan, "bold" | "italic"> = {}): RichTextSpan[] {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ? [{ text: node.textContent, ...marks }] : [];
  if (!(node instanceof HTMLElement)) return [];
  if (node.tagName === "BR") return [{ text: "\n", ...marks }];
  const nextMarks = {
    ...marks,
    bold: marks.bold || node.tagName === "STRONG" || node.tagName === "B",
    italic: marks.italic || node.tagName === "EM" || node.tagName === "I",
  };
  return Array.from(node.childNodes).flatMap((child) => readSpans(child, nextMarks));
}

function htmlToModel(root: HTMLElement): RichTextBlock[] {
  const blocks: RichTextBlock[] = [];
  for (const child of Array.from(root.childNodes)) {
    if (child instanceof HTMLUListElement || child instanceof HTMLOListElement) {
      for (const item of Array.from(child.children)) {
        const spans = readSpans(item);
        if (spans.some((span) => span.text.trim())) blocks.push({ type: "bullet", spans });
      }
      continue;
    }
    const spans = readSpans(child);
    if (spans.some((span) => span.text.trim())) blocks.push({ type: "paragraph", spans });
  }
  return blocks.length ? blocks : [{ type: "paragraph", spans: [] }];
}

export function RichTextEditor({ value, onChange, label }: {
  value: RichTextBlock[];
  onChange: (value: RichTextBlock[]) => void;
  label: string;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastValue = useRef("");
  const html = modelToHtml(value);

  useEffect(() => {
    if (editorRef.current && html !== lastValue.current) editorRef.current.innerHTML = html;
    lastValue.current = html;
  }, [html]);

  const format = (command: "bold" | "italic" | "insertUnorderedList") => {
    editorRef.current?.focus();
    document.execCommand(command);
    if (editorRef.current) {
      const next = htmlToModel(editorRef.current);
      lastValue.current = modelToHtml(next);
      onChange(next);
    }
  };

  return (
    <div className="rich-field">
      <span className="field-label">{label}</span>
      <div className="rich-toolbar" aria-label={`${label} formatting`}>
        <button type="button" aria-label="Bold" onMouseDown={(event) => event.preventDefault()} onClick={() => format("bold")}><strong>B</strong></button>
        <button type="button" aria-label="Italic" onMouseDown={(event) => event.preventDefault()} onClick={() => format("italic")}><em>I</em></button>
        <button type="button" aria-label="Bulleted list" onMouseDown={(event) => event.preventDefault()} onClick={() => format("insertUnorderedList")}>• List</button>
      </div>
      <div
        ref={editorRef}
        className="rich-editor"
        contentEditable
        role="textbox"
        aria-label={label}
        aria-multiline="true"
        suppressContentEditableWarning
        onInput={(event) => {
          const next = htmlToModel(event.currentTarget);
          lastValue.current = modelToHtml(next);
          onChange(next);
        }}
      />
    </div>
  );
}
