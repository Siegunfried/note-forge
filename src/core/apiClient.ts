/**
 * 底层 HTTP 客户端：调用 OpenAI 兼容的 chat/completions 接口。
 * 只负责「发请求、解析响应、报错」，不涉及任何笔记/符号/提示词逻辑。
 */

import { ChatMessage, OrganizeResult } from "../types";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiClientConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

/** 调用 chat/completions，返回整理结果。 */
export async function chatCompletion(
  config: ApiClientConfig,
  messages: ChatMessage[],
): Promise<OrganizeResult> {
  if (!config.apiKey) {
    throw new ApiError(
      "未配置 API Key（设置 noteForge.apiKey 或环境变量 DEEPSEEK_API_KEY）",
    );
  }

  let res: Response;
  try {
    res = await fetch(config.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: false,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
      }),
    });
  } catch (err) {
    throw new ApiError(`网络错误：${(err as Error)?.message ?? String(err)}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ApiError(
      `API 请求失败（HTTP ${res.status}）：${detail.slice(0, 300)}`,
      res.status,
    );
  }

  const data = (await res.json().catch(() => ({}))) as any;
  const choice = data?.choices?.[0];
  const content = choice?.message?.content;

  if (!content || !String(content).trim()) {
    throw new ApiError("API 返回了空内容");
  }

  return {
    markdown: String(content),
    truncated: choice?.finish_reason === "length",
    usage: data?.usage
      ? {
          promptTokens: data.usage.prompt_tokens ?? 0,
          completionTokens: data.usage.completion_tokens ?? 0,
        }
      : undefined,
  };
}
