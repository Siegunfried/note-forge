/**
 * 「整理当前笔记」命令：读取原文 → 定位课程 prompt → 调 API → 写回成品。
 * 这是把核心模块接到 VSCode 交互上的粘合层。
 *
 * 两条数据流：
 * - xxx.forge（原文速记）→ 生成写到同名 xxx.md，.forge 永不改动。
 * - xxx.md 若存在同名 xxx.forge → 从 .forge 读原文、写回当前 .md。
 * - 其余就地整理（兼容旧行为）。
 *
 * 增量整理：记录上次整理快照，纯追加时只把新增速记发给 AI，按 .md 标题大纲插入，省 token。
 */

import * as fs from "fs";
import * as vscode from "vscode";
import { getSettings } from "../config/settings";
import { loadPrompt, readPromptText } from "../core/promptLoader";
import { organize } from "../core/organizer";
import { ApiError, ApiClientConfig, chatCompletion } from "../core/apiClient";
import { resolvePairing, Pairing } from "../core/pairing";
import {
  diffAppend,
  extractOutline,
  buildIncrementalPrompt,
  parseIncrementalResult,
  insertIntoMarkdown,
} from "../core/incremental";
import { OrganizeResult } from "../types";

const SNAPSHOT_KEY = "noteForge.snapshots";

