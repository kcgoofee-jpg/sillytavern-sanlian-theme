// 三联生活周刊 主题 + 只读排版正则 · SillyTavern 1.18 第三方扩展
//
// API 查证（源码路径均相对于 SillyTavern/public/）：
// - scripts/extensions.js:141      export const extension_settings = {...}
// - scripts/extensions.js:917/919  第三方扩展目录名/展示名解析 (third-party/<name>)
// - scripts/st-context.js:95,170,174
//                                   getContext() 导出 executeSlashCommandsWithOptions / executeSlashCommands
// - scripts/power-user.js:2484     async function saveTheme(name, theme) —— 未 export，扩展不可直接调用
// - scripts/power-user.js:2499     fetch('/api/themes/save', { headers: getRequestHeaders(), body: JSON.stringify(theme) })
// - scripts/power-user.js:2535     export function getThemeObject(name) —— 仅此函数被导出，用于读取"当前"主题，
//                                   本扩展改为直接读取 theme.json 内容作为待保存对象，不依赖它
// - scripts/power-user.js:3508     $('#themes').on('change', ...) 内部才调用 applyTheme(name)，
//                                   applyTheme 本身未 export，因此改用 `/theme` 斜杠命令触发同等效果
//                                   （该 slash command 的实现同文件内 setThemeSlash()，逻辑与 change 事件一致：
//                                   power_user.theme = name; applyTheme(name); saveSettingsDebounced();）
// - scripts/extensions/regex/engine.js:281-290
//                                   export const regex_placement = { USER_INPUT:1, AI_OUTPUT:2, SLASH_COMMAND:3, WORLD_INFO:5, ... }
// - scripts/extensions/regex/index.js:825-836 / 850-867
//                                   新建正则对象字段：id(uuidv4), scriptName, findRegex, replaceString, trimStrings,
//                                   substituteRegex, disabled, promptOnly, markdownOnly, runOnEdit, minDepth, maxDepth, placement(数组)
// - scripts/extensions/regex/index.js:1713-1714
//                                   extension_settings.regex 若不存在则初始化为 []，随后直接 push 新脚本对象
// - script.js:469                  export const saveSettingsDebounced = debounce(...)
// - script.js:645                  export function getRequestHeaders({omitContentType}={})

import { extension_settings, getContext } from '../../../extensions.js';
import { getRequestHeaders, saveSettingsDebounced } from '../../../../script.js';

// 目录名（third-party/<name>）由 import.meta.url 推导，避免硬编码仓库文件夹名
const MODULE_URL = new URL('.', import.meta.url); // e.g. https://host/scripts/extensions/third-party/sanlian/
const EXTENSION_KEY = 'sanlian';
const THEME_JSON_URL = new URL('theme.json', MODULE_URL).href;

// regex_placement 枚举值来自 scripts/extensions/regex/engine.js:281-290
const regex_placement = {
    USER_INPUT: 1,
    AI_OUTPUT: 2,
    SLASH_COMMAND: 3,
    WORLD_INFO: 5,
};

const REGEX_SCRIPT_PREFIX = '三联·';

// 占位正则，作者会替换具体规则内容
const REGEX_SCRIPTS = [
    {
        scriptName: `${REGEX_SCRIPT_PREFIX}引号`,
        findRegex: '/"([^"\\n]{1,200})"/g', // 英文直引号 → 「」（仅显示层）
        replaceString: '「$1」',
    },
    {
        scriptName: `${REGEX_SCRIPT_PREFIX}破折号`,
        findRegex: '/(?<!-)--(?!-)/g', // 双连字符 → 破折号 ——
        replaceString: '——',
    },
    {
        scriptName: `${REGEX_SCRIPT_PREFIX}段首缩进`,
        findRegex: '/^(?=[\\u4e00-\\u9fff「『])/gm', // 以汉字或引号开头的段落加两个全角空格（跳过标题、列表、表格）
        replaceString: '\u3000\u3000',
    },
];

