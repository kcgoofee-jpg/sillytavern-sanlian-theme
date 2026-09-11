// 三联生活周刊 · SillyTavern 1.18 第三方扩展
//
// 做三件事，全部可在「扩展 → 三联生活周刊」面板里控制：
//   1. 安装主题：四种纸色——白纸 theme.json、暖纸 theme-warm.json、护眼 theme-eye.json、夜读 theme-night.json；
//      可勾选「夜读跟随系统」：系统深色模式时自动用夜读，浅色时回到所选纸色。
//      走酒馆自带的「导入主题」流程（#ui_preset_import_file），主题会直接进入酒馆的内存主题列表，
//      不需要刷新页面。旧做法是 POST /api/themes/save 再发 /theme 命令，但酒馆的主题列表只在页面启动时
//      从服务器读一次（power-user.js:1605），新主题不在内存里，/theme 找不到，只能反复刷新。
//   2. 主题更新：已安装的主题落后于扩展里的版本时，写回服务器；如果正在使用，就把新 custom_css
//      通过 #customCSS 的 input 事件（power-user.js:3345）即时应用，同样不用刷新。
//   3. 正文字体：默认思源宋体；另有霞鹜文楷屏幕版、思源黑体（均随扩展分发），以及不下载的系统宋体、系统黑体。
//   4. 排版正则（可选，默认关闭）：只改聊天显示（markdownOnly），不改聊天文件和发给模型的内容。
//      会跳过 ``` 代码块、HTML 标签内部、MVU 的 <UpdateVariable> 块，避免改坏前端卡和变量。
//
// 源码依据（相对 SillyTavern/public/）：
//   scripts/power-user.js:2443 importTheme()          导入主题：themes.push + saveTheme + 追加 <option>
//   scripts/power-user.js:4057 #ui_preset_import_file  导入按钮的 change 事件
//   scripts/power-user.js:3345 #customCSS input        写 power_user.custom_css 并应用
//   scripts/extensions/regex/engine.js:11-16          正则执行顺序：全局 → 预设 → 角色卡

import { extension_settings, getContext } from '../../../extensions.js';
import { saveSettingsDebounced, saveSettings, getRequestHeaders } from '../../../../script.js';
import { power_user } from '../../../power-user.js';

const KEY = 'sanlian';
const MODULE_URL = new URL('.', import.meta.url);

const VARIANTS = {
    white: { name: '三联生活周刊', file: 'theme.json', label: '白纸' },
    warm: { name: '三联生活周刊·暖纸', file: 'theme-warm.json', label: '暖纸' },
    eye: { name: '三联生活周刊·护眼', file: 'theme-eye.json', label: '护眼（豆沙绿）' },
    night: { name: '三联生活周刊·夜读', file: 'theme-night.json', label: '夜读（黑暗）' },
};

