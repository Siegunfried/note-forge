/**
 * 12 个标记符号的唯一定义（单一事实来源）。
 * 内置 prompt（promptLoader）与语法高亮（scripts/gen-grammar.js 生成
 * syntaxes/*.tmLanguage.json）都从这里读取，加新符号只需改这一处。
 *
 * 符号分五类（kind），决定语法校验与组合规则：
 * - structure（结构）：# 标题 / % 思考 / ? 疑问 —— 决定「位置/形态」，一行至多 1 个（互斥）。
 * - content（内容）：$ 定义 / ~ 公式化 / * 深挖 / _ 补全 / @ 链接 —— 决定「做什么动作」，一行至多 1 个（互斥）。
 * - form（形式）：= 举例 / & 对比 —— 决定「用什么形式表达」，一行至多 1 个（互斥）。
 * - emphasis（修饰）：! 重点 —— 加粗强调，可叠加在任何类别上，一行至多 1 个。
 * - flag（标注）：+ 没听懂 —— 纯个人学习标记，不入成品正文，可叠加在任何类别上，一行至多 1 个。
 *
 * 组合规则：一行 = [结构?] + [内容?] + [形式?] + [修饰?] + [标注?]；无符号行 = #（标题）的简写。
 */

export type SymbolKind = "structure" | "content" | "form" | "emphasis" | "flag";

export interface SymbolDef {
  /** 符号字符（单字符）。 */
  char: string;
  /** 中文名。 */
  name: string;
  /** 含义。 */
  meaning: string;
  /** 助手的处理方式。 */
  action: string;
  /** 成品中的标注。 */
  annotation: string;
  /** 主题色建议（仅供 UI 参考；实际高亮色由主题决定）。 */
  color: string;
  /** TextMate 作用域（决定语法高亮颜色，沿用通用作用域以适配各主题）。 */
  scope: string;
  /** 符号类别（结构/内容/形式/修饰），决定组合规则与语法校验。 */
  kind: SymbolKind;
}

export const SYMBOLS: SymbolDef[] = [
  { char: "_", name: "补全",   meaning: "没记完 / 没记全",     action: "按常规结构补全，补全处标【补】",         annotation: "【补】",       color: "#9a9a9a", scope: "markup.italic.note-forge.fill", kind: "content" },
  { char: "?", name: "疑问",   meaning: "有疑问 / 拿不准",     action: "引用块旁注，严格按「问题：…／回答：…」格式输出：问题由 AI 整理成通顺表述（去口语化、不逐字照抄），回答给详细解答 + 注明依据，不升级成标题",     annotation: "", color: "#ce9178", scope: "string.note-forge.question", kind: "structure" },
  { char: "!", name: "重点",   meaning: "重点",                 action: "加粗突出，不得丢失",     annotation: "",     color: "#c586c0", scope: "keyword.control.note-forge.important", kind: "emphasis" },
  { char: "~", name: "公式化", meaning: "把陈述/命题/证明转成严格形式", action: "主体只含数学/逻辑符号·公式·代码，不放任何文字；必要的文字解释仅作为旁批", annotation: "", color: "#b5cea8", scope: "constant.numeric.note-forge.formula", kind: "content" },
  { char: "%", name: "思考",   meaning: "自己的思考 / 批注",   action: "用引用块包裹的旁注：转成注释，不升级成标题",     annotation: "",     color: "#6a9955", scope: "comment.note-forge.thought", kind: "structure" },
  { char: "*", name: "深挖",   meaning: "想特别深入展开这个点", action: "按内容深化：函数→语法·用法·注意事项；代码→分析结构与作用；证明→数学语言严格证明", annotation: "", color: "#569cd6", scope: "keyword.note-forge.explain", kind: "content" },
  { char: "#", name: "标题",   meaning: "章节标题 / 主题起点",    action: "作为层级标题，统领其下所有子条目", annotation: "",              color: "#569cd6", scope: "keyword.note-forge.heading", kind: "structure" },
  { char: "@", name: "链接",   meaning: "插入超链接 / 文档地址 / 图片", action: "把地址转成 Markdown 链接 [说明](地址)；若是图片（图片扩展名或图片 URL）则用 ![说明](地址) 嵌入，不读取内容作参考", annotation: "",           color: "#4ec9b0", scope: "entity.name.type.note-forge.web", kind: "content" },
  { char: "=", name: "举例",   meaning: "举例说明",             action: "用例子呈现：补充 / 整理具体例子",     annotation: "",       color: "#9cdcfe", scope: "variable.note-forge.verbatim", kind: "form" },
  { char: "$", name: "定义",   meaning: "给术语/概念下定义",           action: "作用于词/术语：给出严格定义，可用文字表述；可附通俗解释",  annotation: "",     color: "#d7ba7d", scope: "keyword.note-forge.definition", kind: "content" },
  { char: "&", name: "对比",   meaning: "易混淆 / 需对比 / 并列一组概念",     action: "必须生成对照表：并列/对比一组相关概念，一律用表格呈现（列对齐、逐项对比，直观优先）",             annotation: "",     color: "#dcdcaa", scope: "entity.name.function.note-forge.compare", kind: "form" },
  { char: "+", name: "没听懂", meaning: "课上没听懂，课后需补", action: "纯个人标记，不影响输出：本条内容照常展开、正常写入，不添加任何「没听懂」相关标注", annotation: "", color: "#d16969", scope: "keyword.note-forge.unclear", kind: "flag" },
];

/** 所有符号字符连成串，用于构造正则（这些字符在字符类里均为字面量，无需转义）。 */
export const SYMBOL_CHARS = SYMBOLS.map((s) => s.char).join("");

/** 按字符查符号定义（用于语法校验）。 */
export const SYMBOL_BY_CHAR: ReadonlyMap<string, SymbolDef> = new Map(
  SYMBOLS.map((s) => [s.char, s]),
);
