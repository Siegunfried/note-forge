/**
 * PDF 文本提取：用 pdfjs-dist 提取带字号/坐标的文本块（DocBlock[]）。
 * 仅运行时加载；用真正的动态 import 加载 ESM 构建，避免 TS(commonjs) 把 import() 编译成 require 后无法加载 .mjs。
 */

import { DocBlock } from "./pdfImport";

/** 在 CommonJS 输出下保留真正的动态 import（TS 会把 import() 编译成 require，这里绕开以加载 ESM）。 */
const dynamicImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<any>;

/** 从 PDF 二进制数据提取文本块（带字号/坐标/页码）。 */
export async function extractPdfBlocks(
  data: ArrayBuffer | Uint8Array,
): Promise<DocBlock[]> {
  const pdfjs = await dynamicImport("pdfjs-dist/legacy/build/pdf.mjs");
  const buffer = data instanceof Uint8Array ? data : new Uint8Array(data);
  const doc = await pdfjs.getDocument({ data: buffer, disableWorker: true }).promise;

  const blocks: DocBlock[] = [];
  for (let page = 0; page < doc.numPages; page++) {
    const pageObj = await doc.getPage(page + 1);
    const content = await pageObj.getTextContent();
    for (const item of content.items) {
      const text = item.str ?? "";
      if (text.trim() === "") {
        continue;
      }
      // pdfjs 文本矩阵 transform = [a, b, c, d, e, f]：a/d 是缩放，e/f 是平移。
      const tr = item.transform as number[] | undefined;
      const scale = tr ? Math.hypot(tr[0] ?? 1, tr[1] ?? 0) : 0;
      blocks.push({
        text,
        fontSize: scale > 0 ? scale : undefined,
        y: tr ? (tr[5] ?? 0) : 0,
        x: tr ? (tr[4] ?? 0) : 0,
        page,
        bold: detectBold(item),
      });
    }
  }
  await doc.destroy();
  return blocks;
}

/** 依据字体名判断是否粗体（pdfjs 不直接暴露字重）。 */
function detectBold(item: any): boolean {
  const name = typeof item.fontName === "string" ? item.fontName.toLowerCase() : "";
  return /bold|black|heavy|semibold|demi/i.test(name);
}