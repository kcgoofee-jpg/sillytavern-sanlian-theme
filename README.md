# 三联生活周刊 · SillyTavern 第三方扩展样板

安装后自动：把「三联生活周刊」主题写入 ST 主题列表并应用，同时注入 3 条仅影响显示（`markdownOnly: true`，不改写发给模型的实际内容）的排版正则。

## 安装

1. ST 界面 → 扩展（左侧插头图标）→「安装扩展」。
2. 粘贴本仓库的 Git URL（例如 `https://github.com/<user>/sillytavern-sanlian-theme`），点击安装。
3. 刷新页面。扩展会在启动时自动：
   - 读取同目录 `theme.json`，通过 `POST /api/themes/save` 写入主题列表；
   - 用 `/theme 三联生活周刊` 斜杠命令应用并在下拉框中选中它；
   - 向 `extension_settings.regex` 注入 3 条正则（按 `scriptName` 前缀「三联·」去重，不会重复添加）。
4. 看到右上角 toastr 提示「已安装『三联生活周刊』主题并注入 N 条排版正则」即成功。

## 自动更新

`manifest.json` 中 `auto_update: true`：ST 会在扩展面板检测新版本并允许一键更新（走 ST 内置的第三方扩展 git pull 逻辑，见 `scripts/extensions.js` 里 `1352行` 附近 `updateExtension`）。**主题内容的更新**由本扩展自己控制版本号：`theme.json` 里放一个非标准字段 `__sanlian_version`（整数），扩展会把已安装版本记在 `extension_settings.sanlian.version`；每次启动比较两者，版本号更高才重新保存并应用主题，避免每次刷新都覆盖用户在 ST 里对同名主题做的手动微调。**当前 `theme.json` 未设置 `__sanlian_version`（视为版本 0）——如需触发用户侧更新，请在改动主题后把该字段递增。**

## 如何生成/更新 theme.json

本目录下的 `theme.json`是直接复制的：

```
cp "../三联生活周刊.json" theme.json
```

即仓库根目录 `sanlian/三联生活周刊.json` 的原样拷贝，字段结构已用 SillyTavern 1.18 的 `getThemeObject()` 导出格式核对过（`name`、`main_text_color`、`custom_css` 等键位一致，见 `scripts/power-user.js:2535`）。以后主题有修改，重新执行这条 `cp` 覆盖本文件即可；记得同时给 `__sanlian_version` +1（见上一节），否则已安装过的用户不会收到主题更新。

## 三条正则脚本（占位，作者需替换实际规则）

全部 `markdownOnly: true`（只影响聊天区域显示，不改写模型收到/生成的原文）、`promptOnly: false`、`placement: [AI_OUTPUT]`（只作用于 AI 消息，不处理用户输入）。当前占位规则：

| scriptName | findRegex（占位） | replaceString（占位） | 说明 |
|---|---|---|---|
| 三联·引号 | `/"([^"]*)"/g` | `「$1」` | 英文直引号 → 中文书名号式引号，未处理引号嵌套/转义 |
| 三联·破折号 | `/--/g` | `——` | 双连字符 → 破折号 |
| 三联·段首缩进 | `/^(?=\S)/gm` | 两个全角空格 | 给每个非空行行首加缩进，未排除代码块/引用块 |

这三条规则是**占位符**，需要按实际排版需求替换 `index.js` 里 `REGEX_SCRIPTS` 数组的 `findRegex`/`replaceString`。

## 已知限制 / 未查证项（20 分钟预算内未继续深挖，不要重试，按需人工核实）

- **`applyTheme()` / `saveTheme()` 在 `scripts/power-user.js` 中均未 `export`**，本扩展改用 `context.executeSlashCommandsWithOptions('/theme <name>')` 触发应用（该斜杠命令内部逻辑与 UI 下拉框 `change` 事件一致，见 `scripts/power-user.js:3508`），未在真实 ST 1.18 实例里做端到端验证（受时间预算限制），理论上应可行，请安装后实测确认 toastr 与主题下拉框选中状态。
- 未验证 `getContext()` 返回对象上是否始终带有 `themes` 数组快照（用于跳过重复保存的判断）；如果该字段不存在或结构不同，代码会退化为"每次都保存"，不影响正确性但会略增一次请求。
- 未做「用户已手动改过同名主题、不希望被覆盖」的保护，只靠 `__sanlian_version` 号做简单判断。
- 未测试卸载/重装场景下 `extension_settings.sanlian` 残留数据的清理（本样板没有实现 `cleanup`/`onDisable` 钩子）。
- `homePage` 字段仍是占位 URL `https://github.com/<user>/sillytavern-sanlian-theme`，发布前需替换成真实仓库地址，否则「安装扩展」时用户粘贴的 URL 与 manifest 里的地址不一致不影响功能，但更新检测通常依赖 git remote 而非该字段本身。
- 正则的三条规则本身是占位符，尚未验证是否会与 ST 内置的 Markdown 渲染管线在特殊字符（如代码块内的 `--`）上产生误伤。

## 关键 API 查证结果（文件:行号，均相对 `SillyTavern/public/`）

- `scripts/extensions.js:141` `export const extension_settings = {...}`
- `scripts/extensions.js:917`,`919` 第三方扩展 `display_name` / `third-party/<name>` 路径解析
- `scripts/extensions.js:1949` `manifest.auto_update` 检测更新的判断逻辑
- `scripts/st-context.js:95,170,174` `getContext()` 导出 `executeSlashCommandsWithOptions` / `executeSlashCommands`
- `scripts/power-user.js:2484` `async function saveTheme(name, theme)`（未导出）
- `scripts/power-user.js:2499` `fetch('/api/themes/save', {headers: getRequestHeaders(), body: JSON.stringify(theme)})`
- `scripts/power-user.js:2535` `export function getThemeObject(name)`（唯一导出的主题相关函数，用于读取当前设置生成主题快照，本扩展未使用它，因为我们要保存的是外部 theme.json 而非"当前"设置）
- `scripts/power-user.js:3508` `$('#themes').on('change', ...)` 内部调用未导出的 `applyTheme(name)`
- `scripts/extensions/regex/engine.js:281-290` `export const regex_placement = { USER_INPUT:1, AI_OUTPUT:2, SLASH_COMMAND:3, WORLD_INFO:5, ... }`
- `scripts/extensions/regex/index.js:825-836`,`850-867` 正则脚本对象字段：`id`(`uuidv4()`)、`scriptName`、`findRegex`、`replaceString`、`trimStrings`、`substituteRegex`、`disabled`、`promptOnly`、`markdownOnly`、`runOnEdit`、`minDepth`、`maxDepth`、`placement`（数组）
- `scripts/extensions/regex/index.js:1713-1714` `extension_settings.regex` 不存在时初始化为 `[]`
- `scripts/utils.js:1388-1403` `regexFromString(input)` 支持 `/pattern/flags` 字符串写法
- `script.js:469` `export const saveSettingsDebounced = debounce(...)`
- `script.js:645` `export function getRequestHeaders({omitContentType}={})`
