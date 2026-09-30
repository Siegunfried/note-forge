/**
 * 「整理当前笔记」命令：读取原文 → 解析成树 → 逐节点展开 → 拼装 → 写回成品。
 * 这是把核心模块接到 VSCode 交互上的粘合层。
 *
 * 两条数据流：
 * - xxx.forge（原文速记）→ 生成写到同名 xxx.md，.forge 永不改动。
 * - xxx.md 若存在同名 xxx.forge → 从 .forge 读原文、写回当前 .md。
 * - 其余就地整理（兼容旧行为，整篇一次）。
 *
 * 节点级增量：把 .forge 解析成树，逐节点 AI 展开；改动只重新展开受影响的节点，其余复用。
 */

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { getSettings } from "../config/settings";
import { readPromptText, readExpansionPromptText } from "../core/promptLoader";
import { organize } from "../core/organizer";
import { extractReferences, loadReferences } from "../core/references";
import { ApiError, ApiClientConfig } from "../core/apiClient";
import { resolvePairing, Pairing } from "../core/pairing";
import { parseForgeTree, ForgeNode } from "../core/forgeTree";
import { diffTrees } from "../core/treeDiff";
import { assembleMarkdown } from "../core/mdAssemble";
import { expandNodes } from "../core/nodeExpand";
import { estimateCost } from "../core/pricing";

const NODE_STORE_KEY = "noteForge.nodeStores";

/** 节点库：某 .forge 上次整理成功的原文 + 逐节点内容。 */
interface NodeStoreEntry {
  rawText: string;
  contents: Record<string, string>;
}

/** 加载 @ 引用；有加载失败（如缺 pdfjs）时弹提示。 */
async function loadReferencesOrWarn(rawText: string, baseDir: string) {
  const refs = await loadReferences(extractReferences(rawText), baseDir);
  const failed = refs.filter((r) => r.error);
  if (failed.length > 0) {
    vscode.window.showWarningMessage(`引用加载失败：${failed[0].error}`);
  }
  return refs;
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

  const config: ApiClientConfig = {
    apiKey: settings.apiKey,
    baseUrl: settings.apiBaseUrl,
    model: settings.model,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
  };

  try {
    if (pairing.mode === "inline") {
      await organizeInline(editor, pairing, rawText, config);
      return;
    }
    await organizeTree(editor, pairing, rawText, config, state);
  } catch (err) {
    const message =
      err instanceof ApiError ? err.message : (err as Error)?.message ?? String(err);
    vscode.window.showErrorMessage(`整理失败：${message}`);
  }
}

/** 就地整理（普通 .md/txt，无 .forge）：整篇一次。 */
async function organizeInline(
  editor: vscode.TextEditor,
  pairing: Pairing,
  rawText: string,
  config: ApiClientConfig,
): Promise<void> {
  const promptText = readPromptText();
  const references = await loadReferencesOrWarn(
    rawText,
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
  const usage = formatUsage(result.usage, config.model);
  const trunc = result.truncated ? " ⚠ 输出达到上限，可能被截断" : "";
  vscode.window.showInformationMessage(`整理完成 ✓${usage}${trunc}`);
}

/** 节点级整理（.forge / 同名 .md）：解析成树，只展开变更节点，拼装写回。 */
async function organizeTree(
  editor: vscode.TextEditor,
  pairing: Pairing,
  rawText: string,
  config: ApiClientConfig,
  state: vscode.Memento,
): Promise<void> {
  const promptText = readExpansionPromptText();
  const newRoots = parseForgeTree(rawText);
  if (newRoots.length === 0) {
    vscode.window.showWarningMessage("原文速记（.forge）为空，没什么可整理的。");
    return;
  }

  let oldEntry = getNodeStore(state, pairing.sourcePath);
  if (oldEntry && oldEntry.rawText === rawText) {
    const force = await vscode.window.showInformationMessage(
      "没有更改，已跳过整理。",
      "仍然整理",
    );
    if (force !== "仍然整理") {
      return;
    }
    oldEntry = undefined; // 强制整理：全部重新展开
  }

  const oldRoots = oldEntry ? parseForgeTree(oldEntry.rawText) : [];
  const { changed, reused } = diffTrees(oldRoots, oldEntry?.contents ?? {}, newRoots);

  // 祖先主题链映射（供子节点展开时消歧义 + 防重复）。
  const ancestorTexts = new Map<ForgeNode, string[]>();
  const collect = (node: ForgeNode, ancestors: ForgeNode[]) => {
    ancestorTexts.set(node, ancestors.map((a) => a.text));
    for (const c of node.children) {
      collect(c, [...ancestors, node]);
    }
  };
  for (const r of newRoots) {
    collect(r, []);
  }

  const references = await loadReferencesOrWarn(
    rawText,
    path.dirname(pairing.sourcePath),
  );

  const { contents: expandedContents, usage: expandUsage } =
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Note Forge 整理中…",
      },
      () =>
        expandNodes(
          changed,
          (n) => ancestorTexts.get(n) ?? [],
          promptText,
          config,
          references,
        ),
    );

  const contents: Record<string, string> = { ...expandedContents };
  for (const [p, c] of reused) {
    contents[p] = c;
  }

  const markdown = assembleMarkdown(newRoots, contents);
  await writeResult(editor, pairing, markdown);
  setNodeStore(state, pairing.sourcePath, { rawText, contents });

  const usageText = formatUsage(expandUsage, config.model);
  vscode.window.showInformationMessage(
    `整理完成 ✓（展开 ${changed.length} 个节点，复用 ${reused.size} 个）${usageText}`,
  );
}

/** 格式化 token 用量提示（含估算花费）。 */
function formatUsage(
  usage: { promptTokens: number; completionTokens: number } | undefined,
  model: string,
): string {
  if (!usage) {
    return "";
  }
  const tokens = `输入 ${usage.promptTokens} / 输出 ${usage.completionTokens} token`;
  const cost = estimateCost(model, usage.promptTokens, usage.completionTokens);
  const costText = cost !== undefined ? `，约 ¥${formatCost(cost)}` : "";
  return `（${tokens}${costText}）`;
}

/** 把花费格式化成可读金额（元）。 */
function formatCost(cost: number): string {
  return cost < 0.01 ? cost.toFixed(4) : cost.toFixed(3);
}

/** 节点库：读取某 .forge 上次整理成功的原文 + 逐节点内容。 */
function getNodeStore(
  state: vscode.Memento,
  forgePath: string,
): NodeStoreEntry | undefined {
  const map = state.get<Record<string, NodeStoreEntry>>(NODE_STORE_KEY, {});
  return map[forgePath];
}

/** 节点库：记录某 .forge 本次整理成功的原文 + 逐节点内容。 */
function setNodeStore(
  state: vscode.Memento,
  forgePath: string,
  entry: NodeStoreEntry,
): void {
  const map = state.get<Record<string, NodeStoreEntry>>(NODE_STORE_KEY, {});
  map[forgePath] = entry;
  void state.update(NODE_STORE_KEY, map);
}

/** 文件在 VSCode 内被移动 / 重命名时，把节点库精确迁移到新路径。 */
export function migrateNodeStoresOnRename(
  state: vscode.Memento,
  event: vscode.FileRenameEvent,
): void {
  const map = state.get<Record<string, NodeStoreEntry>>(NODE_STORE_KEY, {});
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
    void state.update(NODE_STORE_KEY, map);
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
