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
  /** 扫描版 OCR / 视觉模型名（视觉多模态通道；空 = 未配置该通道）。 */
  ocrModel: string;
  /** OCR / 视觉模型的 API Key（空 = 回退到 apiKey，适用于视觉与文本用同一服务）。 */
  ocrApiKey: string;
  /** OCR / 视觉模型地址（空 = 回退到 apiBaseUrl）。 */
  ocrBaseUrl: string;
  /** 扫描版 PDF 仅渲染/识别前 N 页（控制成本与请求大小）。 */
  ocrMaxPages: number;
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
    ocrApiKey: config.get<string>("ocrApiKey", ""),
    ocrBaseUrl: config.get<string>("ocrBaseUrl", ""),
    ocrMaxPages: config.get<number>("ocrMaxPages", 15),
  };
}
