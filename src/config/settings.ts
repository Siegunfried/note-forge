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
    model: config.get<string>("model", "deepseek-chat"),
    maxTokens: config.get<number>("maxTokens", 8192),
    temperature: config.get<number>("temperature", 0.3),
  };
}
