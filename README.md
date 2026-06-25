# PaperCraft AI

> 版本：v0.8 CodeMirror Workbench  
> Version: v0.8 CodeMirror Workbench

本地运行的 LaTeX 论文 AI 写作工作台。选中文本后，PaperCraft 会携带选区前后各 3 个段落，生成保守修订、学术强化和精简表达三个版本，并解释修改理由；用户可以一键替换、撤销，也可以只查看建议而不改动原文。

A local AI writing workbench for LaTeX papers. Select a passage, and PaperCraft sends the surrounding 3 paragraphs before and after the selection to generate three rewrite versions: conservative, academic, and concise. Each version includes a short reason. You can apply a version with undo support, or review suggestions without changing the source.

界面支持中文/英文切换。点击顶部 `中 / EN` 按钮即可切换产品界面语言；该功能只切换按钮、标题、状态、空态和操作提示，不翻译论文内容、AI 输出、编译日志、项目文件名或用户自定义提示词。

The interface supports Chinese/English switching. Click the `中 / EN` button in the top toolbar to switch UI language. This changes interface labels, buttons, states, empty views, and operation hints only. It does not translate paper content, AI output, compile logs, project file names, or custom writing prompts.

## 启动 / Start

macOS 可以直接双击 `启动论文编辑器.command`。启动器会自动启动本地 Python 服务并打开浏览器；关闭启动器终端窗口即可停止服务。

On macOS, double-click `启动论文编辑器.command`. The launcher starts the local Python service and opens the browser. Close the launcher terminal window to stop the service.

也可以在终端手动启动：

You can also start it manually:

```bash
python3 server.py
```

默认打开 `http://localhost:8000`。未配置模型密钥时，润色、反馈和对话会使用离线演示结果。

Open `http://localhost:8000`. If no model key is configured, rewrite, feedback, and chat use offline demo responses.

## 打开论文项目 / Open A Paper Project

- 点击顶部“打开文件”只打开单个可编辑文件，支持 `.tex`、`.latex`、`.bib`、`.sty`、`.cls`、`.bst`、`.rtx`、`.txt`、`.text`、`.md` 和 `.docx`。
- Click “Open File” to open one editable file only. Supported types include `.tex`, `.latex`, `.bib`, `.sty`, `.cls`, `.bst`, `.rtx`, `.txt`, `.text`, `.md`, and `.docx`.
- `.docx` 会由本地后端提取正文为纯文本，不保留 Word 样式、图片、批注、修订痕迹或版式。
- `.docx` files are converted by the local backend into editable plain text. Word styles, images, comments, tracked changes, and layout are not preserved.
- 旧版 `.doc` 暂不支持，请另存为 `.docx` 或文本格式后再打开。
- Legacy `.doc` files are not supported. Save them as `.docx` or text before opening.
- 点击“打开项目”可以选择完整论文文件夹，并在授权后自动写回原文本文件。

- Click “Open Project” to select a full paper folder. With directory permission, text edits are written back to the original files.
- ZIP 项目请点击“从 ZIP 创建项目”。应用会在 `projects/` 下创建 ZIP 同名可见项目文件夹；重名时自动创建 `-2`、`-3` 等编号目录，不覆盖已有项目。
- For ZIP projects, click “Create Project from ZIP”. The app creates a visible project folder under `projects/` with the ZIP name. Existing folders are not overwritten; `-2`, `-3`, and later suffixes are used when needed.
- 顶部“导出 ZIP”会导出当前编辑后的完整项目，包括文本、图片、PDF 和未知二进制资源。
- “Export ZIP” exports the current edited project, including text, images, PDFs, and unknown binary resources.

项目内容仅在本机浏览器和本地 Python 服务中处理。完整项目会自动保存到 IndexedDB，下次启动时恢复上次项目、当前文件、滚动位置、光标和选区。顶部状态会显示编辑中、保存中、已保存到原文件、已保存到项目文件夹、已自动保存或保存失败。

