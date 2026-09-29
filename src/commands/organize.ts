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
import * as path from "path";
import * as vscode from "vscode";
import { getSettings } from "../config/settings";
import { readPromptText } from "../core/promptLoader";
import { organize } from "../core/organizer";
import { extractReferences, loadReferences } from "../core/references";
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
import { estimateCost } from "../core/pricing";

const SNAPSHOT_KEY = "noteForge.snapshots";

/** 诊断日志输出通道（写到「输出 → Note Forge」，不打扰正常使用）。 */
let diagChannel: vscode.OutputChannel | undefined;
function diag(): vscode.OutputChannel {
  if (!diagChannel) {
    diagChannel = vscode.window.createOutputChannel("Note Forge");
  }
  return diagChannel;
}

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

  const promptText = readPromptText();
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
      const snapshot = getSnapshot(state, pairing.sourcePath, rawText);
      if (!snapshot) {
        diag().appendLine(
          `[增量] 跳过：${pairing.sourcePath} 无上次快照（首次整理或快照丢失）`,
        );
      } else if (snapshot === rawText) {
        diag().appendLine(`[增量] 跳过：原文与上次快照一致，无新增内容`);
        const force = await vscode.window.showInformationMessage(
          "没有更改，已跳过整理。",
          "仍然整理",
        );
        if (force !== "仍然整理") {
          return;
        }
      } else {
        // 只有「纯尾部追加」才走增量（新增内容天然在文末）；中间插入 / 修改 / 删除都回退整篇，
        // 因为增量只能往已有标题下插片段，无法把新内容插到中间，AI 猜 anchor 会落到尾部。
        const append = diffAppend(snapshot, rawText);
        if (!append.isAppend || !append.added.trim()) {
          diag().appendLine(`[增量] 跳过：非纯尾部追加（中间插入 / 修改 / 删除），回退整篇`);
        } else {
          const inc = await runIncremental(
            editor,
            pairing,
            promptText,
            append.added,
            config,
          );
          if (inc) {
            setSnapshot(state, pairing.sourcePath, rawText);
            diag().appendLine(`[增量] 成功：${pairing.sourcePath}`);
            vscode.window.showInformationMessage(
              `增量整理完成 ✓${formatUsage(inc, config.model)}`,
            );
            return;
          }
          // 增量不可用（成品缺失 / AI 返回格式错），回退整篇。
        }
      }
    }

    // 整篇整理（首次 / 非纯追加 / 增量失败时兜底）。从原文全新生成，不带已有 .md 基线。
    const references = await loadReferences(
      extractReferences(rawText),
      path.dirname(pairing.sourcePath),
    );
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Note Forge 整理中…",
      },
      (progress) => {
        let lastReport = 0;
        return organize(rawText, promptText, config, references, (acc) => {
          const now = Date.now();
          if (now - lastReport > 300) {
            lastReport = now;
            progress.report({ message: `已生成 ${acc.length} 字…` });
          }
        });
      },
    );

    await writeResult(editor, pairing, result.markdown);
    if (pairing.mode !== "inline") {
      setSnapshot(state, pairing.sourcePath, rawText);
    }

    const usage = formatUsage(result, config.model);
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
      diag().appendLine(`[增量] 失败：成品 ${pairing.targetPath} 不存在，回退整篇`);
      return null; // 成品 .md 还不存在
    }
  } else {
    currentMd = editor.document.getText();
  }
  if (!currentMd.trim()) {
    diag().appendLine(`[增量] 失败：当前 .md 为空，回退整篇`);
    return null;
  }

  const outline = extractOutline(currentMd);
  const references = await loadReferences(
    extractReferences(added),
    path.dirname(pairing.sourcePath),
  );
  const prompt = buildIncrementalPrompt(promptText, outline, added, references);

  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Note Forge 增量整理中…",
    },
    () => chatCompletion(config, [{ role: "user", content: prompt }]),
  );

  const parsed = parseIncrementalResult(result.markdown);
  if (!parsed) {
    diag().appendLine(
      `[增量] 失败：AI 返回无法解析为 JSON，回退整篇。原始返回前 300 字：\n${result.markdown.slice(0, 300)}`,
    );
    return null;
  }

  const newMd = insertIntoMarkdown(currentMd, parsed.anchor, parsed.content);
  await writeResult(editor, pairing, newMd);
  return result;
}

