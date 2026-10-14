/**
 * 配置读取层：把 VSCode 的 settings.json（noteForge.*）读成结构化对象。
 * 只负责「取配置」，不做任何网络/笔记逻辑。
 */

import * as vscode from "vscode";

export interface ExtensionSettings {
  apiKey: string;
  apiBaseUrl: string;
  model: string;
  maxTokens: number;
  temperature: number;
  /** PDF/文档结构化任务模型（空 = 回退到 model）。 */
  structureModel: string;
  /** 扫描版 OCR / 视觉模型（第二期接入；空 = 未配置）。 */
  ocrModel: string;
}

/** 读取扩展配置；apiKey 为空时回退到环境变量 DEEPSEEK_API_KEY。 */
export function getSettings(): ExtensionSettings {
  const config = vscode.workspace.getConfiguration("noteForge");
  const apiKey = (
    config.get<string>("apiKey") || process.env.DEEPSEEK_API_KEY || ""
  ).trim();

  return {
    apiKey,
    apiBaseUrl: config.get<string>(
      "apiBaseUrl",
      "https://api.deepseek.com/chat/completions",
    ),
    model: config.get<string>("model", "deepseek-flash"),
    maxTokens: config.get<number>("maxTokens", 16384),
    temperature: config.get<number>("temperature", 0.3),
    structureModel: config.get<string>("structureModel", ""),
    ocrModel: config.get<string>("ocrModel", ""),
  };
}