Project data stays on your machine, inside the browser and the local Python service. The full project is saved to IndexedDB and restored on next launch, including current file, scroll position, cursor, and selection. The top status shows editing, saving, saved to source file, saved to project folder, auto-saved, or save failed.

## 论文工作台 / Paper Workbench

- 左侧文件树支持 Tex、BibTeX、样式、类、BST、RTX 等文本文件查看和编辑。
- The file tree supports viewing and editing Tex, BibTeX, style, class, BST, and RTX text files.
- PDF 与常见图片资源可以在文件树中预览。
- PDFs and common image assets can be previewed from the file tree.
- `main.tex` 会被优先识别为主文件。
- `main.tex` is preferred as the main file.
- 文件树、编辑区、AI 控制区和结果区均可拖拽调整宽度；布局会自动保存。

- The file tree, editor, AI control pane, and result pane are resizable; layout is saved automatically.
- LaTeX 长行按编辑区宽度软换行，不修改源文件真实换行。
- Long LaTeX lines soft-wrap to the editor width without changing source line breaks.
- `Command/Ctrl+F` 打开当前文件搜索替换。
- `Command/Ctrl+F` opens search and replace for the current file.
- 双击或 `Command/Ctrl` 点击 `\cite{}`、`\ref{}`、`\input{}`、`\include{}`、`\includegraphics{}` 可跳转到引用、标签、子文件或资源。
- Double-click or `Command/Ctrl` click `\cite{}`, `\ref{}`, `\input{}`, `\include{}`, or `\includegraphics{}` to jump to citations, labels, child files, or resources.

## AI 写作功能 / AI Writing Features

- 写作目标通过下拉列表选择：全部版本、保守修订、学术强化、精简表达。
- Writing goal options: all versions, conservative edit, academic tone, and concise version.
- 每个目标都有独立可编辑提示词，修改后保存到浏览器本地；“恢复默认”只重置当前目标。
- Each goal has its own editable prompt. Changes are saved locally in the browser. “Reset Default” only resets the current goal.
- AI 润色结果显示修改理由和逐词 Diff，绿色表示新增，红色表示删除。
- AI rewrite cards show reasons and word-level diff. Green means added text; red means removed text.
- “写作反馈”卡片会生成 3-5 条非侵入式建议，只提示表达、逻辑、过渡、结构或证据问题，不自动修改源码。

- The “Writing Feedback” card generates 3-5 non-invasive suggestions about expression, logic, transitions, structure, or evidence. It never edits source automatically.
- 右侧“对话”标签支持围绕整个项目提问。项目级对话会尽量携带文本上下文，二进制资源只作为清单提供。
- The “Chat” tab supports project-level questions. The request includes as much text context as possible; binary files are sent only as a resource manifest.
- AI 生成的跨文件修改建议必须先展示预览，只有点击“应用这处修改”后才会写入文本文件并进入自动保存。
- Cross-file changes proposed by AI must be previewed first. They are written only after you click “Apply this change”, then enter the existing auto-save flow.

## LaTeX 编译与 PDF 预览 / LaTeX Compile And PDF Preview

点击“编译 PDF”会在本机临时目录编译项目，成功后直接切换到右侧 PDF 标签预览；预览区提供“下载 PDF”和“全屏浏览”按钮，全屏浏览会在新标签打开浏览器独立 PDF 预览器并请求 250% 缩放。“保存后自动编译”开关默认关闭，开启后会在保存后延迟自动刷新 PDF。

Click “Compile PDF” to compile the project in a local temporary directory. On success, the app switches to the PDF tab and shows the preview. The preview toolbar provides “Download PDF” and “Fullscreen”; fullscreen opens the browser’s standalone PDF viewer in a new tab with 250% zoom. “Auto compile after save” is off by default and refreshes the PDF after saved edits when enabled.

