/**
 * 扩展入口：激活时注册命令。
 */

import * as vscode from "vscode";
import { organizeActiveNote } from "./commands/organize";
import { createNote } from "./commands/create";
import { WelcomeProvider } from "./views/welcomeTree";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("noteForge.organize", () =>
      organizeActiveNote(context.globalState),
    ),
    vscode.commands.registerCommand("noteForge.create", createNote),
  );

  // 侧边栏欢迎视图：图标点开后显示用法说明。
  context.subscriptions.push(
    vscode.window.createTreeView("noteForge.welcome", {
      treeDataProvider: new WelcomeProvider(),
    }),
  );
}

export function deactivate(): void {
  // 目前无需要清理的资源。
}
