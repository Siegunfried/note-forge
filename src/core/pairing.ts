/**
 * 「源 / 成品」配对解析：决定这次整理读哪个文件、写到哪个文件。
 * 纯逻辑、无 VSCode 依赖，便于单测。
 *
 * 约定（两条数据流）：
 * - xxx.forge 是只读「原文速记」；生成的成品写到同名 xxx.md，永不覆盖 .forge。
 * - xxx.md 若存在同名 xxx.forge，则从 .forge 读原文、写回当前 .md。
 * - 其余情况就地整理（兼容旧行为）。
 */

import * as fs from "fs";
import * as path from "path";

type PairingMode = "forge" | "md-linked" | "inline";

export interface Pairing {
  mode: PairingMode;
  /** 原文来源文件绝对路径。 */
  sourcePath: string;
  /** 成品目标文件绝对路径。 */
  targetPath: string;
}

/** 把文件路径的后缀替换为指定后缀。 */
function withExt(filePath: string, ext: string): string {
  const base = filePath.slice(0, filePath.length - path.extname(filePath).length);
  return base + ext;
}

/** 解析当前文档的「源 / 成品」配对关系。 */
export function resolvePairing(docPath: string): Pairing {
  if (path.extname(docPath).toLowerCase() === ".forge") {
    return {
      mode: "forge",
      sourcePath: docPath,
      targetPath: withExt(docPath, ".md"),
    };
  }

  const siblingForge = withExt(docPath, ".forge");
  if (fs.existsSync(siblingForge)) {
    return { mode: "md-linked", sourcePath: siblingForge, targetPath: docPath };
  }

  return { mode: "inline", sourcePath: docPath, targetPath: docPath };
}