本地编译需要安装 `latexmk`、`pdflatex` 或 `xelatex`。服务会检查 `/Library/TeX/texbin`、Homebrew、项目 `tools` 目录和 `LATEX_ENGINE`。直接使用 XeLaTeX/PDFLaTeX 时，服务会在需要时执行 BibTeX 并再排版两次；构建禁用 shell-escape，总超时为 90 秒。未安装工具链时会返回明确诊断。

Local compile requires `latexmk`, `pdflatex`, or `xelatex`. The service checks `/Library/TeX/texbin`, Homebrew, the project `tools` directory, and `LATEX_ENGINE`. When using XeLaTeX/PDFLaTeX directly, the service runs BibTeX when needed and typesets twice more. Builds disable shell-escape and share a 90-second timeout. If the toolchain is missing, the app returns a clear diagnostic.

编译结果优先通过本地 `/api/pdf/` 地址预览，并支持 HEAD 与 Range 分段读取；本地地址失效时前端会回退到本次编译生成的 Blob 缓存。编译失败、工具链缺失或存在诊断时会显示诊断面板，并支持点击错误跳回源码。当前尚未实现 SyncTeX 源码与 PDF 双向定位，也尚未接入 Monaco 语法高亮。

Compiled PDFs are previewed through local `/api/pdf/` URLs with HEAD and Range support. If the local URL expires, the frontend falls back to the Blob cache from the current compile response. Compile failures, missing toolchains, and diagnostics appear in the compile panel, and errors can jump back to source lines. SyncTeX source/PDF two-way navigation and Monaco syntax highlighting are not implemented yet.

## 接入模型 / Model Configuration

模型统一在 `model_config.json` 中配置。修改配置后无需重启服务，下一次润色、反馈或对话请求会自动读取最新内容。

Models are configured in `model_config.json`. Changes are reloaded on the next rewrite, feedback, or chat request without restarting the service.

1. 将 `active_provider` 改为要使用的配置名称，例如 `deepseek`、`anthropic` 或 `relay`。
2. 在对应提供商中填写 `api_key`，或使用 `env:MY_MODEL_KEY` 从环境变量读取。
3. 根据账号实际可用模型修改 `model`。

English:

1. Set `active_provider` to the provider name you want, such as `deepseek`, `anthropic`, or `relay`.
2. Fill `api_key` for that provider, or use `env:MY_MODEL_KEY` to read it from an environment variable.
3. Set `model` to a model available to your account.

中转站示例 / Relay example:

```json
{
  "active_provider": "relay",
  "providers": {
    "relay": {
      "type": "openai_compatible",
      "api_key": "sk-your-key",
      "base_url": "https://your-relay.example.com/v1",
      "model": "your-model-name",
      "json_mode": true,
      "extra_headers": {}
    }
  }
}
```

内置配置包括 OpenAI/OpenAI-compatible、Anthropic Claude、Google Gemini、DeepSeek、通义千问、Kimi、智谱 GLM 和硅基流动。`base_url` 可以填写服务根地址或完整 `chat/completions` 地址；少数中转站不支持 JSON Mode 时，将 `json_mode` 设为 `false`；需要特殊请求头时填写 `extra_headers`。

Built-in templates include OpenAI/OpenAI-compatible, Anthropic Claude, Google Gemini, DeepSeek, Alibaba Qwen, Kimi, Zhipu GLM, and SiliconFlow. `base_url` can be either a service root or a full `chat/completions` URL. Set `json_mode` to `false` for relays that do not support JSON Mode. Use `extra_headers` for special relay headers.

密钥只由本地 Python 服务读取，不会发送到浏览器。`model_config.json` 已加入 `.gitignore`，不要将真实密钥提交到版本库。模型请求优先使用系统 `curl`，API Key 通过仅当前用户可读的临时请求头文件传递，并在请求结束后立即删除；没有 `curl` 时回退到 Python urllib。

API keys are read only by the local Python service and are never sent to browser code. `model_config.json` is ignored by Git; do not commit real keys. Model requests prefer system `curl`; API keys are passed through a temporary header file readable only by the current user and deleted immediately after the request. If `curl` is unavailable, the service falls back to Python urllib.
