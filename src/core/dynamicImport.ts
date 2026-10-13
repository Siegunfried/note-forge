/**
 * 打包安全的动态导入。
 * `new Function("return import(specifier)")` 里的裸说明符会按 process.cwd() 解析；
 * 打包安装到 VS Code 后 cwd 是用户打开的工作区，而非扩展目录，会报 ERR_MODULE_NOT_FOUND。
 * 这里基于本模块文件位置解析到「扩展自带 node_modules」内的绝对路径，再以 file:// URL 动态导入，
 * 保证无论 cwd 如何都能正确加载。
 */

import * as path from "path";
import { pathToFileURL } from "url";

/** 在 CommonJS 输出下保留真正的动态 import（TS 会把 import() 编译成 require，这里绕开以加载 ESM）。 */
const dynamicImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<any>;

/** 扩展根目录：编译后本文件位于 out/core/，向上两级即扩展根。 */
const extensionRoot = path.resolve(__dirname, "..", "..");

/** 解析扩展自带 node_modules 内某包/子路径的绝对文件路径。 */
export function resolveExtensionModule(specifier: string): string {
  return path.join(extensionRoot, "node_modules", specifier);
}

/** 扩展自带模块的 file:// URL（字符串形式）。 */
export function resolveExtensionUrl(specifier: string): string {
  return pathToFileURL(resolveExtensionModule(specifier)).href;
}

/** 动态导入扩展自带的模块（支持 ESM .mjs 文件与 CJS 包内具体文件）。 */
export async function importExtensionModule(specifier: string): Promise<any> {
  return dynamicImport(resolveExtensionUrl(specifier));
}

let pdfjsPromise: Promise<any> | undefined;

/**
 * 加载 pdfjs-dist（legacy build），并设置 workerSrc 指向扩展自带的 worker 文件。
 * pdfjs-dist 4.x 即使 disableWorker 走「假 worker」，也要 GlobalWorkerOptions.workerSrc 才能
 * 主线程 import worker 模块，否则抛「No GlobalWorkerOptions.workerSrc specified」。
 */
export function loadPdfjs(): Promise<any> {
  if (!pdfjsPromise) {
    pdfjsPromise = importExtensionModule("pdfjs-dist/legacy/build/pdf.mjs").then((pdfjs) => {
      try {
        pdfjs.GlobalWorkerOptions.workerSrc = resolveExtensionUrl(
          "pdfjs-dist/legacy/build/pdf.worker.mjs",
        );
      } catch {
        // workerSrc 设置失败不阻塞主线程解析；忽略。
      }
      return pdfjs;
    });
  }
  return pdfjsPromise;
}