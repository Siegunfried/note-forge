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
import * as vscode from "vscode";
import { getSettings } from "../config/settings";
import { readPromptText } from "../core/promptLoader";
import { organize } from "../core/organizer";
import {
  ApiError,
  ApiClientConfig,
  chatCompletionStream,
} from "../core/apiClient";
import { resolvePairing, Pairing } from "../core/pairing";
import { parseForgeTree, ForgeNode } from "../core/forgeTree";
import { diffTrees } from "../core/treeDiff";
import { assembleMarkdown } from "../core/mdAssemble";
import { expandNodes } from "../core/nodeExpand";
import { estimateCost } from "../core/pricing";
import { validateSyntax } from "../core/validateSyntax";
import {
  subtreeNodes,
  buildReorderPrompt,
  parseReorderPlan,
  validateReorderPlan,
  applyReorder,
  ensureNoContentLoss,
} from "../core/chapterReorder";
import {
  emptyHistory,
  recordChange,
  undoChange,
  redoChange,
  TreeHistory,
} from "../core/treeHistory";

const NODE_STORE_KEY = "noteForge.nodeStores";
const TREE_HISTORY_KEY = "noteForge.treeHistory";

/** 节点库：某 .forge 上次整理成功的原文 + 逐节点内容 + 逐节点标题。 */
interface NodeStoreEntry {
  rawText: string;
  contents: Record<string, string>;
  titles: Record<string, string>;
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

  // 整理前汇总检查：.forge 有符号组合错误时提示（波浪线已实时标出，这里再拦一道）。
  if (pairing.mode !== "inline") {
    const issues = validateSyntax(rawText);
    if (issues.length > 0) {
      const first = issues[0];
      const choice = await vscode.window.showWarningMessage(
        `速记有 ${issues.length} 处符号组合错误（如第 ${first.line + 1} 行：${first.message}），建议先修正。`,
        "仍然整理",
        "取消",
      );
      if (choice !== "仍然整理") {
        return;
      }
    }
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
  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Note Forge 整理中…",
    },
    (progress) => {
      let lastReport = 0;
      return organize(rawText, promptText, config, (acc) => {
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
  const { changed, reused, reusedTitles } = diffTrees(
    oldRoots,
    oldEntry?.contents ?? {},
    oldEntry?.titles ?? {},
    newRoots,
  );

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

  const cancelController = new AbortController();
  const {
    contents: expandedContents,
    titles: expandedTitles,
    usage: expandUsage,
  } = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Note Forge 整理中…",
      cancellable: true,
    },
    (progress, token) => {
      token.onCancellationRequested(() => cancelController.abort());
      return expandNodes(
        changed,
        (n) => ancestorTexts.get(n) ?? [],
        config,
        (done, total, lastText) => {
          const pct = Math.round((done / total) * 100);
          const label = lastText.length > 24 ? `${lastText.slice(0, 24)}…` : lastText;
          progress.report({
            message: `已完成 ${done}/${total} 个节点（${pct}%）｜${label}`,
            increment: total > 0 ? (1 / total) * 100 : undefined,
          });
        },
        cancelController.signal,
      );
    },
  );

  if (cancelController.signal.aborted) {
    // 用户取消：无论已展开多少节点，都不写回，避免用残缺内容覆盖旧成品。
    vscode.window.showWarningMessage("已取消整理，未写入成品。");
    return;
  }

  const contents: Record<string, string> = { ...expandedContents };
  for (const [p, c] of reused) {
    contents[p] = c;
  }
  const titles: Record<string, string> = { ...expandedTitles };
  for (const [p, t] of reusedTitles) {
    titles[p] = t;
  }

  const markdown = assembleMarkdown(newRoots, contents, titles);
  await writeResult(editor, pairing, markdown);
  setNodeStore(state, pairing.sourcePath, { rawText, contents, titles });

  const usageText = formatUsage(expandUsage, config.model);
  vscode.window.showInformationMessage(
    `整理完成 ✓（展开 ${changed.length} 个节点，复用 ${reused.size} 个）${usageText}`,
  );
}

/** 「重新生成」：仅重新展开目标 .forge 节点（及其子树），可附加用户自定义要求，其余节点复用。 */
export async function regenerateChapter(
  state: vscode.Memento,
  target: { sourcePath: string; nodePath: string },
): Promise<void> {
  let rawText: string;
  try {
    rawText = fs.readFileSync(target.sourcePath, "utf-8");
  } catch {
    vscode.window.showWarningMessage("找不到原文速记（.forge）。");
    return;
  }
  const roots = parseForgeTree(rawText);
  const node = findNodeByPath(roots, target.nodePath);
  if (!node) {
    vscode.window.showWarningMessage(
      "找不到要重新生成的目标节点，可能原文已改动，请先重新整理。",
    );
    return;
  }

  const requirement = await vscode.window.showInputBox({
    prompt: "重新生成要求（可留空，按默认规则重新展开当前选中章节）",
    placeHolder: "例：更口语化一些 / 补充更多例子 / 精简表达",
  });
  if (requirement === undefined) {
    return; // 用户取消输入框
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

  // 目标子树（可能只是单行叶子，也可能是整个章节）。
  const subtree = collectSubtree(node);

  // 祖先主题链映射（供子节点展开时消歧义 + 防重复）。
  const ancestorTexts = new Map<ForgeNode, string[]>();
  const collect = (n: ForgeNode, ancestors: ForgeNode[]) => {
    ancestorTexts.set(n, ancestors.map((a) => a.text));
    for (const c of n.children) {
      collect(c, [...ancestors, n]);
    }
  };
  for (const r of roots) {
    collect(r, []);
  }

  const cancelController = new AbortController();
  const {
    contents: newContents,
    titles: newTitles,
    usage,
  } = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Note Forge 重新生成中…",
      cancellable: true,
    },
    (progress, token) => {
      token.onCancellationRequested(() => cancelController.abort());
      return expandNodes(
        subtree,
        (n) => ancestorTexts.get(n) ?? [],
        config,
        (done, total, lastText) => {
          const pct = Math.round((done / total) * 100);
          const label = lastText.length > 24 ? `${lastText.slice(0, 24)}…` : lastText;
          progress.report({
            message: `已完成 ${done}/${total} 个节点（${pct}%）｜${label}`,
            increment: total > 0 ? (1 / total) * 100 : undefined,
          });
        },
        cancelController.signal,
        requirement.trim() ? requirement : undefined,
      );
    },
  );

