/**
 * 「设置」命令：弹出菜单，跳转到 API 设置或两个快捷键的设置页。
 */

import * as vscode from "vscode";

interface SettingsItem extends vscode.QuickPickItem {
  action: () => void;
}

export async function openSettingsMenu(): Promise<void> {
  const items: SettingsItem[] = [
    {
      label: "API 设置…",
      description: "API Key、接口地址、模型",
      action: () =>
        vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "noteForge.apiKey",
        ),
    },
    {
      label: "整理笔记 快捷键…",
      description: "默认 Ctrl+Enter",
      action: () =>
        vscode.commands.executeCommand(
          "workbench.action.openGlobalKeybindings",
          "@command:noteForge.organize",
        ),
    },
    {
      label: "更新快照 快捷键…",
      description: "默认 Ctrl+Shift+Enter",
      action: () =>
        vscode.commands.executeCommand(
          "workbench.action.openGlobalKeybindings",
          "@command:noteForge.snapshot",
        ),
    },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Note Forge 设置",
  });
  if (picked) {
    picked.action();
  }
}
