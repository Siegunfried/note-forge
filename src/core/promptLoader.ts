/**
 * 定位并读取「笔记整理prompt.md」。
 * 策略：从笔记文件所在目录逐级向上查找；找不到就用内置默认 prompt 兜底。
 */

import * as fs from "fs";
import * as path from "path";
import { CourseResolution } from "../types";
import { SYMBOLS } from "./symbols";

const PROMPT_FILENAME = "笔记整理prompt.md";

/** 从笔记文件路径向上逐级查找 prompt 文件，返回绝对路径或 undefined。 */
export function resolvePromptPath(notePath: string): string | undefined {
  let dir = path.dirname(notePath);
  for (;;) {
    const candidate = path.join(dir, PROMPT_FILENAME);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined; // 到根目录仍未找到
    }
    dir = parent;
  }
}

/** 解析课程 prompt：找到则记录路径与课程名，否则标记为内置默认。 */
export function loadPrompt(notePath: string): CourseResolution {
  const promptPath = resolvePromptPath(notePath);
  if (promptPath) {
    return { promptPath, courseName: path.basename(path.dirname(promptPath)) };
  }
  return { promptPath: "", courseName: "内置默认" };
}

/** 读取 prompt 文本；无课程 prompt 时返回内置默认。 */
export function readPromptText(resolution: CourseResolution): string {
  if (resolution.promptPath && fs.existsSync(resolution.promptPath)) {
    return fs.readFileSync(resolution.promptPath, "utf-8");
  }
  return DEFAULT_PROMPT;
}

/** 用符号定义生成符号表 Markdown（与 symbols.ts 保持单一事实来源）。 */
function buildSymbolTableMarkdown(): string {
  const rows = SYMBOLS.map(
    (s) => `| \`${s.char}\` | ${s.meaning} | ${s.action}，标${s.annotation} |`,
  ).join("\n");
  return `| 符号 | 含义 | 处理 |\n|------|------|------|\n${rows}`;
}

/** 内置默认 prompt（找不到课程 prompt 时兜底）。 */
export const DEFAULT_PROMPT = `# 角色
你是课堂笔记整理助手，把碎片速记重构为结构清晰、逻辑完整、阅读流畅的层级笔记。

# 标记规则
标记符号只在行首生效：单行 \`符号 内容\`；多行块 \`符号{ ... }\`；可叠加 \`!?\`；\`\\X\` 转义为字面符号。

# 符号表
${buildSymbolTableMarkdown()}

# 公式
公式一律用 LaTeX：行内 \`$...$\`，独立 \`$$...$$\`。

# 纠错
发现笔误/错误结论/公式/术语必须指出：原处标【纠错】+正确表述，不改动原错误内容；文末汇总「纠错清单」。

# 结构
- 标题 # 章 / ## 节 / ### 小节。
- 要点一律用无序列表 \`-\`，不编号。
- 同主题合并，避免过度拆分。
- 按知识逻辑组织，不必照抄原文顺序；不改变原意、不删有效信息、不凭空编造。
- 补全标【补】，【详解】作缩进子条，疑问/思考用引用块 \`>\`。

# 输出
直接输出完整 Markdown（从第一个 # 到文末清单），不加解释、不用代码围栏。文末依次附：重点清单、疑问解答清单、纠错清单、结构补全说明（用了 @ 再加外查来源清单）。`;
