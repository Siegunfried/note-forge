/**
 * 引用解析：从速记中提取 `@ 路径` 引用，读取本地文件内容（md / txt / pdf），供 AI 参考。
 * 纯逻辑 + Node fs 依赖，便于单测。
 */

import * as fs from "fs";
import * as path from "path";

/** 一条 @ 引用。 */
export interface Reference {
  /** 来源：本地文件绝对路径，或 URL。 */
  source: string;
  /** 本地文件读到的文本；URL 或读取失败时为空。 */
  content: string;
  /** 是否本地文件（false = URL，交给 AI 联网）。 */
  isFile: boolean;
  /** 读取失败原因（可选）。 */
  error?: string;
}

/** 从速记文本提取所有 `@ 路径` 引用（仅行首单行 `@ xxx`）。 */
export function extractReferences(rawText: string): string[] {
  const sources: string[] = [];
  for (const line of rawText.split("\n")) {
    const m = line.match(/^@\s+(.+)$/);
    if (m && m[1].trim()) {
      sources.push(m[1].trim());
    }
  }
  return sources;
}

/** 判断是否为 URL。 */
function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

/** 读取引用内容；本地文件读文本（含 PDF），URL 留空交给 AI。 */
export async function loadReferences(
  sources: string[],
  baseDir: string,
): Promise<Reference[]> {
  const refs: Reference[] = [];
  for (const s of sources) {
    if (isUrl(s)) {
      refs.push({ source: s, content: "", isFile: false });
      continue;
    }
    const abs = path.isAbsolute(s) ? s : path.resolve(baseDir, s);
    try {
      const content = await readFileText(abs);
      refs.push({ source: abs, content, isFile: true });
    } catch (err) {
      refs.push({
        source: abs,
        content: "",
        isFile: true,
        error: (err as Error)?.message ?? String(err),
      });
    }
  }
  return refs;
}

/** 把引用拼成「参考材料」Markdown 段；无可用内容时返回空串。 */
export function buildReferenceSection(refs?: Reference[]): string {
  if (!refs?.length) {
    return "";
  }
  const blocks = refs
    .filter((r) => r.content.trim())
    .map((r) => `## 来源：${r.source}\n\n${r.content.trim()}`);
  if (!blocks.length) {
    return "";
  }
  return (
    `# 参考材料（@ 引用的文档，据此补充 / 对照，成品中标明来源）\n\n` +
    blocks.join("\n\n") +
    `\n`
  );
}

/** 读文件文本：pdf 走解析，其余按 UTF-8 读。 */
async function readFileText(filePath: string): Promise<string> {
  if (path.extname(filePath).toLowerCase() === ".pdf") {
    return readPdfText(filePath);
  }
  return fs.promises.readFile(filePath, "utf-8");
}

/** pdfjs-dist 的最小类型（legacy build 无完整声明）。 */
interface PdfTextItem {
  str: string;
  transform?: number[];
}

interface PdfJsModule {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (opts: {
    data: Uint8Array;
    verbosity: number;
  }) => {
    promise: Promise<{
      numPages: number;
      getPage: (n: number) => Promise<{
        getTextContent: () => Promise<{ items: PdfTextItem[] }>;
      }>;
    }>;
  };
}

/** PDF 文本提取（pdfjs-dist，中文支持更好；按行重建 + 清理 + 扫描版检测）。 */
async function readPdfText(filePath: string): Promise<string> {
  // 只做文本提取，不需要 canvas 渲染；预先占位避免 pdfjs 尝试 polyfill 的告警。
  const g = globalThis as any;
  if (!g.DOMMatrix) {
    g.DOMMatrix = class {};
  }
  if (!g.Path2D) {
    g.Path2D = class {};
  }

  // 懒加载 pdfjs-dist，避免未安装时直接崩溃。
  const pdfjs = require("pdfjs-dist/legacy/build/pdf.js") as PdfJsModule;
  pdfjs.GlobalWorkerOptions.workerSrc = require.resolve(
    "pdfjs-dist/legacy/build/pdf.worker.js",
  );

  const buf = await fs.promises.readFile(filePath);
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    verbosity: 0,
  }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = reconstructLines(content.items);
    if (pageText) {
      pages.push(pageText);
    }
  }

  const text = pages.join("\n\n");
  if (text.replace(/\s/g, "").length < 50) {
    throw new Error(
      `该 PDF 可能是扫描版（无文本层），共 ${doc.numPages} 页但几乎提取不到文字`,
    );
  }
  return text;
}

/** 按 y 坐标把文本项重建成行，并清理控制字符 / 压缩空白。 */
function reconstructLines(items: PdfTextItem[]): string {
  const lines: string[] = [];
  let cur = "";
  let lastY: number | null = null;
  for (const it of items) {
    const y = it.transform?.[5] ?? 0;
    if (lastY !== null && Math.abs(y - lastY) > 1.5) {
      lines.push(cur);
      cur = "";
    }
    cur += it.str ?? "";
    lastY = y;
  }
  if (cur) {
    lines.push(cur);
  }
  return lines
    .map(cleanLine)
    .filter((l) => l.length > 0)
    .join("\n");
}

/** 去掉控制字符（0x00–0x1F、0x7F），压缩空白。 */
function cleanLine(s: string): string {
  const chars = s.split("").filter((ch) => {
    const c = ch.charCodeAt(0);
    return c >= 0x20 && c !== 0x7f;
  });
  return chars.join("").replace(/\s+/g, " ").trim();
}