/** 格式化 token 用量提示（含估算花费）。 */
function formatUsage(result: OrganizeResult, model: string): string {
  if (!result.usage) {
    return "";
  }
  const tokens = `输入 ${result.usage.promptTokens} / 输出 ${result.usage.completionTokens} token`;
  const cost = estimateCost(
    model,
    result.usage.promptTokens,
    result.usage.completionTokens,
  );
  const costText = cost !== undefined ? `，约 ¥${formatCost(cost)}` : "";
  return `（${tokens}${costText}）`;
}

/** 把花费格式化成可读金额（元）。 */
function formatCost(cost: number): string {
  return cost < 0.01 ? cost.toFixed(4) : cost.toFixed(3);
}

/** 判断 prev 是否为 current 的逐行前缀（即 current 由 prev 纯追加而来）。 */
function isAppendOf(prev: string, current: string): boolean {
  return !!prev && diffAppend(prev, current).isAppend;
}

/** 快照：读取某 .forge 上次整理成功的原文；路径失效时按内容前缀找回。 */
function getSnapshot(
  state: vscode.Memento,
  forgePath: string,
  rawText: string,
): string | undefined {
  const map = state.get<Record<string, string>>(SNAPSHOT_KEY, {});
  if (map[forgePath]) {
    return map[forgePath];
  }
  // 文件被移动 / 重命名后路径失效：找一条「是当前原文逐行前缀」的旧快照。
  for (const text of Object.values(map)) {
    if (isAppendOf(text, rawText)) {
      return text;
    }
  }
  return undefined;
}

/** 快照：记录某 .forge 本次整理成功的原文，并清理移动后残留的旧路径快照。 */
function setSnapshot(state: vscode.Memento, forgePath: string, text: string): void {
  const map = state.get<Record<string, string>>(SNAPSHOT_KEY, {});
  map[forgePath] = text;
  for (const [p, t] of Object.entries(map)) {
    if (p !== forgePath && isAppendOf(t, text)) {
      delete map[p];
    }
  }
  void state.update(SNAPSHOT_KEY, map);
}

/** 文件在 VSCode 内被移动 / 重命名时，把快照精确迁移到新路径（不靠内容猜测）。 */
export function migrateSnapshotsOnRename(
  state: vscode.Memento,
  event: vscode.FileRenameEvent,
): void {
  const map = state.get<Record<string, string>>(SNAPSHOT_KEY, {});
  let changed = false;
  for (const { oldUri, newUri } of event.files) {
    const oldPath = oldUri.fsPath;
    const newPath = newUri.fsPath;
    if (oldPath !== newPath && map[oldPath]) {
      map[newPath] = map[oldPath];
      delete map[oldPath];
      changed = true;
    }
  }
  if (changed) {
    void state.update(SNAPSHOT_KEY, map);
  }
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

/** 「更新快照」命令：把当前 .forge 原文手动记为增量基线。 */
export async function updateSnapshot(state: vscode.Memento): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("没有打开的笔记文件。");
    return;
  }

  const pairing = resolvePairing(editor.document.uri.fsPath);
  if (pairing.mode === "inline") {
    vscode.window.showInformationMessage(
      "当前文件没有对应的 .forge 速记，无需更新快照。",
    );
    return;
  }

  const rawText = readSourceText(editor.document, editor.selection, pairing);
  if (!rawText.trim()) {
    vscode.window.showWarningMessage("原文为空，未更新快照。");
    return;
  }

  setSnapshot(state, pairing.sourcePath, rawText);
  vscode.window.showInformationMessage("快照已更新 ✓（下次整理将以此为增量基线）");
}