  if (cancelController.signal.aborted) {
    vscode.window.showWarningMessage("已取消重新生成，未写入成品。");
    return;
  }

  // 以旧节点库为基础，覆盖目标子树的节点，其余保持复用。
  const oldEntry = getNodeStore(state, target.sourcePath);
  const contents: Record<string, string> = { ...(oldEntry?.contents ?? {}) };
  const titles: Record<string, string> = { ...(oldEntry?.titles ?? {}) };
  for (const [p, c] of Object.entries(newContents)) {
    contents[p] = c;
  }
  for (const [p, t] of Object.entries(newTitles)) {
    titles[p] = t;
  }

  const markdown = assembleMarkdown(roots, contents, titles);
  const pairing = resolvePairing(target.sourcePath);
  await writeResult(undefined, pairing, markdown);
  setNodeStore(state, target.sourcePath, { rawText, contents, titles });

  const usageText = formatUsage(
    usage.promptTokens + usage.completionTokens > 0 ? usage : undefined,
    config.model,
  );
  vscode.window.showInformationMessage(
    `重新生成完成 ✓（${subtree.length} 个节点）${usageText}`,
  );
}

/** 「重构章节树」：仅调整选中章节子树内节点的层级与顺序，AI 按知识逻辑重排，绝不改动符号/内容。 */
export async function reorderChapter(
  state: vscode.Memento,
  target: { sourcePath: string; nodePath: string },
): Promise<void> {
  let rawText: string;
  try {
    rawText = fs.readFileSync(target.sourcePath, "utf-8");
  } catch {
    vscode.window.showWarningMessage("找不到原文速记（.forge）。");
    return;
  }
  const roots = parseForgeTree(rawText);
  const node = findNodeByPath(roots, target.nodePath);
  if (!node) {
    vscode.window.showWarningMessage(
      "找不到要重构的章节节点，可能原文已改动，请先重新整理。",
    );
    return;
  }

  const atoms = subtreeNodes(node);
  if (atoms.length <= 1) {
    vscode.window.showInformationMessage("选中的章节只有一个节点，无需重构。");
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

  const prompt = buildReorderPrompt(node);
  const cancelController = new AbortController();
  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Note Forge 重构章节树中…",
      cancellable: true,
    },
    (progress, token) => {
      token.onCancellationRequested(() => cancelController.abort());
      return chatCompletionStream(
        config,
        [{ role: "user", content: prompt }],
        undefined,
        cancelController.signal,
      );
    },
  );

  if (cancelController.signal.aborted) {
    vscode.window.showWarningMessage("已取消重构，未写入任何改动。");
    return;
  }

  // 解析 + 校验重排方案；不合法则整体放弃，不写入。
  const plan = parseReorderPlan(result.markdown);
  const atomPaths = new Set(atoms.map((n) => n.path));
  const invalid = validateReorderPlan(plan, atomPaths, node.path);
  if (invalid) {
    vscode.window.showErrorMessage(`重构结果不合法：${invalid}，已放弃（未做任何改动）。`);
    return;
  }

  const nextRaw = applyReorder(rawText, plan);
  const loss = ensureNoContentLoss(rawText, nextRaw);
  if (loss) {
    vscode.window.showErrorMessage(`内容校验失败：${loss}，已放弃（未做任何改动）。`);
    return;
  }

  // 写入前记录一步历史（供回退/前进）。
  recordTreeChange(state, target.sourcePath, rawText);
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(target.sourcePath),
    Buffer.from(nextRaw, "utf8"),
  );

  const usageText = formatUsage(result.usage, config.model);
  vscode.window.showInformationMessage(
    `章节树重构完成 ✓（重排 ${atoms.length} 个节点）${usageText}，可回退/前进。`,
  );
}

