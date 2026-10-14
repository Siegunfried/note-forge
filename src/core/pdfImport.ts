/**
 * PDF 导入：把 PDF 提取出的文本块（带字号/坐标）结构化成行 → 识别标题层级 → 映射为 .forge。
 * 纯逻辑、无 VSCode 依赖，便于单测。pdfjs-dist 的实际提取在 pdfExtractor.ts，这里只吃 DocBlock[]。
 *
 * 双通道：
 * - 文本型 PDF：有字号信息，规则初筛（标题按字号）+ AI 精加工映射 Forge 符号。
 * - 扫描型 PDF：几乎无文本/字号，需走视觉 OCR 通道（第二期），由 isScannedPdf 探测拦截。
 */

import { SYMBOLS } from "./symbols";
import { KNOWLEDGE_TREE_RULE } from "./promptLoader";

/** 一个文本块（来自 pdfjs 文本项）。 */
export interface DocBlock {
  /** 文本内容。 */
  text: string;
  /** 字号（pt）；扫描版可能为 undefined。 */
  fontSize?: number;
  /** 页面内 Y 坐标（大 = 靠上）。 */
  y?: number;
  /** 页面内 X 坐标（左 → 右）。 */
  x?: number;
  /** 页码（0-based）。 */
  page: number;
  /** 是否粗体。 */
  bold?: boolean;
}

/** 合并后的一行文本（同页同基线相邻的块拼成一行）。 */
export interface TextLine {
  text: string;
  /** 行内最大字号（代表性字号）。 */
  fontSize: number;
  /** 行基线 Y（用首块）。 */
  y: number;
  /** 页码（0-based）。 */
  page: number;
  bold: boolean;
}

/** 结构化后的一行（带标题层级/正文角色）。 */
export interface StructuredLine {
  text: string;
  /** 标题深度（0 起）；正文为 -1。 */
  level: number;
  kind: "heading" | "body";
  fontSize: number;
  page: number;
}

/** 同一行合并的 Y 容差（pt）。 */
const LINE_Y_TOLERANCE = 3;

/** 把文本块按 (页, 行) 合并成行：先按页、再按 Y 降序（从上到下）、X 升序（从左到右）。 */
export function blocksToLines(blocks: DocBlock[]): TextLine[] {
  const sorted = [...blocks].sort((a, b) => {
    if (a.page !== b.page) {
      return a.page - b.page;
    }
    if ((a.y ?? 0) !== (b.y ?? 0)) {
      return (b.y ?? 0) - (a.y ?? 0);
    }
    return (a.x ?? 0) - (b.x ?? 0);
  });

  const lines: TextLine[] = [];
  for (const b of sorted) {
    const text = b.text ?? "";
    const fontSize = b.fontSize ?? 0;
    const y = b.y ?? 0;
    const last = lines[lines.length - 1];
    // 仅当同页、Y 接近时并入上一行；否则开新行。
    if (last && last.page === b.page && Math.abs(y - last.y) <= LINE_Y_TOLERANCE) {
      last.text = last.text ? `${last.text} ${text}`.trim() : text;
      last.fontSize = Math.max(last.fontSize, fontSize);
      last.bold = last.bold || !!b.bold;
    } else {
      lines.push({ text, fontSize, y, page: b.page, bold: !!b.bold });
    }
  }
  return lines;
}