// 正文字体。主题正文用 --song；这里用 html body 覆盖它（比主题里的 body 优先级高，不受样式先后顺序影响）。
// 字体文件随扩展一起分发（fonts/），和酒馆同源加载，不依赖 jsDelivr 等外部 CDN。
const FONTS = {
    noto: {
        label: '思源宋体（推荐，屏幕上更清晰）',
        css: 'fonts/noto-serif-sc.css',
        song: "'Sanlian Serif', 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', 'SimSun', serif",
    },
    lxgw: {
        label: '霞鹜文楷屏幕版（楷体，柔和）',
        css: 'fonts/lxgw-wenkai-screen.css',
        song: "'Sanlian Kai', 'LXGW WenKai GB Screen', 'LXGW WenKai Screen', 'Kaiti SC', 'STKaiti', 'KaiTi', serif",
    },
    notosans: {
        label: '思源黑体（最清晰）',
        css: 'fonts/noto-sans-sc.css',
        song: "'Sanlian Sans', 'Noto Sans SC', 'Source Han Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    },
    system: { label: '系统宋体（不额外下载，笔画偏细）' },
    hei: { label: '系统黑体（苹方 / 微软雅黑，不额外下载）', song: 'var(--hei)' },
};

// ---------------------------------------------------------------------------
// 排版正则
// F：当前位置之后还剩偶数个 ```，即不在代码块里
// U：之后先遇到 </UpdateVariable> 而不是 <UpdateVariable>，说明在 MVU 变量块里 → 排除；
//    之后先遇到 %> 而不是 <%，说明在提示词模板的 EJS 代码里 → 排除（它在显示后才执行 EJS）
// ---------------------------------------------------------------------------
const REGEX_PREFIX = '三联·';
const REGEX_VERSION = 3; // 规则有改动时 +1：启动时删掉旧版「三联·」脚本，按面板勾选重新注入
const F = '(?=(?:(?:(?!```)[\\s\\S])*```(?:(?!```)[\\s\\S])*```)*(?:(?!```)[\\s\\S])*$)';
const U = '(?!(?:(?!<UpdateVariable>)[\\s\\S])*<\\/UpdateVariable>)(?!(?:(?!<%)[\\s\\S])*%>)';

const REGEX_DEFS = {
    quote: {
        scriptName: `${REGEX_PREFIX}引号`,
        label: '英文双引号改「」',
        // 前面不是 = / 字母数字 / 反斜杠（排除 HTML 属性、代码字符串），引号内不含 < > 换行，且不在标签内部
        findRegex: '/(?<![=\\w\\\\])"([^"<>\\n]{1,200})"(?![^<>]*>)' + U + F + '/g',
        replaceString: '「$1」',
    },
    dash: {
        scriptName: `${REGEX_PREFIX}破折号`,
        label: '中文之间的 -- 改破折号',
        // 两侧都是中文或中文标点才替换，CSS 变量 --xxx、代码里的 x-- 不受影响
        findRegex: '/(?<=[\\u4e00-\\u9fff，。」』！？：；])--(?=[\\u4e00-\\u9fff「『“])' + U + F + '/g',
        replaceString: '——',
    },
    indent: {
        scriptName: `${REGEX_PREFIX}段首缩进`,
        label: '中文段落首行空两格',
        // 换行后以汉字或「『开头的行；首段紧跟角色名前缀，不缩进
        findRegex: '/(?<=\\n)(?=[\\u4e00-\\u9fff「『])' + U + F + '/g',
        replaceString: '　　',
    },
};

const REGEX_PLACEMENT_AI_OUTPUT = 2; // scripts/extensions/regex/engine.js regex_placement.AI_OUTPUT

const DEFAULTS = {
    variant: 'white',
    font: 'noto',
    autoApply: true,
    followSystemDark: false,
    regex: { quote: false, dash: false, indent: false },
    themeVersion: -1,
    regexVersion: 0,
    firstRunDone: false,
};

function settings() {
    const cur = extension_settings[KEY] || {};
    // 迁移 0.2.x：version → themeVersion；之前已经装过就不再强制切换主题
    if (cur.version !== undefined && cur.themeVersion === undefined) {
        cur.themeVersion = cur.version;
        cur.firstRunDone = true;
        delete cur.version;
    }
    const merged = { ...structuredClone(DEFAULTS), ...cur };
    merged.regex = { ...DEFAULTS.regex, ...(cur.regex || {}) };
    extension_settings[KEY] = merged;
    return merged;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(check, timeout = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        if (check()) return true;
        await sleep(100);
    }
    return false;
}

async function fetchJson(file) {
    const res = await fetch(new URL(file, MODULE_URL).href, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    return res.json();
}

// ---------------------------------------------------------------------------
// 主题
// ---------------------------------------------------------------------------
function themeInList(name) {
    return [...document.querySelectorAll('#themes option')].some(o => o.value === name);
}

function currentTheme() {
    return document.querySelector('#themes')?.value;
}

async function importViaST(theme) {
    const input = document.getElementById('ui_preset_import_file');
    if (!input) throw new Error('找不到酒馆的主题导入控件 #ui_preset_import_file');
    const dt = new DataTransfer();
    dt.items.add(new File([JSON.stringify(theme)], `${theme.name}.json`, { type: 'application/json' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const ok = await waitFor(() => themeInList(theme.name));
    if (!ok) throw new Error(`导入「${theme.name}」超时`);
}

async function saveToServer(theme) {
    const res = await fetch('/api/themes/save', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(theme),
    });
    if (!res.ok) throw new Error(`/api/themes/save HTTP ${res.status}`);
}

// 扩展里各主题的最新内容（按主题名缓存）
const themeCache = {};

// 主题 CSS 第一行写着 /* sanlian-theme-version: N */（stamp.py 生成）。
// 用它判断页面里实际生效的是哪一版，不只信设置里记的版本号：
// 同一个酒馆开着多个页面时，旧页面会用内存里的旧主题写回设置，版本号和实际 CSS 就对不上。
function cssVersion(css) {
    const m = /sanlian-theme-version:\s*(\d+)/.exec(css || '');
    return m ? Number(m[1]) : 0;
}

// 当前主题是本主题、且页面里的 CSS 比扩展里的旧，就换成新的
function refreshLiveCss(force = false) {
    const theme = themeCache[currentTheme()];
    if (!theme) return false;
    const version = theme.__sanlian_version ?? 0;
    if (force || cssVersion(power_user.custom_css) < version) {
        applyLiveCss(theme.custom_css);
        return true;
    }
    return false;
}

function applyLiveCss(css) {
    // 酒馆应用主题时读的是内存里的旧副本；正在用的主题直接替换 custom_css 即可即时生效
    $('#customCSS').val(css).trigger('input');
}

function selectTheme(name) {
    $('#themes').val(name).trigger('change');
}

function isOurTheme(name) {
    return Object.values(VARIANTS).some(v => v.name === name);
}

// 切到本主题前记下原来的主题，关闭 / 删除扩展时切回去
function applyOurTheme(name) {
    const s = settings();
    const cur = currentTheme();
    if (cur && !isOurTheme(cur)) s.previousTheme = cur;
    selectTheme(name);
    // 酒馆切主题读的是页面启动时的旧副本，切完再补一次最新 CSS
    refreshLiveCss();
}

// 夜读跟随系统：勾选后，电脑 / 手机处于深色模式时用夜读，浅色模式时用面板里选的纸色
const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function targetVariant() {
    const s = settings();
    return s.followSystemDark && darkQuery?.matches ? 'night' : s.variant;
}

// 只在当前正用着本主题时才自动切换；用户切到别的主题后不打扰
function applySystemMode() {
    if (!settings().followSystemDark || !isOurTheme(currentTheme())) return;
    const name = VARIANTS[targetVariant()].name;
    if (currentTheme() !== name) applyOurTheme(name);
}

async function ensureThemes({ force = false } = {}) {
    const s = settings();
    let newest = s.themeVersion;
    for (const v of Object.values(VARIANTS)) {
        const theme = await fetchJson(v.file);
        const version = theme.__sanlian_version ?? 0;
        themeCache[theme.name] = theme;
        newest = Math.max(newest, version);
        if (!themeInList(theme.name)) {
            await importViaST(theme);
        } else if (force || s.themeVersion < version) {
            await saveToServer(theme);
        }
    }
    s.themeVersion = newest;
    refreshLiveCss(force);
    if (!s.firstRunDone) {
        if (s.autoApply) applyOurTheme(VARIANTS[targetVariant()].name);
        s.firstRunDone = true;
    }
    saveSettingsDebounced();
}

// ---------------------------------------------------------------------------
// 字体
// ---------------------------------------------------------------------------
function applyFont() {
    const font = FONTS[settings().font] || FONTS.noto;
    document.getElementById('sanlian-font-css')?.remove();
    document.getElementById('sanlian-font-var')?.remove();
    if (font.css) {
        const link = document.createElement('link');
        link.id = 'sanlian-font-css';
        link.rel = 'stylesheet';
        link.href = new URL(font.css, MODULE_URL).href;
        document.head.append(link);
    }
    if (font.song) {
        const style = document.createElement('style');
        style.id = 'sanlian-font-var';
        style.textContent = `html body { --song: ${font.song}; }`;
        document.head.append(style);
    }
}

// ---------------------------------------------------------------------------
// 正则
// ---------------------------------------------------------------------------
function buildRegex(def) {
    return {
        id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        scriptName: def.scriptName,
        findRegex: def.findRegex,
        replaceString: def.replaceString,
        trimStrings: [],
        placement: [REGEX_PLACEMENT_AI_OUTPUT],
        disabled: false,
        markdownOnly: true,
        promptOnly: false,
        runOnEdit: false,
        substituteRegex: 0,
        minDepth: null,
        maxDepth: null,
    };
}

function syncRegex() {
    const s = settings();
    if (!Array.isArray(extension_settings.regex)) extension_settings.regex = [];
    const list = extension_settings.regex;
    const removeWhere = pred => {
        for (let i = list.length - 1; i >= 0; i--) if (pred(list[i])) list.splice(i, 1);
    };
    if (s.regexVersion < REGEX_VERSION) {
        removeWhere(r => String(r?.scriptName || '').startsWith(REGEX_PREFIX));
        s.regexVersion = REGEX_VERSION;
    }
    let changed = false;
    for (const [key, def] of Object.entries(REGEX_DEFS)) {
        const idx = list.findIndex(r => r?.scriptName === def.scriptName);
        if (s.regex[key] && idx === -1) {
            list.push(buildRegex(def));
            changed = true;
        } else if (!s.regex[key] && idx !== -1) {
            list.splice(idx, 1);
            changed = true;
        } else if (idx !== -1 && list[idx].findRegex !== def.findRegex) {
            Object.assign(list[idx], { findRegex: def.findRegex, replaceString: def.replaceString, markdownOnly: true, promptOnly: false });
            changed = true;
        }
    }
    saveSettingsDebounced();
    return changed;
}

async function rerenderChat() {
    try {
        await getContext().reloadCurrentChat?.();
    } catch (err) {
        console.warn(`[${KEY}] 重新渲染聊天失败`, err);
    }
}

// ---------------------------------------------------------------------------
// 设置面板
// ---------------------------------------------------------------------------
function panelHtml(version) {
    const variantOptions = Object.entries(VARIANTS)
        .map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
    const fontOptions = Object.entries(FONTS)
        .map(([k, f]) => `<option value="${k}">${f.label}</option>`).join('');
    const regexRows = Object.entries(REGEX_DEFS)
        .map(([k, d]) => `<label class="checkbox_label"><input type="checkbox" data-sanlian-regex="${k}"><span>${d.label}</span></label>`).join('');
    return `
<div id="sanlian_settings" class="sanlian-settings">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>三联生活周刊</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
      <div class="sanlian-body">
      <div class="sanlian-row">
        <label for="sanlian_variant">纸色</label>
        <select id="sanlian_variant" class="text_pole">${variantOptions}</select>
      </div>
      <div class="sanlian-row">
        <label for="sanlian_font">正文字体</label>
        <select id="sanlian_font" class="text_pole">${fontOptions}</select>
      </div>
      <div class="sanlian-row">
        <div id="sanlian_apply" class="menu_button">应用所选主题</div>
        <div id="sanlian_reinstall" class="menu_button">重新安装主题文件</div>
      </div>
      <label class="checkbox_label"><input type="checkbox" id="sanlian_followdark"><span>夜读跟随系统（系统深色模式时自动用夜读）</span></label>
      <label class="checkbox_label"><input type="checkbox" id="sanlian_autoapply"><span>首次安装时自动切换到本主题</span></label>
      <hr>
      <b>排版正则</b>
      <small>只改聊天显示，不改聊天文件，也不改发给模型的内容。默认全部关闭。代码块、HTML 标签内部、MVU 变量更新块会自动跳过。</small>
      ${regexRows}
      <small id="sanlian_status" class="sanlian-status">扩展 ${version}</small>
      </div>
    </div>
  </div>
</div>`;
}

function refreshPanel() {
    const s = settings();
    $('#sanlian_variant').val(s.variant);
    $('#sanlian_font').val(s.font);
    $('#sanlian_autoapply').prop('checked', s.autoApply);
    $('#sanlian_followdark').prop('checked', s.followSystemDark);
    for (const key of Object.keys(REGEX_DEFS)) {
        $(`[data-sanlian-regex="${key}"]`).prop('checked', !!s.regex[key]);
    }
}

function setStatus(text) {
    $('#sanlian_status').text(text);
}

function bindPanel(version) {
    $('#sanlian_variant').on('change', function () {
        const s = settings();
        s.variant = String($(this).val());
        saveSettingsDebounced();
        if (targetVariant() !== s.variant) {
            toastr.info('系统正处于深色模式，先用夜读；切回浅色模式后换成所选纸色', '三联生活周刊');
        }
        applyOurTheme(VARIANTS[targetVariant()].name);
    });
    $('#sanlian_font').on('change', function () {
        settings().font = String($(this).val());
        saveSettingsDebounced();
        applyFont();
    });
    $('#sanlian_apply').on('click', () => applyOurTheme(VARIANTS[targetVariant()].name));
    $('#sanlian_followdark').on('change', function () {
        settings().followSystemDark = $(this).prop('checked');
        saveSettingsDebounced();
        if (isOurTheme(currentTheme())) applyOurTheme(VARIANTS[targetVariant()].name);
    });
    $('#sanlian_reinstall').on('click', async () => {
        try {
            await ensureThemes({ force: true });
            setStatus(`扩展 ${version} · 主题版本 ${settings().themeVersion} · 已重新安装`);
        } catch (err) {
            console.error(`[${KEY}]`, err);
            toastr.error(String(err.message || err), '三联生活周刊');
        }
    });
    $('#sanlian_autoapply').on('change', function () {
        settings().autoApply = $(this).prop('checked');
        saveSettingsDebounced();
    });
    $('[data-sanlian-regex]').on('change', async function () {
        const key = $(this).data('sanlian-regex');
        settings().regex[key] = $(this).prop('checked');
        if (syncRegex()) await rerenderChat();
    });
}

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------
let resolveInit;
const initDone = new Promise(r => { resolveInit = r; });

jQuery(async () => {
    let version = '';
    try {
        version = (await fetchJson('manifest.json')).version || '';
    } catch { /* 版本号只用于显示 */ }

    const host = $('#extensions_settings2').length ? $('#extensions_settings2') : $('#extensions_settings');
    applyFont();
    host.append(panelHtml(version));
    refreshPanel();
    bindPanel(version);

    // 用户在酒馆自己的主题下拉框里切到本主题时，也补一次最新 CSS
    $('#themes').on('change', () => setTimeout(() => {
        if (refreshLiveCss()) saveSettingsDebounced();
    }, 50));

    try {
        await ensureThemes();
        applySystemMode();
        darkQuery?.addEventListener('change', applySystemMode);
        if (syncRegex()) await rerenderChat();
        refreshPanel();
        setStatus(`扩展 ${version} · 主题版本 ${settings().themeVersion}`);
    } catch (err) {
        console.error(`[${KEY}] 初始化失败`, err);
        toastr.error(String(err.message || err), '三联生活周刊');
    }
    resolveInit();
});

// ---------------------------------------------------------------------------
// 酒馆扩展钩子（manifest.json hooks → 这里的同名导出函数，extensions.js:406 callExtensionHook）
//   install：装完酒馆会导入本脚本并调用，此时主题已导入；存盘后刷新一次，让加载页和全部样式按新主题出现
//   disable / delete：切回安装前的主题，撤掉本扩展注入的正则；酒馆随后自己刷新（extensions.js:490）
// ---------------------------------------------------------------------------
function removeOurRegexScripts() {
    const list = extension_settings.regex;
    if (!Array.isArray(list)) return;
    for (let i = list.length - 1; i >= 0; i--) {
        if (String(list[i]?.scriptName || '').startsWith(REGEX_PREFIX)) list.splice(i, 1);
    }
}

async function restoreAndClean() {
    const s = settings();
    const cur = currentTheme();
    if (isOurTheme(cur)) {
        const options = [...document.querySelectorAll('#themes option')].map(o => o.value);
        const fallback = [s.previousTheme, 'Default', ...options].find(n => n && !isOurTheme(n) && themeInList(n));
        if (fallback) selectTheme(fallback);
    }
    removeOurRegexScripts();
    s.firstRunDone = false; // 重新启用时再自动切换一次
    await saveSettings();
}

export async function onInstall() {
    await initDone;
    await saveSettings();
    location.reload();
}

export async function onDisable() {
    try {
        await restoreAndClean();
    } catch (err) {
        console.error(`[${KEY}] 关闭时清理失败`, err);
    }
}

export async function onDelete() {
    await onDisable();
}
