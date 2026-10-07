/**
 * 语法校验：检查 .forge 每行的符号组合是否符合「结构/内容/形式/修饰」规则。
 * 纯逻辑、无 VSCode 依赖，便于单测。
 *
 * 规则（定稿）：
 * - 一行符号序列 = [结构?] + [内容?] + [形式?] + [修饰?]，每类至多 1 个。
 * - 无符号行 = #（标题）的简写，合法。
 * - 修饰符 ! 可叠加在任何类别上，不影响其他类的计数。
 *
 * 注意：这里只校验「符号组合」，不校验缩进层级（缩进跳级等属于树解析层）。
 */

import { SYMBOL_BY_CHAR, SymbolKind } from "./symbols";

/** 一类符号最多允许的个数。 */
const KIND_MAX: Record<SymbolKind, number> = {
  structure: 1,
  content: 1,
  form: 1,
  emphasis: 1,
};

/** 语法错误。 */
export interface SyntaxIssue {
  /** 0-based 行号。 */
  line: number;
  /** 出错行原文（trim 后）。 */
  rawLine: string;
  /** 出错的符号串（如 "?#"）。 */
  symbols: string;
  /** 人类可读的错误信息。 */
  message: string;
}

/**
 * 校验整篇 .forge 文本，返回所有语法错误（空数组表示无错误）。
 * @param text 完整 .forge 文本。
 */
export function validateSyntax(text: string): SyntaxIssue[] {
  const issues: SyntaxIssue[] = [];
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "");
    const trimmed = line.trim();
    if (trimmed === "") {
      continue; // 空行跳过
    }

    // 提取行首符号串（去缩进后的行首连续符号字符）。
    const m = trimmed.match(/^[^\s]+/);
    const firstToken = m ? m[0] : "";
    // 符号串 = firstToken 前缀里的连续符号字符。
    const symbolMatch = firstToken.match(/^[%?#$~*_@=&!]+/);
    const symbols = symbolMatch ? symbolMatch[0] : "";

    // 无符号行 = # 简写，合法。
    if (symbols === "") {
      continue;
    }

    // @ 引用指令（@ 后必须空格）不是内容节点，由 references 单独处理；跳过符号组合校验。
    if (/^@\s/.test(trimmed)) {
      continue;
    }

    // 统计各类别数量。
    const count: Record<SymbolKind, number> = {
      structure: 0,
      content: 0,
      form: 0,
      emphasis: 0,
    };
    for (const ch of symbols) {
      const def = SYMBOL_BY_CHAR.get(ch);
      if (!def) {
        // 不该发生：SYMBOL_CHARS 之外的字符。防御性跳过。
        continue;
      }
      count[def.kind]++;
    }

    // 检查每类是否超限。
    for (const kind of Object.keys(KIND_MAX) as SymbolKind[]) {
      if (count[kind] > KIND_MAX[kind]) {
        issues.push({
          line: i,
          rawLine: trimmed,
          symbols,
          message: describeConflict(kind, symbols),
        });
        break; // 一行只报第一个错误，避免刷屏
      }
    }
  }

  return issues;
}

/** 生成可读的错误描述。 */
function describeConflict(kind: SymbolKind, symbols: string): string {
  const labels: Record<SymbolKind, string> = {
    structure: "结构符号（# 标题 / % 思考 / ? 疑问）",
    content: "内容符号（$ 定义 / ~ 公式化 / * 深挖 / _ 补全 / @ 引用）",
    form: "形式符号（= 举例 / & 对比）",
    emphasis: "修饰符号（! 重点）",
  };
  return `符号「${symbols}」含有多个${labels[kind]}，一行至多 1 个${labels[kind].split("（")[0]}。`;
}
