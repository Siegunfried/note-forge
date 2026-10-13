/**
 * 「导入 PDF 生成速记」命令：选 PDF → 提取 → 按文本型/扫描型分流 → 生成 .forge 并打开供审阅。
 * - 文本型：有字号信息 → 规则初筛 + AI 精加工（文本通道）。
 * - 扫描型：几乎无文本 → 渲染页面为图 → 视觉多模态模型 OCR 直接产出 .forge（需配置 noteForge.ocrModel）。
 * 生成的 .forge 只是原文速记，需用户审阅后再点「整理」产出 .md。
 */

import * as vscode from "vscode";
import * as path from "path";
import { getSettings } from "../config/settings";
import {
  ApiClientConfig,
  chatCompletionStream,
  chatCompletionWithImages,
  ApiError,
} from "../core/apiClient";
import { extractPdfBlocks } from "../core/pdfExtractor";
import { renderPagesToImages } from "../core/pdfRender";
import {
  isScannedPdf,
  blocksToLines,
  detectStructure,
  buildForgePrompt,
  buildOcrPrompt,
  forgeSketch,
} from "../core/pdfImport";

export async function importPdf(): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    title: "选择要导入的 PDF 文档",
    filters: { "PDF 文档": ["pdf"] },
    canSelectMany: false,
  });
  if (!picked || picked.length === 0) {
    return;
  }
  const sourcePath = picked[0].fsPath;
  const data = await vscode.workspace.fs.readFile(picked[0]);

  const blocks = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Note Forge 解析 PDF 中…" },
    () => extractPdfBlocks(new Uint8Array(data)),
  );

  const settings = getSettings();
  const config = buildConfig(settings);
  const scanned = isScannedPdf(blocks);

  let forgeText: string;
  if (scanned) {
    forgeText = await handleScannedPdf(data, settings, config);
    if (forgeText === "") {
      return; // 已提示，未产出
    }
  } else {
    forgeText = await handleTextPdf(blocks, settings, config);
    if (forgeText === "") {
      return;
    }
  }

  await saveForgeForReview(sourcePath, forgeText);
}

/** 文本型 PDF：规则初筛 + AI 精加工。 */
async function handleTextPdf(
  blocks: Awaited<ReturnType<typeof extractPdfBlocks>>,
  settings: ReturnType<typeof getSettings>,
  config: ApiClientConfig,
): Promise<string> {
  const structured = detectStructure(blocksToLines(blocks));
  if (structured.length === 0) {
    vscode.window.showWarningMessage("没有从 PDF 提取到任何文本。");
    return "";
  }

  if (!settings.apiKey) {
    vscode.window.showInformationMessage(
      "未配置 API Key，已生成规则初筛草稿（可手动精修后再整理）。",
    );
    return forgeSketch(structured);
  }

  const prompt = buildForgePrompt(structured);
  try {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Note Forge 结构化中…",
        cancellable: true,
      },
      (progress, token) => {
        const controller = new AbortController();
        token.onCancellationRequested(() => controller.abort());
        return chatCompletionStream(
          config,
          [{ role: "user", content: prompt }],
          undefined,
          controller.signal,
        );
      },
    );
    return result.markdown.trim() + "\n";
  } catch (err) {
    vscode.window.showErrorMessage(`结构化失败：${friendlyError(err)}`);
    return "";
  }
}

/** 扫描型 PDF：渲染页面 → 视觉模型 OCR 直接产出 .forge。 */
async function handleScannedPdf(
  data: Uint8Array,
  settings: ReturnType<typeof getSettings>,
  config: ApiClientConfig,
): Promise<string> {
  if (!settings.ocrModel) {
    const choice = await vscode.window.showWarningMessage(
      "疑似扫描版 PDF：需要视觉模型才能识别，请先在设置里配置 noteForge.ocrModel（一个支持图片输入的模型）。",
      "打开设置",
    );
    if (choice === "打开设置") {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "noteForge.ocrModel",
      );
    }
    return "";
  }
  if (!(settings.ocrApiKey || settings.apiKey)) {
    await vscode.window.showErrorMessage(
      "缺少 API Key：请在设置里填 noteForge.ocrApiKey（或 noteForge.apiKey / 环境变量 DEEPSEEK_API_KEY）。",
    );
    return "";
  }

  const rendered = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Note Forge 渲染页面中…" },
    () => renderPagesToImages(data, settings.ocrMaxPages),
  );
  if (rendered.images.length === 0) {
    vscode.window.showWarningMessage("未能渲染出任何页面图片。");
    return "";
  }
  if (rendered.total > rendered.images.length) {
    vscode.window.showWarningMessage(
      `文档共 ${rendered.total} 页，仅识别前 ${rendered.images.length} 页（可在 noteForge.ocrMaxPages 调整）。`,
    );
  }

  const ocrConfig: ApiClientConfig = {
    ...config,
    apiKey: settings.ocrApiKey || settings.apiKey,
    baseUrl: settings.ocrBaseUrl || settings.apiBaseUrl,
    model: settings.ocrModel,
  };
  const prompt = buildOcrPrompt(rendered.images.length);

  try {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Note Forge 视觉识别中…",
        cancellable: true,
      },
      (progress, token) => {
        const controller = new AbortController();
        token.onCancellationRequested(() => controller.abort());
        return chatCompletionWithImages(
          ocrConfig,
          prompt,
          rendered.images.map((img) => ({
            base64: img.png.toString("base64"),
            mimeType: "image/png",
          })),
          controller.signal,
        );
      },
    );
    return result.markdown.trim() + "\n";
  } catch (err) {
    vscode.window.showErrorMessage(`视觉识别失败：${friendlyError(err)}`);
    return "";
  }
}

/** 生成 .forge 并打开供审阅。 */
async function saveForgeForReview(sourcePath: string, forgeText: string): Promise<void> {
  const target = withExt(sourcePath, ".forge");
  const targetUri = vscode.Uri.file(target);
  if (await vscode.workspace.fs.stat(targetUri).then(() => true, () => false)) {
    const choice = await vscode.window.showWarningMessage(
      `「${path.basename(target)}」已存在，导入会覆盖它。`,
      { modal: true },
      "仍然覆盖",
    );
    if (choice !== "仍然覆盖") {
      return;
    }
  }

  await vscode.workspace.fs.writeFile(targetUri, Buffer.from(forgeText, "utf8"));
  const doc = await vscode.workspace.openTextDocument(targetUri);
  await vscode.window.showTextDocument(doc);
  vscode.window.showInformationMessage(
    "已生成 .forge 速记，请审阅后可点「整理」产出完整笔记。",
  );
}

/** 组装文本/结构化通道的默认 API 配置（结构化任务优先用 structureModel）。 */
function buildConfig(settings: ReturnType<typeof getSettings>): ApiClientConfig {
  return {
    apiKey: settings.apiKey,
    baseUrl: settings.apiBaseUrl,
    model: settings.structureModel || settings.model,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
  };
}

/** 友好错误信息。 */
function friendlyError(err: unknown): string {
  return err instanceof ApiError
    ? err.message
    : (err as Error)?.message ?? String(err);
}

/** 替换后缀。 */
function withExt(filePath: string, ext: string): string {
  const base = filePath.slice(0, filePath.length - path.extname(filePath).length);
  return base + ext;
}