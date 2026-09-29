/**
 * 底层 HTTP 客户端：调用 OpenAI 兼容的 chat/completions 接口。
 * 只负责「发请求、解析响应、报错」，不涉及任何笔记/符号/提示词逻辑。
 * 内置：超时控制、网络/限流/服务端错误的重试（指数退避）、友好的错误信息。
 */

import { ChatMessage, OrganizeResult } from "../types";

/** 单次请求超时（毫秒）。 */
const TIMEOUT_MS = 300_000;
/** 初次失败后的最大重试次数（共 1 + 2 次调用）。 */
const MAX_RETRIES = 2;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryable: boolean = true,
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

/** 调用 chat/completions，带重试，返回整理结果。 */
export async function chatCompletion(
  config: ApiClientConfig,
  messages: ChatMessage[],
): Promise<OrganizeResult> {
  if (!config.apiKey) {
    throw new ApiError(
      "未配置 API Key（设置 noteForge.apiKey 或环境变量 DEEPSEEK_API_KEY）",
    );
  }

  let lastError: ApiError | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(1000 * 2 ** (attempt - 1)); // 1s、2s 指数退避
    }
    try {
      return await chatCompletionOnce(config, messages);
    } catch (err) {
      lastError = err instanceof ApiError ? err : new ApiError(String(err));
      if (!isRetryable(lastError) || attempt === MAX_RETRIES) {
        break;
      }
    }
  }
  // 兜底：循环内总会 break（抛错）或 return（成功）。
  throw lastError ?? new ApiError("未知错误");
}

/** 单次调用（含超时）。 */
async function chatCompletionOnce(
  config: ApiClientConfig,
  messages: ChatMessage[],
): Promise<OrganizeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

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
        // DeepSeek V4 默认开启推理(thinking)，会吃满 max_tokens 导致 content 为空；必须显式关闭。
        thinking: { type: "disabled" },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      throw new ApiError(`请求超时（${TIMEOUT_MS / 1000}s）`, undefined, false);
    }
    throw new ApiError(`网络错误：${(err as Error)?.message ?? String(err)}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ApiError(friendlyHttpError(res.status, detail), res.status);
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

/** 流式调用 chat/completions（stream:true），边生成边回调 onProgress；返回完整结果。单次尝试，不重试。 */
export async function chatCompletionStream(
  config: ApiClientConfig,
  messages: ChatMessage[],
  onProgress?: (accumulatedText: string) => void,
): Promise<OrganizeResult> {
  if (!config.apiKey) {
    throw new ApiError(
      "未配置 API Key（设置 noteForge.apiKey 或环境变量 DEEPSEEK_API_KEY）",
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

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
        stream: true,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        // DeepSeek V4 默认开启推理(thinking)，会吃满 max_tokens 导致 content 为空；必须显式关闭。
        thinking: { type: "disabled" },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if ((err as Error)?.name === "AbortError") {
      throw new ApiError(`请求超时（${TIMEOUT_MS / 1000}s）`, undefined, false);
    }
    throw new ApiError(`网络错误：${(err as Error)?.message ?? String(err)}`);
  }

  if (!res.ok) {
    clearTimeout(timer);
    const detail = await res.text().catch(() => "");
    throw new ApiError(friendlyHttpError(res.status, detail), res.status);
  }

  if (!res.body) {
    clearTimeout(timer);
    throw new ApiError("响应缺少可读取的流");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let content = "";
  let finishReason: string | undefined;
  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) {
          continue;
        }
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") {
          continue;
        }
        let json: any;
        try {
          json = JSON.parse(payload);
        } catch {
          continue;
        }
        const delta = json?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          content += delta;
          onProgress?.(content);
        }
        if (json?.choices?.[0]?.finish_reason) {
          finishReason = json.choices[0].finish_reason;
        }
        if (json?.usage) {
          usage = json.usage;
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }

  if (!content.trim()) {
    throw new ApiError("API 返回了空内容");
  }

  return {
    markdown: content,
    truncated: finishReason === "length",
    usage: usage
      ? {
          promptTokens: usage.prompt_tokens ?? 0,
          completionTokens: usage.completion_tokens ?? 0,
        }
      : undefined,
  };
}

/** 判断错误是否值得重试（网络/超时/限流/服务端错误）。 */
function isRetryable(err: ApiError): boolean {
  if (!err.retryable) {
    return false;
  }
  return err.status === undefined || err.status === 429 || err.status >= 500;
}

/** 把 HTTP 错误码翻译成更友好的提示。 */
function friendlyHttpError(status: number, detail: string): string {
  switch (status) {
    case 401:
      return "API Key 无效或未授权（401），请检查 noteForge.apiKey";
    case 402:
      return "账户余额不足（402）";
    case 429:
      return "请求太频繁（429），将自动重试";
    case 500:
    case 502:
    case 503:
      return `服务端错误（${status}），将自动重试`;
    default:
      return `API 请求失败（HTTP ${status}）：${detail.slice(0, 300)}`;
  }
}

/** 延迟等待。 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