/** 中位数。 */
function median(xs: number[]): number {
  if (xs.length === 0) {
    return 0;
  }
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * 规则初筛结构：以「正文中位字号」为基准，显著更大的字号判为标题并按字号降序分档定级。
 * 字号信息缺省或全一致时退化为「全文正文」（交给 AI 精加工）。
 */
export function detectStructure(lines: TextLine[]): StructuredLine[] {
  const nonEmpty = lines.filter((l) => l.text.trim() !== "");
  if (nonEmpty.length === 0) {
    return [];
  }
  const sizes = nonEmpty.map((l) => l.fontSize).filter((s) => s > 0);
  const body = median(sizes);

  // 标题字号档位（显著大于正文），降序排序即层级 0、1、2…
  const headingSizes = Array.from(
    new Set(sizes.filter((s) => s >= body * 1.1)),
  ).sort((a, b) => b - a);
  const levelOfSize = new Map<number, number>();
  headingSizes.forEach((s, i) => levelOfSize.set(s, i));

  return lines.map((l) => {
    const size = l.fontSize > 0 ? l.fontSize : body;
    const isHeading =
      l.text.trim() !== "" && sizes.length > 0 && levelOfSize.has(size);
    return {
      text: l.text.trim(),
      level: isHeading ? (levelOfSize.get(size) as number) : -1,
      kind: isHeading ? "heading" : "body",
      fontSize: size,
      page: l.page,
    };
  });
}

/** 疑似扫描版：无任何文本，或仅有极少数块带可靠字号（需走 OCR 视觉通道）。 */
export function isScannedPdf(blocks: DocBlock[]): boolean {
  const meaningful = blocks.filter((b) => (b.text ?? "").trim() !== "");
  if (meaningful.length === 0) {
    return true;
  }
  const withSize = meaningful.filter((b) => (b.fontSize ?? 0) > 0);
  return withSize.length < meaningful.length * 0.5;
}

/** 生成符号表（与 symbols.ts 单一事实来源一致，精简版）。 */
function symbolTable(): string {
  return SYMBOLS.map((s) => `\`${s.char}\` ${s.name}：${s.meaning}`).join("\n");
}

/** 把结构化行序列化成带角色标注的文本（[H1]… / [正文]…）。 */
function serializeContent(lines: StructuredLine[]): string {
  return lines
    .map((l) => {
      const role = l.kind === "heading" ? `[H${l.level + 1}]` : "[正文]";
      return `${role} ${l.text}`;
    })
    .join("\n");
}

/**
 * 第一步「定根」prompt：只产出概念分类树（# 大类 + $ 概念），禁止叶子。
 * 与第二步「挂叶」分离，避免单次既要分类、又要嵌套、又要标符号，导致模型退回「照抄节号 + 平铺」。
 */
export function buildConceptTreePrompt(lines: StructuredLine[]): string {
  const content = serializeContent(lines);
  return `# 角色
你是知识结构提炼助手，只负责「定根」：从文档中提炼概念分类树。

# 输入说明
下面是文档内容行，每行开头方括号标注角色：[H1]/[H2]/[H3]… 是标题，[正文] 是段落。

${KNOWLEDGE_TREE_RULE}

# 本步任务（只做概念分类）
1. 提炼全文核心概念，按科学事实做逻辑分类；相关概念归到同一个大类（\`# 大类\`）。
2. 概念用 \`$ 术语：一句话定义\`；子概念/子类型用缩进嵌套到父概念下（例如「离散型随机变量」是「随机变量」的子类型，就缩进到它的下一层）。
3. 只输出「大类」与「概念」两级骨架；严禁写入定理、公式、性质、例子、对比、思考等任何叶子。
4. 严禁照抄源文档的节号与多级标题（如 2.1.1、Chapter 2）；标题只用于判断概念归属，不作为输出层级。

# 符号（本步只用两个）
- \`#\` 大类 / 章节名
- \`$\` 概念定义

# 输出
直接输出概念树（缩进 = 层级，2 空格一层），不要代码围栏、不要解释、不要任何前言后语。

# 待提炼的文档
\`\`\`text
${content}
\`\`\``;
}

/**
 * 第二步「挂叶」prompt：把定理/性质/例子/对比挂到已定概念树上，不改变树结构。
 */
export function buildAttachPrompt(
  lines: StructuredLine[],
  conceptTree: string,
): string {
  const content = serializeContent(lines);
  return `# 角色
你是知识结构化助手，负责「挂叶子」：把文档里的定理、性质、例子、对比挂到给定的概念树上。

# 符号表（叶子用这些符号标注）
${symbolTable()}

# 输入一：已定的概念树（根，请保持不动）
\`\`\`text
${conceptTree.trim()}
\`\`\`

# 输入二：文档内容行（[H1]/[H2]… 标题，[正文] 段落）
\`\`\`text
${content}
\`\`\`

# 任务
1. 保持概念树的父子结构不变：不得增删概念、不得改变概念之间的从属关系（概念定义措辞可微调）。
2. 把文档里的定理/公理/公式、性质、例子、易混淆对比作为叶子，挂到它们语义上从属的概念下：
   - 定理 / 公理 / 公式 → \`~\`
   - 重点性质 → \`!\`
   - 例子 → \`= 例子\`
   - 易混淆 / 对比 → \`&\`
3. 从属判断：性质挂到它描述的定理或概念下，例子挂到它说明的定理/概念/性质下；一条定理涉及多个概念时，挂到这些概念所属的大类下。
4. 压缩：合并重复、去掉语气词与无关段落，用自己的话概括；不编造原文没有的内容；只用符号表里的符号，每行一条速记（符号 + 内容）。

# 输出
直接输出完整 .forge（概念树 + 叶子），缩进表层级，不要代码围栏、不要解释、不要任何前言后语。`;
}

/**
 * 规则初筛后直接生成一份 .forge 草稿（无 AI 的确定性回退，供离线/预览）。
 * 标题用 \`#\`，正文挂在最近标题下缩进一层。
 */
export function forgeSketch(lines: StructuredLine[]): string {
  const out: string[] = [];
  let lastLevel = -1;
  for (const l of lines) {
    if (l.text === "") {
      continue;
    }
    if (l.kind === "heading") {
      lastLevel = l.level;
      out.push(`${"  ".repeat(l.level)}# ${l.text}`);
    } else {
      out.push(`${"  ".repeat(Math.max(lastLevel + 1, 0))}${l.text}`);
    }
  }
  return out.join("\n") + "\n";
}