/**
 * 扩展入口：激活时注册命令与视图。
 */

import * as fs from "fs";
import * as vscode from "vscode";
import {
  organizeActiveNote,
  migrateNodeStoresOnRename,
  regenerateChapter,
  reorderChapter,
  reorderRollback,
  nodePathAtCursor,
} from "./commands/organize";
import { createNote } from "./commands/create";
import { openSettingsMenu } from "./commands/settings";
import { importPdf } from "./commands/importPdf";
import { NotesTreeProvider } from "./views/notesTree";
import {
  ChaptersTreeProvider,
  buildChapterItems,
} from "./views/chaptersTree";
import { parseForgeTree } from "./core/forgeTree";
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
    vscode.commands.registerCommand("noteForge.importPdf", importPdf),
    vscode.commands.registerCommand("noteForge.openSettings", openSettingsMenu),
  );

  // 侧边栏：符号速查视图（按四类分组）。
  const notesProvider = new NotesTreeProvider();
  const notesView = vscode.window.createTreeView("noteForge.notes", {
    treeDataProvider: notesProvider,
  });
  context.subscriptions.push(notesView);

  // 侧边栏：章节树视图（供「重新生成」范围选中）。
  const chaptersProvider = new ChaptersTreeProvider();
  const chaptersView = vscode.window.createTreeView("noteForge.chapters", {
    treeDataProvider: chaptersProvider,
  });
  context.subscriptions.push(chaptersView);

  // 侧边栏：独立「导入」入口视图（空树，靠视图欢迎页提供醒目的导入按钮）。
  const importProvider: vscode.TreeDataProvider<void> = {
    getTreeItem() {
      return new vscode.TreeItem("导入");
    },
    getChildren() {
      return [];
    },
  };
  const importView = vscode.window.createTreeView("noteForge.import", {
    treeDataProvider: importProvider,
  });
  context.subscriptions.push(importView);

  // 刷新章节树：跟随当前活动编辑器（.forge 或同名 .md 对应 .forge）。
  const refreshChapters = () => {
    const editor = vscode.window.activeTextEditor;
    let sourcePath: string | undefined;
    let items: ReturnType<typeof buildChapterItems> = [];
    if (editor) {
      const pairing = resolvePairing(editor.document.uri.fsPath);
      if (pairing.mode !== "inline") {
        sourcePath = pairing.sourcePath;
        try {
          const rawText =
            pairing.mode === "forge"
              ? editor.document.getText()
              : fs.readFileSync(pairing.sourcePath, "utf-8");
          items = buildChapterItems(parseForgeTree(rawText));
        } catch {
          items = [];
        }
      }
    }
    chaptersProvider.setContent(sourcePath, items);
  };

  // 「重新生成」：优先章节树选中项，其次光标所在行。
  context.subscriptions.push(
    vscode.commands.registerCommand("noteForge.regenerate", async () => {
      const selection = chaptersView.selection;
      if (
        selection &&
        selection.length > 0 &&
        chaptersProvider.sourcePath
      ) {
        await regenerateChapter(context.globalState, {
          sourcePath: chaptersProvider.sourcePath,
          nodePath: selection[0].path,
        });
        refreshChapters();
        return;
      }

      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const cursor = nodePathAtCursor(editor);
        if (cursor) {
          await regenerateChapter(context.globalState, cursor);
          refreshChapters();
          return;
        }
      }

      vscode.window.showWarningMessage(
        "请先在侧边栏「章节」中选择一个章节，或把光标放在 .forge 速记的某一行上。",
      );
    }),
  );

  // 「重构章节树」：先选章节范围，AI 重排该子树内节点的层级与顺序（不动内容）。
  context.subscriptions.push(
    vscode.commands.registerCommand("noteForge.reorder", async () => {
      const selection = chaptersView.selection;
      if (!(selection && selection.length > 0 && chaptersProvider.sourcePath)) {
        vscode.window.showWarningMessage(
          "请先在侧边栏「章节」中选择要重构的章节（范围）。",
        );
        return;
      }
      await reorderChapter(context.globalState, {
        sourcePath: chaptersProvider.sourcePath,
        nodePath: selection[0].path,
      });
      refreshChapters();
    }),
  );

  // 「回滚重构」：恢复到重构前的快照。
  context.subscriptions.push(
    vscode.commands.registerCommand("noteForge.reorderRollback", async () => {
      await reorderRollback(context.globalState, chaptersProvider.sourcePath);
      refreshChapters();
    }),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(refreshChapters),
  );
  refreshChapters();

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
}

export function deactivate(): void {
  // 目前无需要清理的资源。
}
