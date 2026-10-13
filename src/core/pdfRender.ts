/**
 * PDF 页面渲染：把扫描版 PDF 页面渲染成 PNG 图片，供视觉模型 OCR。
 * 用 pdfjs-dist 渲染 + @napi-rs/canvas 离屏画布（Electron/Node 无 DOM canvas，走原生离屏实现）。
 */

import { importExtensionModule, loadPdfjs } from "./dynamicImport";

/** 一张渲染好的页面图片。 */
export interface PageImage {
  /** PNG 二进制数据。 */
  png: Buffer;
  /** 页码（0-based）。 */
  page: number;
}

/** 渲染结果：已渲染图片 + 文档总页数。 */
export interface RenderResult {
  images: PageImage[];
  total: number;
}

/** 默认渲染缩放（相对 72dpi，2 倍 ≈ 144dpi，够 OCR 用）。 */
const DEFAULT_SCALE = 2;

/** 把 PDF 二进制渲染成页面 PNG（最多 maxPages 页）。 */
export async function renderPagesToImages(
  data: Uint8Array,
  maxPages: number,
  scale: number = DEFAULT_SCALE,
): Promise<RenderResult> {
  const pdfjs = await loadPdfjs();
  const canvasMod = await importExtensionModule("@napi-rs/canvas/index.js");
  const createCanvas = canvasMod.createCanvas ?? canvasMod.default?.createCanvas;

  const doc = await pdfjs.getDocument({ data, disableWorker: true }).promise;
  const total = doc.numPages;
  const count = Math.max(0, Math.min(total, maxPages));
  const images: PageImage[] = [];
  try {
    for (let page = 0; page < count; page++) {
      const pageObj = await doc.getPage(page + 1);
      const viewport = pageObj.getViewport({ scale });
      const canvas = createCanvas(viewport.width, viewport.height);
      const ctx = canvas.getContext("2d");
      await pageObj.render({ canvasContext: ctx, viewport }).promise;
      images.push({ png: await encodePng(canvas), page });
    }
  } finally {
    await doc.destroy();
  }
  return { images, total };
}

/** 把离屏画布编码成 PNG Buffer（兼容 @napi-rs/canvas 新旧 API）。 */
async function encodePng(canvas: any): Promise<Buffer> {
  if (typeof canvas.encode === "function") {
    return (await canvas.encode("png")) as Buffer;
  }
  if (typeof canvas.toBuffer === "function") {
    return (await canvas.toBuffer("image/png")) as Buffer;
  }
  throw new Error("离屏画布既不支持 encode 也不支持 toBuffer，无法输出 PNG");
}