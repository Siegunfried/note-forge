/**
 * 语法诊断：把 validateSyntax 的纯逻辑结果渲染成 VSCode 波浪线诊断。
 * 这是「纯逻辑校验 → VSCode 界面」的粘合层。
 */

import * as vscode from "vscode";
import { validateSyntax } from "../core/validateSyntax";

/** 诊断集合：所有 .forge 文件的语法错误都写到这里，VSCode 自动渲染波浪线 + 问题面板。 */
let collection: vscode.DiagnosticCollection | undefined;

/** 初始化诊断集合（在 activate 时调用）。 */
export function initDiagnostics(context: vscode.ExtensionContext): void {
  collection = vscode.languages.createDiagnosticCollection("noteForge");
  context.subscriptions.push(collection);
}

/** 对一份 .forge 文档跑语法校验，并把错误写入诊断集合。 */
export function refreshDiagnostics(document: vscode.TextDocument): void {
  if (!collection) {
    return;
  }
  if (document.languageId !== "forge") {
    collection.delete(document.uri);
    return;
  }

  const issues = validateSyntax(document.getText());
  const diagnostics: vscode.Diagnostic[] = issues.map((issue) => {
    const line = document.lineAt(issue.line);
    // 高亮整行（从行首到行尾），让问题明显。
    const range = new vscode.Range(
      issue.line,
      line.firstNonWhitespaceCharacterIndex,
      issue.line,
      line.text.length,
    );
    return new vscode.Diagnostic(
      range,
      issue.message,
      vscode.DiagnosticSeverity.Warning,
    );
  });

  collection.set(document.uri, diagnostics);
}

/** 关闭文档时清理该文件的诊断。 */
export function clearDiagnostics(document: vscode.TextDocument): void {
  collection?.delete(document.uri);
}