export async function organizeActiveNote(state: vscode.Memento): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("没有打开的笔记文件。");
    return;
  }

  const doc = editor.document;
  const pairing = resolvePairing(doc.uri.fsPath);

  const rawText = readSourceText(doc, editor.selection, pairing);
  if (!rawText.trim()) {
    vscode.window.showWarningMessage(
      pairing.mode === "inline"
        ? "当前笔记为空，没什么可整理的。"
        : "原文速记（.forge）为空，没什么可整理的。",
    );
    return;
  }

  const settings = getSettings();
  if (!settings.apiKey) {
    const choice = await vscode.window.showErrorMessage(
      "缺少 API Key：请在设置里填 noteForge.apiKey，或设环境变量 DEEPSEEK_API_KEY。",
      "打开设置",
    );
    if (choice === "打开设置") {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "noteForge.apiKey",
      );
    }
    return;
  }

  // 课程 prompt 用「源文件」路径向上定位。
  const resolution = loadPrompt(pairing.sourcePath);
  const promptText = readPromptText(resolution);
  const config: ApiClientConfig = {
    apiKey: settings.apiKey,
    baseUrl: settings.apiBaseUrl,
    model: settings.model,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
  };

  try {
    // 增量整理：仅双文件流模式（forge / md-linked）且纯追加时启用。
    if (pairing.mode !== "inline") {
      const snapshot = getSnapshot(state, pairing.sourcePath);
      if (snapshot && snapshot !== rawText) {
        const diff = diffAppend(snapshot, rawText);
        if (diff.isAppend && diff.added.trim()) {
          const inc = await runIncremental(
            editor,
            pairing,
            promptText,
            diff.added,
            config,
          );
          if (inc) {
            setSnapshot(state, pairing.sourcePath, rawText);
            vscode.window.showInformationMessage(
              `增量整理完成 ✓${formatUsage(inc)}`,
            );
            return;
          }
          // 增量不可用（成品缺失 / AI 返回格式错），回退整篇。
        }
      }
    }

    // 整篇整理（首次 / 非纯追加 / 增量失败时兜底）。
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Note Forge 整理中（${resolution.courseName}）…`,
      },
      () => organize(rawText, promptText, config),
    );

    await writeResult(editor, pairing, result.markdown);
    if (pairing.mode !== "inline") {
      setSnapshot(state, pairing.sourcePath, rawText);
    }

    const usage = formatUsage(result);
    const trunc = result.truncated ? " ⚠ 输出达到上限，可能被截断" : "";
    vscode.window.showInformationMessage(`整理完成 ✓${usage}${trunc}`);
  } catch (err) {
    const message =
      err instanceof ApiError ? err.message : (err as Error)?.message ?? String(err);
    vscode.window.showErrorMessage(`整理失败：${message}`);
  }
}

/** 执行一次增量整理；成功返回结果，否则返回 null（调用方回退整篇）。 */
async function runIncremental(
  editor: vscode.TextEditor,
  pairing: Pairing,
  promptText: string,
  added: string,
  config: ApiClientConfig,
): Promise<OrganizeResult | null> {
  let currentMd: string;
  if (pairing.mode === "forge") {
    try {
      currentMd = fs.readFileSync(pairing.targetPath, "utf-8");
    } catch {
      return null; // 成品 .md 还不存在
    }
  } else {
    currentMd = editor.document.getText();
  }
  if (!currentMd.trim()) {
    return null;
  }

  const outline = extractOutline(currentMd);
  const prompt = buildIncrementalPrompt(promptText, outline, added);

  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Note Forge 增量整理中…",
    },
    () => chatCompletion(config, [{ role: "user", content: prompt }]),
  );

  const parsed = parseIncrementalResult(result.markdown);
  if (!parsed) {
    return null;
  }

  const newMd = insertIntoMarkdown(currentMd, parsed.anchor, parsed.content);
  await writeResult(editor, pairing, newMd);
  return result;
}

/** 格式化 token 用量提示。 */
function formatUsage(result: OrganizeResult): string {
  return result.usage
    ? `（输入 ${result.usage.promptTokens} / 输出 ${result.usage.completionTokens} token）`
    : "";
}

/** 快照：读取某 .forge 上次整理成功的原文。 */
function getSnapshot(
  state: vscode.Memento,
  forgePath: string,
): string | undefined {
  const map = state.get<Record<string, string>>(SNAPSHOT_KEY, {});
  return map[forgePath];
}

/** 快照：记录某 .forge 本次整理成功的原文。 */
function setSnapshot(state: vscode.Memento, forgePath: string, text: string): void {
  const map = state.get<Record<string, string>>(SNAPSHOT_KEY, {});
  map[forgePath] = text;
  void state.update(SNAPSHOT_KEY, map);
}

/** 读取本次要整理的原文。 */
function readSourceText(
  doc: vscode.TextDocument,
  selection: vscode.Selection,
  pairing: Pairing,
): string {
  if (pairing.mode === "forge") {
    return doc.getText(); // 源 .forge 全文，忽略选区。
  }
  if (pairing.mode === "md-linked") {
    try {
      return fs.readFileSync(pairing.sourcePath, "utf-8");
    } catch {
      return "";
    }
  }
  // inline：有选区整理选区，否则全文。
  return selection.isEmpty ? doc.getText() : doc.getText(selection);
}

/** 写回成品。 */
async function writeResult(
  editor: vscode.TextEditor,
  pairing: Pairing,
  markdown: string,
): Promise<void> {
  if (pairing.mode === "forge") {
    const targetUri = vscode.Uri.file(pairing.targetPath);
    await vscode.workspace.fs.writeFile(targetUri, Buffer.from(markdown, "utf8"));
    const targetDoc = await vscode.workspace.openTextDocument(targetUri);
    await vscode.window.showTextDocument(targetDoc);
    return;
  }

  if (pairing.mode === "md-linked") {
    await replaceWholeDocument(editor, markdown);
    return;
  }

  await applyResult(editor, editor.selection, markdown);
}

/** 有选区替换选区，否则替换全文（inline 模式）。 */
async function applyResult(
  editor: vscode.TextEditor,
  selection: vscode.Selection,
  markdown: string,
): Promise<void> {
  const doc = editor.document;
  const range = selection.isEmpty
    ? new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length))
    : selection;

  await editor.edit((editBuilder) => {
    editBuilder.replace(range, markdown);
  });
}

/** 用新内容替换当前文档全文（md-linked 模式，忽略选区）。 */
async function replaceWholeDocument(
  editor: vscode.TextEditor,
  markdown: string,
): Promise<void> {
  const doc = editor.document;
  const fullRange = new vscode.Range(
    doc.positionAt(0),
    doc.positionAt(doc.getText().length),
  );
  await editor.edit((editBuilder) => {
    editBuilder.replace(fullRange, markdown);
  });
}
