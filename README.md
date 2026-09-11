# 三联生活周刊 · SillyTavern 第三方扩展样板

安装后自动：把「三联生活周刊」主题写入 ST 主题列表并应用，同时注入 3 条仅影响显示（`markdownOnly: true`，不改写发给模型的实际内容）的排版正则。

## 安装

1. ST 界面 → 扩展（左侧插头图标）→「安装扩展」。
2. 粘贴本仓库的 Git URL（例如 `https://github.com/kcgoofee-jpg/sillytavern-sanlian-theme`），点击安装。
3. 刷新页面。扩展会在启动时自动：
   - 读取同目录 `theme.json`，通过 `POST /api/themes/save` 写入主题列表；
   - 用 `/theme 三联生活周刊` 斜杠命令应用并在下拉框中选中它；
   - 向 `extension_settings.regex` 注入 3 条正则（按 `scriptName` 前缀「三联·」去重，不会重复添加）。
4. 看到右上角 toastr 提示「已安装『三联生活周刊』主题并注入 N 条排版正则」即成功。

## 自动更新

`manifest.json` 中 `auto_update: true`：ST 会在扩展面板检测新版本并允许一键更新（走 ST 内置的第三方扩展 git pull 逻辑，见 `scripts/extensions.js` 里 `1352行` 附近 `updateExtension`）。**主题内容的更新**由本扩展自己控制版本号：`theme.json` 里放一个非标准字段 `__sanlian_version`（整数），扩展会把已安装版本记在 `extension_settings.sanlian.version`；每次启动比较两者，版本号更高才重新保存并应用主题，避免每次刷新都覆盖用户在 ST 里对同名主题做的手动微调。当前 `theme.json` 的 `__sanlian_version` 为 1。

## 暖纸变体

仓库里另有 `theme-warm.json`（主题名「三联生活周刊·暖纸」，米色纸 #f6f1e6）。扩展只自动安装白纸版；要用暖纸版，在 用户设置 → UI 主题 → 导入 里选这个文件即可。

## 如何生成/更新 theme.json

本目录下的 `theme.json`是直接复制的：

```
cp "../三联生活周刊.json" theme.json
```

即仓库根目录 `sanlian/三联生活周刊.json` 的原样拷贝，字段结构已用 SillyTavern 1.18 的 `getThemeObject()` 导出格式核对过（`name`、`main_text_color`、`custom_css` 等键位一致，见 `scripts/power-user.js:2535`）。以后主题有修改，重新执行这条 `cp` 覆盖本文件即可；记得同时给 `__sanlian_version` +1（见上一节），否则已安装过的用户不会收到主题更新。

## 三条正则脚本

全部 `markdownOnly: true`（只影响聊天区域显示，不改写模型收到/生成的原文）、`promptOnly: false`、`placement: [AI_OUTPUT]`（只作用于 AI 消息）。

| scriptName | findRegex | replaceString | 说明 |
|---|---|---|---|
| 三联·引号 | `/"([^"\n]{1,200})"/g` | `「$1」` | 英文直引号 → 「」，单行内、不超过 200 字 |
| 三联·破折号 | `/(?<!-)--(?!-)/g` | `——` | 恰好两个连字符 → 破折号 |
| 三联·段首缩进 | `/(?<=\n)(?=[一-鿿「『])/g` | 两个全角空格 | 换行后以汉字或引号开头的段落加缩进；首段紧跟角色名前缀不缩进，标题、列表、表格、代码不受影响 |

要改规则就改 `index.js` 里的 `REGEX_SCRIPTS` 并把 `REGEX_VERSION` +1（启动时会删旧注新）；改主题则把 `theme.json` 的 `__sanlian_version` +1。

## 已在本地 ST 1.18 实机验证（2026-09-11）

- 通过 ST 自己的 `POST /api/extensions/install` 从 git URL 安装成功（`git clone --depth 1`，需要智能 HTTP，GitHub 天然满足）
- 刷新后扩展加载，主题写入 `themes/三联生活周刊.json` 并被选中，`extension_settings.regex` 出现 3 条「三联·」脚本，`extension_settings.sanlian.version` 为 1

## 发布到 GitHub

```bash
cd extension && gh repo create sillytavern-sanlian-theme --public --source=. --push
```

然后把 `manifest.json` 的 `homePage` 改成真实地址再提交一次。用户在 ST「安装扩展」里粘贴仓库 URL 即可。

## 已知限制

- **`applyTheme()` / `saveTheme()` 在 `scripts/power-user.js` 中均未 `export`**，本扩展改用 `context.executeSlashCommandsWithOptions('/theme <name>')` 触发应用（该斜杠命令内部逻辑与 UI 下拉框 `change` 事件一致，见 `scripts/power-user.js:3508`），已在本地实例验证可行。
- 未验证 `getContext()` 返回对象上是否始终带有 `themes` 数组快照（用于跳过重复保存的判断）；如果该字段不存在或结构不同，代码会退化为"每次都保存"，不影响正确性但会略增一次请求。
- 未做「用户已手动改过同名主题、不希望被覆盖」的保护，只靠 `__sanlian_version` 号做简单判断。
- 未测试卸载/重装场景下 `extension_settings.sanlian` 残留数据的清理（本样板没有实现 `cleanup`/`onDisable` 钩子）。
- `homePage` 字段仍是占位 URL `https://github.com/kcgoofee-jpg/sillytavern-sanlian-theme`，发布前需替换成真实仓库地址，否则「安装扩展」时用户粘贴的 URL 与 manifest 里的地址不一致不影响功能，但更新检测通常依赖 git remote 而非该字段本身。
- 破折号规则不区分代码块，代码块里恰好两个连字符也会被替换为破折号（仅显示层）。

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