/** 「回退一步」：把指定 .forge 恢复到最近一步历史（修改前）的状态。 */
export async function undoTreeChange(
  state: vscode.Memento,
  sourcePath: string | undefined,
): Promise<void> {
  const current = readForge(sourcePath);
  if (current === undefined) {
    return;
  }

  const history = getTreeHistory(state, sourcePath!);
  const result = undoChange(history, current, Date.now());
  if (result.restored === undefined) {
    vscode.window.showInformationMessage("当前笔记没有可回退的上一步。");
    return;
  }
  setTreeHistory(state, sourcePath!, result.history);
  await writeForge(sourcePath!, result.restored);
  vscode.window.showInformationMessage("已回退一步。");
}

/** 「前进一步」：把指定 .forge 恢复到被回退掉的后一步状态。 */
export async function redoTreeChange(
  state: vscode.Memento,
  sourcePath: string | undefined,
): Promise<void> {
  const current = readForge(sourcePath);
  if (current === undefined) {
    return;
  }

  const history = getTreeHistory(state, sourcePath!);
  const result = redoChange(history, current, Date.now());
  if (result.restored === undefined) {
    vscode.window.showInformationMessage("当前笔记没有可前进的下一步。");
    return;
  }
  setTreeHistory(state, sourcePath!, result.history);
  await writeForge(sourcePath!, result.restored);
  vscode.window.showInformationMessage("已前进一步。");
}

/** 记录一次会改变树的「重构」操作前的内容（供回退）。 */
function recordTreeChange(
  state: vscode.Memento,
  forgePath: string,
  beforeContent: string,
): void {
  const history = getTreeHistory(state, forgePath);
  setTreeHistory(state, forgePath, recordChange(history, beforeContent, Date.now()));
}

/** 读取某 .forge 的树历史（不存在则返回空历史）。 */
function getTreeHistory(
  state: vscode.Memento,
  forgePath: string,
): TreeHistory {
  const map = state.get<Record<string, TreeHistory>>(TREE_HISTORY_KEY, {});
  return map[forgePath] ?? emptyHistory();
}

/** 写回某 .forge 的树历史。 */
function setTreeHistory(
  state: vscode.Memento,
  forgePath: string,
  history: TreeHistory,
): void {
  const map = state.get<Record<string, TreeHistory>>(TREE_HISTORY_KEY, {});
  map[forgePath] = history;
  void state.update(TREE_HISTORY_KEY, map);
}

/** 读取 .forge 原文；失败或未指定路径时提示并返回 undefined。 */
function readForge(sourcePath: string | undefined): string | undefined {
  if (!sourcePath) {
    vscode.window.showWarningMessage("没有可操作的笔记：请先打开或选择对应的 .forge 笔记。");
    return undefined;
  }
  try {
    return fs.readFileSync(sourcePath, "utf-8");
  } catch {
    vscode.window.showWarningMessage("找不到原文速记（.forge）。");
    return undefined;
  }
}

/** 把 .forge 内容写回磁盘。 */
async function writeForge(sourcePath: string, content: string): Promise<void> {
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(sourcePath),
    Buffer.from(content, "utf8"),
  );
}

/** 定位光标所在 .forge 节点（仅 forge 模式；md-linked / inline 无行号对应，返回 undefined）。 */
export function nodePathAtCursor(
  editor: vscode.TextEditor,
): { sourcePath: string; nodePath: string } | undefined {
  const doc = editor.document;
  const pairing = resolvePairing(doc.uri.fsPath);
  if (pairing.mode !== "forge") {
    return undefined;
  }
  const roots = parseForgeTree(doc.getText());
  const node = findNodeAtLine(roots, editor.selection.active.line);
  return node ? { sourcePath: pairing.sourcePath, nodePath: node.path } : undefined;
}

/** 深度优先按 path 查找节点。 */
function findNodeByPath(roots: ForgeNode[], path: string): ForgeNode | undefined {
  for (const r of roots) {
    if (r.path === path) {
      return r;
    }
    const found = findNodeByPath(r.children, path);
    if (found) {
      return found;
    }
  }
  return undefined;
}

/** 深度优先按 0-based 行号查找节点（精确匹配）。 */
function findNodeAtLine(roots: ForgeNode[], line: number): ForgeNode | undefined {
  for (const r of roots) {
    if (r.line === line) {
      return r;
    }
    const found = findNodeAtLine(r.children, line);
    if (found) {
      return found;
    }
  }
  return undefined;
}

/** 收集节点及其整棵子树（含自身）。 */
function collectSubtree(node: ForgeNode): ForgeNode[] {
  const out: ForgeNode[] = [node];
  for (const c of node.children) {
    out.push(...collectSubtree(c));
  }
  return out;
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
  editor: vscode.TextEditor | undefined,
  pairing: Pairing,
  markdown: string,
): Promise<void> {
  if (pairing.mode === "forge") {
    const targetUri = vscode.Uri.file(pairing.targetPath);
    await vscode.workspace.fs.writeFile(targetUri, Buffer.from(markdown, "utf8"));
    return;
  }

  if (!editor) {
    throw new Error("没有打开的编辑器，无法写回成品。");
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
