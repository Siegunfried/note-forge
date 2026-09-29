/**
 * 模型价格估算（单位：元 / 100 万 token）。
 * 采用 DeepSeek V4 高峰时段、缓存未命中的价格（最高档）作为估算上界；
 * 空闲时段、缓存命中都会使实际值更低，仅供粗略参考。
 */

export interface ModelPrice {
  /** 输入价（元 / 1M token）。 */
  inputPerM: number;
  /** 输出价（元 / 1M token）。 */
  outputPerM: number;
}

/** 已知模型价目表（高峰时段价）。 */
const PRICES: Record<string, ModelPrice> = {
  "deepseek-v4-pro": { inputPerM: 9.0, outputPerM: 27.0 },
  "deepseek-flash": { inputPerM: 3.0, outputPerM: 9.0 },
};

/** 估算一次调用的花费（元）；模型不在价目表里时返回 undefined。 */
export function estimateCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number | undefined {
  const price = PRICES[model];
  if (!price) {
    return undefined;
  }
  return (
    (promptTokens * price.inputPerM + completionTokens * price.outputPerM) /
    1_000_000
  );
}