function buildRegexScriptObject(partial) {
    return {
        id: (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`),
        scriptName: partial.scriptName,
        findRegex: partial.findRegex,
        replaceString: partial.replaceString,
        trimStrings: [],
        placement: [regex_placement.AI_OUTPUT], // 只作用于 AI 输出
        disabled: false,
        markdownOnly: true, // 仅显示层生效，不改写实际消息内容/发给模型的内容
        promptOnly: false,
        runOnEdit: false,
        substituteRegex: 0,
        minDepth: null,
        maxDepth: null,
    };
}

async function fetchThemeJson() {
    try {
        const response = await fetch(THEME_JSON_URL, { cache: 'no-store' });
        if (!response.ok) {
            console.error(`[${EXTENSION_KEY}] theme.json 获取失败: HTTP ${response.status}`);
            return null;
        }
        return await response.json();
    } catch (err) {
        console.error(`[${EXTENSION_KEY}] theme.json 获取异常:`, err);
        return null;
    }
}

async function ensureThemeInstalled(context) {
    const theme = await fetchThemeJson();
    if (!theme || !theme.name) {
        toastr.error('三联生活周刊主题：theme.json 缺失或无效，跳过主题安装。', '三联生活周刊');
        return false;
    }

    // theme.json 内嵌一个非标准字段 __sanlian_version 由本扩展自己维护版本比对（如不存在则视为版本 0）
    const themeVersion = theme.__sanlian_version ?? 0;
    const installedVersion = extension_settings[EXTENSION_KEY]?.version ?? -1;

    const themesList = context?.themes ?? [];
    const alreadyPresent = Array.isArray(themesList) && themesList.some(t => t.name === theme.name);

    if (alreadyPresent && installedVersion >= themeVersion) {
        // 已存在且版本不落后，跳过重复保存，仅确保已应用
        return true;
    }

    try {
        const response = await fetch('/api/themes/save', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(theme),
        });

        if (!response.ok) {
            console.error(`[${EXTENSION_KEY}] /api/themes/save 失败: HTTP ${response.status}`);
            toastr.error('三联生活周刊主题保存失败，请检查控制台。', '三联生活周刊');
            return false;
        }
    } catch (err) {
        console.error(`[${EXTENSION_KEY}] /api/themes/save 异常:`, err);
        return false;
    }

    // applyTheme()/saveTheme() 未从 power-user.js 导出（已查证，见文件顶部注释），
    // 服务端保存后用 /theme 斜杠命令触发前端应用 + 选中下拉框，效果与直接调用 applyTheme 一致。
    try {
        if (context?.executeSlashCommandsWithOptions) {
            await context.executeSlashCommandsWithOptions(`/theme ${theme.name}`, { showOutput: false });
        } else if (context?.executeSlashCommands) {
            await context.executeSlashCommands(`/theme ${theme.name}`);
        } else {
            console.warn(`[${EXTENSION_KEY}] context 未提供 slash command 执行函数，主题已保存但未自动应用，请手动在 界面外观 中选择"${theme.name}"。`);
        }
    } catch (err) {
        console.error(`[${EXTENSION_KEY}] 应用主题失败:`, err);
    }

    extension_settings[EXTENSION_KEY] = extension_settings[EXTENSION_KEY] || {};
    extension_settings[EXTENSION_KEY].version = themeVersion;
    return true;
}

function ensureRegexScriptsInjected() {
    if (!Array.isArray(extension_settings.regex)) {
        extension_settings.regex = [];
    }

    const existingNames = new Set(extension_settings.regex.map(s => s.scriptName));
    let injectedCount = 0;

    for (const partial of REGEX_SCRIPTS) {
        if (existingNames.has(partial.scriptName)) {
            continue; // 按 scriptName 前缀「三联·」去重
        }
        extension_settings.regex.push(buildRegexScriptObject(partial));
        injectedCount++;
    }

    return injectedCount;
}

(async function init() {
    try {
        const context = getContext();

        const themeOk = await ensureThemeInstalled(context);
        const injectedCount = ensureRegexScriptsInjected();

        saveSettingsDebounced();

        if (themeOk && injectedCount > 0) {
            toastr.info(`已安装「三联生活周刊」主题并注入 ${injectedCount} 条排版正则（仅显示，不影响发送给模型的内容）。`, '三联生活周刊');
        } else if (themeOk) {
            toastr.info('「三联生活周刊」主题已是最新，未新增正则脚本。', '三联生活周刊');
        } else if (injectedCount > 0) {
            toastr.info(`主题安装失败，但已注入 ${injectedCount} 条排版正则。`, '三联生活周刊');
        }
    } catch (err) {
        console.error(`[${EXTENSION_KEY}] 初始化失败:`, err);
        if (typeof toastr !== 'undefined') {
            toastr.error('三联生活周刊扩展初始化失败，请查看控制台。', '三联生活周刊');
        }
    }
})();
