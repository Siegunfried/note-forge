/**
 * 共享类型定义。
 * 各模块之间只依赖这里声明的接口，避免模块互相耦合。
 */

/** OpenAI 兼容的聊天消息。 */
export interface ChatMessage {
  role: "user" | "system" | "assistant";
  content: string;
}

/** 整理结果。 */
export interface OrganizeResult {
  /** 整理后的 Markdown 全文。 */
  markdown: string;
  /** 是否因达到输出上限而被截断。 */
  truncated: boolean;
  /** token 用量（用于展示，可选）。 */
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

