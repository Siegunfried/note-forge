/**
 * 扩展入口：激活时注册命令与视图。
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { organizeActiveNote, migrateNodeStoresOnRename } from "./commands/organize";
import { createNote } from "./commands/create";
import { openSettingsMenu } from "./commands/settings";
import { NotesTreeProvider } from "./views/notesTree";
import { resolvePairing } from "./core/pairing";
import {
  initDiagnostics,
  refreshDiagnostics,
  clearDiagnostics,
} from "./commands/diagnostics";

export function activate(context: vscode.ExtensionContext): void {
  // 语法诊断：.forge 文件的符号组合错误 → 实时波浪线 + 问题面板。
  initDiagnostics(context);

  context.subscriptions.push(
    vscode.commands.registerCommand("noteForge.organize", () =>
      organizeActiveNote(context.globalState),
    ),
    vscode.commands.registerCommand("noteForge.create", createNote),
    vscode.commands.registerCommand("noteForge.openSettings", openSettingsMenu),
  );

  const provider = new NotesTreeProvider();
  const treeView = vscode.window.createTreeView("noteForge.notes", {
    treeDataProvider: provider,
  });
  context.subscriptions.push(treeView);

  // 右键 .forge → 打开并整理
  context.subscriptions.push(
    vscode.commands.registerCommand("noteForge.organizeFile", async () => {
      const node = treeView.selection[0];
      if (node?.kind === "forge") {
        const doc = await vscode.workspace.openTextDocument(node.path);
        await vscode.window.showTextDocument(doc);
        await organizeActiveNote(context.globalState);
      }
    }),
  );

  // 右键 .forge → 打开成品
  context.subscriptions.push(
    vscode.commands.registerCommand("noteForge.openTarget", async () => {
      const node = treeView.selection[0];
      if (node?.kind === "forge") {
        const target = resolvePairing(node.path).targetPath;
        if (fs.existsSync(target)) {
          const doc = await vscode.workspace.openTextDocument(target);
          await vscode.window.showTextDocument(doc);
        } else {
          vscode.window.showWarningMessage("还没有成品，先整理生成。");
        }
      }
    }),
  );

  // 右键文件夹 → 打开文件夹（系统文件管理器）
  context.subscriptions.push(
    vscode.commands.registerCommand("noteForge.openDir", () => {
      const node = treeView.selection[0];
      if (node?.kind === "dir") {
        void vscode.env.openExternal(vscode.Uri.file(node.path));
      }
    }),
  );

  // 关闭文件夹（减号按钮）：从工作区移除该课程文件夹。用命令参数传节点，避免 selection 不可靠。
  context.subscriptions.push(
    vscode.commands.registerCommand("noteForge.closeFolder", (treeItem?: vscode.TreeItem) => {
      let dirPath = treeItem?.id;
      if (!dirPath) {
        const node = treeView.selection[0];
        if (node?.kind === "dir") {
          dirPath = node.path;
        }
      }
      if (!dirPath) {
        return;
      }
      const roots = vscode.workspace.workspaceFolders ?? [];
      const idx = roots.findIndex((f) => {
        const root = f.uri.fsPath;
        return dirPath === root || dirPath!.startsWith(root + path.sep);
      });
      if (idx >= 0) {
        vscode.workspace.updateWorkspaceFolders(idx, 1);
      }
    }),
  );

  // 实时刷新：监听 .forge / .md 变化
  const forgeWatcher = vscode.workspace.createFileSystemWatcher("**/*.forge");
  const mdWatcher = vscode.workspace.createFileSystemWatcher("**/*.md");
  forgeWatcher.onDidCreate(() => provider.refresh());
  forgeWatcher.onDidDelete(() => provider.refresh());
  mdWatcher.onDidCreate(() => provider.refresh());
  mdWatcher.onDidDelete(() => provider.refresh());
  context.subscriptions.push(forgeWatcher, mdWatcher);

  // 语法诊断：打开 / 修改 .forge 时实时校验；关闭时清理。同时校验已打开的 .forge。
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(refreshDiagnostics),
    vscode.workspace.onDidChangeTextDocument((e) =>
      refreshDiagnostics(e.document),
    ),
    vscode.workspace.onDidCloseTextDocument(clearDiagnostics),
  );
  for (const doc of vscode.workspace.textDocuments) {
    refreshDiagnostics(doc);
  }

  // 文件移动 / 重命名时精确迁移快照路径，保证增量在移动后仍可用。
  context.subscriptions.push(
    vscode.workspace.onDidRenameFiles((e) =>
      migrateNodeStoresOnRename(context.globalState, e),
    ),
  );

  // 添加文件夹：支持同时查看多门课程（已有工作区则加入，否则先打开文件夹）。
  context.subscriptions.push(
    vscode.commands.registerCommand("noteForge.addFolder", () => {
      const cmd = vscode.workspace.workspaceFolders?.length
        ? "workbench.action.addRootFolder"
        : "vscode.openFolder";
      void vscode.commands.executeCommand(cmd);
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.refresh()),
  );
}

export function deactivate(): void {
  // 目前无需要清理的资源。
}
