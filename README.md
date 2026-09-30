# Note Forge — 速记整理助手

> 用符号标记课堂速记，AI 自动补全成完整结构化笔记。VSCode 插件版。

## 这是什么

上课时你只需要用**关键词 + 10 个符号**记下要点，按 `Ctrl+Enter`，插件会：

1. 用内置的整理规则（符号表 + 提示词）处理速记
2. 把速记文本交给 DeepSeek（或任意 OpenAI 兼容接口）
3. 返回结构完整、标注清晰的 Markdown 笔记，写到同名的 `.md` 成品（你的 `.forge` 原样保留）

整理出的成品里，AI 补的内容都用 `【补】【详解】【例】` 等标注区分，绝不和你的原文混充。

## 特性

- 🎨 **符号高亮**：10 个标记符号在行首自动着色（颜色跟随当前主题）
- 🔀 **两条数据流**：速记存 `.forge`，成品生成到同名 `.md`，两者永不互相覆盖
- 📁 **内置整理规则**：符号表与提示词随扩展内置，无需配置
- 🔌 **可换模型**：默认 DeepSeek，也可指向任意 OpenAI 兼容接口

## 两条数据流

`.forge` 是你的**原文速记**（只读），`.md` 是**成品笔记**（只写），按 `Ctrl+Enter` 时：

| 你在哪个文件按 | 原文读哪 | 成品写到哪 |
|---|---|---|
| `xxx.forge` | `xxx.forge` 全文 | 同名 `xxx.md`（新建/覆盖），`.forge` 分毫不动 |
| `xxx.md`（旁边有同名 `.forge`） | 同名 `.forge` 全文 | 覆盖当前 `xxx.md` |
| 普通 `.md`/txt（无 `.forge`） | 选区 / 全文 | 就地整理（兼容） |

这样写和生成走两路，永不串。

## 10 个符号

| 符号 | 含义 | 助手处理 |
|------|------|---------|
| `_` | 没记完 / 没记全 | 按常规结构补全，标【补】 |
| `?` | 有疑问 / 拿不准 | 详细解答【答】+依据；查不到【待确认】 |
| `!` | 重点 | 加粗突出【重点】 |
| `~` | 大概意思 | 命题/公式→数学·逻辑符号；代码→代码块【公式化】 |
| `%` | 自己的思考 | 转成注释【思考】 |
| `#` | 需进一步解释 | 函数/代码/证明分别深化【详解】 |
| `@` | 引用外部资料（本地路径 / URL） | 读取/检索该资料并据其补充，标来源【外查】 |
| `=` | 举例说明 | 补充 / 整理具体例子【例】 |
| `$` | 要严格定义 | 严格定义 + 通俗解释【定义】 |
| `&` | 易混淆 / 对比 | 必须生成对比表【对比】 |

**规则**：标记只在**行首**生效；多行用 `符号{ ... }` 包裹；可叠加（`!?`）；`\X` 转义字面符号。

## 安装（开发）

```bash
npm install
npm run compile
# 然后在 VSCode 里按 F5 启动扩展开发宿主，
# 新建一个 .forge 速记文件，Ctrl+Enter 试试
```

## 配置

在设置（或 `settings.json`）里：

| 项 | 默认 | 说明 |
|----|------|------|
| `noteForge.apiKey` | （空） | API Key；留空时读环境变量 `DEEPSEEK_API_KEY` |
| `noteForge.apiBaseUrl` | `https://api.deepseek.com/chat/completions` | OpenAI 兼容地址 |
| `noteForge.model` | `deepseek-flash` | 模型名（快；质量优先可换 `deepseek-v4-pro`） |
| `noteForge.maxTokens` | `16384` | 单次输出 token 上限 |
| `noteForge.temperature` | `0.3` | 采样温度 |

## 项目结构（模块分层）

```
src/
├─ extension.ts           # 入口：注册命令
├─ types.ts               # 共享类型
├─ config/settings.ts     # 配置读取
├─ core/                  # 纯逻辑，无 VSCode 依赖，可单测
│  ├─ symbols.ts          # 10 符号唯一定义（单一事实来源）
│  ├─ promptLoader.ts     # 内置 prompt（符号表注入）
│  ├─ apiClient.ts        # HTTP 客户端
│  ├─ organizer.ts        # 编排：拼提示词 → 调 API
│  └─ pairing.ts          # 判定源 .forge / 成品 .md 配对
└─ commands/organize.ts   # VSCode 命令粘合层
syntaxes/
└─ notes.tmLanguage.json  # 符号高亮
```

## 已知边界

- `@` 本地文件引用支持 md / txt；**PDF 引用需额外安装 `pdfjs-dist`**（`npm install pdfjs-dist`，默认不打包以减小体积）。URL 联网检索尚未接入，见 Roadmap。
- 高亮色由主题决定（用的是通用 TextMate 作用域）；自定义 10 色见 Roadmap。
- 打开「整理后」的 Markdown 时，行首 `#` 标题也会被当作「详解」高亮——这是行首约定的固有权衡。

## Roadmap

- [ ] 课件/教材 RAG 检索（让补全更准）
- [ ] `@` 联网检索
- [ ] 素材面板 / 双栏预览（Webview）
- [ ] 语义级着色（自定义 10 色，摆脱主题依赖）

## License

[MIT](./LICENSE)
