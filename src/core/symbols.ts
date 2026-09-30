/**
 * 10 个标记符号的唯一定义（单一事实来源）。
 * 内置 prompt（promptLoader）与语法高亮（scripts/gen-grammar.js 生成
 * syntaxes/*.tmLanguage.json）都从这里读取，加新符号只需改这一处。
 */

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
}

export const SYMBOLS: SymbolDef[] = [
  { char: "_", name: "补全",   meaning: "没记完 / 没记全",     action: "按常规结构补全",         annotation: "【补】",       color: "#9a9a9a", scope: "markup.italic.note-forge.fill" },
  { char: "?", name: "疑问",   meaning: "有疑问 / 拿不准",     action: "详细解答 + 注明依据",     annotation: "【答】/【待确认】", color: "#ce9178", scope: "string.note-forge.question" },
  { char: "!", name: "重点",   meaning: "重点",                 action: "加粗突出，不得丢失",     annotation: "【重点】",     color: "#c586c0", scope: "keyword.control.note-forge.important" },
  { char: "~", name: "公式化", meaning: "大概意思 / 粗略记法", action: "命题/公式→数学·逻辑符号严格表示；代码→封装成代码块", annotation: "【公式化】", color: "#b5cea8", scope: "constant.numeric.note-forge.formula" },
  { char: "%", name: "思考",   meaning: "自己的思考 / 批注",   action: "转成注释（引用块）",     annotation: "【思考】",     color: "#6a9955", scope: "comment.note-forge.thought" },
  { char: "#", name: "深挖",   meaning: "想特别深入展开这个点", action: "按内容深化：函数→语法·用法·注意事项；代码→分析结构与作用；证明→数学语言严格证明", annotation: "【详解】", color: "#569cd6", scope: "keyword.note-forge.explain" },
  { char: "@", name: "引用",   meaning: "引用外部资料（本地路径 / URL）", action: "读取/检索该资料并据其补充，标来源", annotation: "【外查】", color: "#4ec9b0", scope: "entity.name.type.note-forge.web" },
  { char: "=", name: "举例",   meaning: "举例说明",             action: "补充 / 整理具体例子",     annotation: "【例】",       color: "#9cdcfe", scope: "variable.note-forge.verbatim" },
  { char: "$", name: "定义",   meaning: "要严格定义",           action: "给出严格定义 + 通俗解释",  annotation: "【定义】",     color: "#d7ba7d", scope: "keyword.note-forge.definition" },
  { char: "&", name: "对比",   meaning: "易混淆 / 需对比",     action: "必须生成对比表",             annotation: "【对比】",     color: "#dcdcaa", scope: "entity.name.function.note-forge.compare" },
];

/** 所有符号字符连成串，用于构造正则（这些字符在字符类里均为字面量，无需转义）。 */
export const SYMBOL_CHARS = SYMBOLS.map((s) => s.char).join("");
