/**
 * 「导入 PDF 生成速记」命令：选 PDF → 提取文本块 → 规则初筛 + AI 精加工 → 生成 .forge 并打开供审阅。
 * 生成的 .forge 只是原文速记，需用户审阅后再点「整理」产出 .md；扫描版（无文本）会提示走 OCR 通道。
 */

import * as vscode from "vscode";
import * as path from "path";
import { getSettings } from "../config/settings";
import {
  ApiClientConfig,
  chatCompletionStream,
  ApiError,
} from "../core/apiClient";
import { extractPdfBlocks } from "../core/pdfExtractor";
import {
  isScannedPdf,
  blocksToLines,
  detectStructure,
  buildConceptTreePrompt,
  buildAttachPrompt,
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

  // 扫描版检测：几乎无文本 → 提示 OCR 通道（第二期），允许仍尝试。
  if (isScannedPdf(blocks)) {
    const choice = await vscode.window.showWarningMessage(
      "疑似扫描版 PDF：文本通道几乎提取不到内容，需要 OCR 视觉通道（后续上线）。",
      "仍尝试生成",
    );
    if (choice !== "仍尝试生成") {
      return;
    }
  }

  const structured = detectStructure(blocksToLines(blocks));
  if (structured.length === 0) {
    vscode.window.showWarningMessage("没有从 PDF 提取到任何文本。");
    return;
  }

  const settings = getSettings();
  let forgeText: string;
  if (settings.apiKey) {
    const config: ApiClientConfig = {
      apiKey: settings.apiKey,
      baseUrl: settings.apiBaseUrl,
      model: settings.structureModel || settings.model,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
    };
    try {
      const conceptTree = await structify(
        config,
        buildConceptTreePrompt(structured),
        "Note Forge 提炼概念树…",
      );
      forgeText = await structify(
        config,
        buildAttachPrompt(structured, conceptTree),
        "Note Forge 挂接定理与例子…",
      );
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : (err as Error)?.message ?? String(err);
      vscode.window.showErrorMessage(`结构化失败：${message}`);
      return;
    }
  } else {
    forgeText = forgeSketch(structured);
    vscode.window.showInformationMessage(
      "未配置 API Key，已生成规则初筛草稿（可手动精修后再整理）。",
    );
  }

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

/** 调一次结构化模型，返回去尾空白后的 markdown 文本。 */
async function structify(
  config: ApiClientConfig,
  prompt: string,
  title: string,
): Promise<string> {
  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title, cancellable: true },
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
}

/** 替换后缀。 */
function withExt(filePath: string, ext: string): string {
  const base = filePath.slice(0, filePath.length - path.extname(filePath).length);
  return base + ext;
}