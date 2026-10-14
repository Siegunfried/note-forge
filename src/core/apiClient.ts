/**
 * 底层 HTTP 客户端：调用 OpenAI 兼容的 chat/completions 接口（流式）。
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

/**
 * 流式调用 chat/completions（stream:true），边生成边回调 onProgress；返回完整结果。
 * 请求阶段（连不上 / 429 / 5xx）带指数退避重试；一旦开始流式读取则不再重试。
 */
export async function chatCompletionStream(
  config: ApiClientConfig,
  messages: ChatMessage[],
  onProgress?: (accumulatedText: string) => void,
  signal?: AbortSignal,
): Promise<OrganizeResult> {
  if (!config.apiKey) {
    throw new ApiError(
      "未配置 API Key（设置 noteForge.apiKey 或环境变量 DEEPSEEK_API_KEY）",
    );
  }

  // 覆盖「请求 + 流式读取」全程的可中止信号：外部取消会转发到这里。
  // 空闲计时器复用同一个 controller，连续无数据才中止，避免生成中途永久挂起。
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const armIdle = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  };
  armIdle();

  try {
    const res = await fetchWithRetry(
      config,
      JSON.stringify({
        model: config.model,
        messages,
        stream: true,
        // 请求在最后一个 chunk 返回 usage，供 token 用量与成本统计。
        stream_options: { include_usage: true },
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        // DeepSeek V4 默认开启推理(thinking)，会吃满 max_tokens 导致 content 为空；必须显式关闭。
        thinking: { type: "disabled" },
      }),
      controller.signal,
    );

    if (!res.body) {
      throw new ApiError("响应缺少可读取的流");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let content = "";
    let finishReason: string | undefined;
    let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
    let buffer = "";

    const consumeLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        return;
      }
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") {
        return;
      }
      let json: any;
      try {
        json = JSON.parse(payload);
      } catch {
        return;
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
    };

    for (;;) {
      const { done, value } = await reader.read();
      armIdle();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        consumeLine(line);
      }
    }
    // 收尾：冲刷解码器残留的多字节字符，并处理最后一行无换行的残余内容。
    buffer += decoder.decode();
    if (buffer.trim()) {
      consumeLine(buffer);
    }

    if (!content.trim()) {
      if (controller.signal.aborted) {
        throw new ApiError(
          signal?.aborted
            ? "整理已取消"
            : `请求超时（${TIMEOUT_MS / 1000}s，生成过程无响应）`,
          undefined,
          false,
        );
      }
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
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      throw new ApiError(
        signal?.aborted
          ? "整理已取消"
          : `请求超时（${TIMEOUT_MS / 1000}s，生成过程无响应）`,
        undefined,
        false,
      );
    }
    throw err;
  } finally {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    signal?.removeEventListener("abort", onAbort);
  }
}

/** 发起请求并检查状态；请求阶段（网络 / 429 / 5xx）带指数退避重试，返回已确认 ok 的 Response。
 *  signal 贯穿到 fetch，使外部取消能真正中止连接；一旦开始流式读取则不再重试。 */
async function fetchWithRetry(
  config: ApiClientConfig,
  body: string,
  signal: AbortSignal,
): Promise<Response> {
  let lastError: ApiError | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(1000 * 2 ** (attempt - 1)); // 1s、2s 指数退避
    }
    if (signal.aborted) {
      throw new ApiError("整理已取消", undefined, false);
    }
    try {
      const res = await fetch(config.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body,
        signal,
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new ApiError(friendlyHttpError(res.status, detail), res.status);
      }
      return res;
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        throw new ApiError("整理已取消或超时", undefined, false);
      }
      lastError =
        err instanceof ApiError
          ? err
          : new ApiError(`网络错误：${(err as Error)?.message ?? String(err)}`);
      if (!isRetryable(lastError) || attempt === MAX_RETRIES) {
        throw lastError;
      }
    }
  }
  throw lastError ?? new ApiError("未知错误");
}

/** 判断错误是否值得重试（网络/限流/服务端错误）。 */
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
