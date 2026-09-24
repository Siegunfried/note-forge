/**
 * 「新建速记」命令：弹出保存对话框，创建 xxx.forge 空文件并打开。
 * 成品 xxx.md 与速记同目录同名，由 pairing 自动推导，无需在这里处理。
 */

import * as vscode from "vscode";

export async function createNote(): Promise<void> {
  const picked = await vscode.window.showSaveDialog({
    title: "新建速记（成品 .md 将存到同目录同名）",
    defaultUri: defaultSaveUri(),
    filters: { "Note Forge 速记": ["forge"] },
  });
  if (!picked) {
    return; // 用户取消
  }

  // 强制 .forge 后缀（用户可能没写后缀）。
  const target = picked.fsPath.toLowerCase().endsWith(".forge")
    ? picked
    : vscode.Uri.file(`${picked.fsPath}.forge`);

  await vscode.workspace.fs.writeFile(target, Buffer.from(""));
  const doc = await vscode.workspace.openTextDocument(target);
  await vscode.window.showTextDocument(doc);
}

/** 计算保存对话框的默认位置：优先工作区根目录。 */
function defaultSaveUri(): vscode.Uri | undefined {
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (wsRoot) {
    return vscode.Uri.joinPath(wsRoot, "未命名.forge");
  }
  return undefined; // 无工作区时，由系统决定默认目录
}
