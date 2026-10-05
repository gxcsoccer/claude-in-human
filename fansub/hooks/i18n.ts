// 中英双语。语言按这个顺序定：/fansub lang 手动指定 → Claude Code 设置里的 language
// → 系统界面语言（macOS 的 AppleLanguages、Windows 的 UI 语言）→ LC_ALL / LC_MESSAGES / LANG。
// 中文环境用中文，其余一律英文。
import type { FansubLang, FansubLayout, FansubMode, FansubTrack } from '../types'

/** 把一个语言标记（zh-Hans-CN、zh_CN.UTF-8、chinese、English…）归到中或英；认不出是 null。 */
export function langOf(tag: unknown): FansubLang | null {
  if (typeof tag !== 'string') return null
  const t = tag.trim().toLowerCase()
  if (!t || t === 'c' || t === 'posix' || t.startsWith('c.')) return null
  return /^zh|chinese|中文|汉语|漢語|简体|繁體/.test(t) ? 'zh' : 'en'
}

/** `defaults read -g AppleLanguages` 的输出形如 (\n "zh-Hans-CN",\n "en-CN"\n)，第一项是界面语言。 */
export function firstAppleLanguage(out: string): string | undefined {
  return /"?([A-Za-z]{2,3}[-_A-Za-z]*)"?/.exec(out)?.[1]
}

type Strings = {
  tracks: Record<FansubTrack, string>
  modes: Record<FansubMode, string>
  layouts: Record<FansubLayout, string>
  langs: Record<FansubLang | 'auto', string>
  /** 选中项的括法：「通俗」 / [Plain] */
  picked: (s: string) => string
  // 消息下方
  footer: (water: string, n: number) => string
  // 控制台
  brand: string
  track: string
  cinema: string
  live: string
  bandStats: (water: string, n: number) => string
  trackToast: (name: string) => string
  // 放映厅
  emptyReel: [string, string]
  theEnd: string
  endStats: (n: number, water: string) => string
  best: string
  scene: (i: number, n: number) => string
  dubbing: string
  noDub: string
  waterOne: (water: string) => string
  prev: string
  play: string
  pause: string
  next: string
  subsRow: string
  original: string
  dubFailed: (reason: string) => string
  unreadable: string
  // 设置菜单
  menuTitle: string
  menuRows: { track: string; mode: string; style: string; lang: string; more: string }
  menuHint: string
  menuOpened: string
  bandMenu: string
  bandHint: string
  // 空状态、引导、换风格、分享
  dry: string
  welcome: [string, string]
  gotIt: string
  style: (name: string) => string
  redubbing: (name: string) => string
  // 命令
  description: string
  cmdTrack: (name: string) => string
  cmdMode: (name: string) => string
  cmdCinema: string
  cmdLayout: (name: string) => string
  cmdLang: (name: string) => string
  header: (track: string, mode: string) => string
  stats: (n: number, water: string) => string
  help: string[]
}

export const STRINGS: Record<FansubLang, Strings> = {
  zh: {
    tracks: { plain: '通俗', roast: '毒舌', boss: '老板', kid: '幼儿园' },
    modes: { dual: '双语', mute: '原声调暗', off: '关字幕' },
    layouts: { cinema: '居中影院条', margin: '贴身旁注' },
    langs: { auto: '跟随系统', zh: '中文', en: 'English' },
    picked: s => `「${s}」`,
    footer: (w, n) => `💧 官话含水量 ${w} · 已翻译 ${n} 句`,
    brand: '🎬 字幕组',
    track: '轨道',
    cinema: '放映厅',
    live: '同传',
    bandStats: (w, n) => `· 含水量 ${w} · ${n} 句`,
    trackToast: name => `🎬 字幕轨换成「${name}」，下一句开始生效`,
    emptyReel: ['片库还是空的。', '等 Claude 说几句官话再来。'],
    theEnd: '— 全 剧 终 —',
    endStats: (n, w) => `本片共 ${n} 句官话 · 平均含水量 ${w}`,
    best: '🏆 本场最佳翻译',
    scene: (i, n) => `第 ${i} / ${n} 幕 · Claude（一本正经地）`,
    dubbing: '字幕组连夜翻译中…',
    noDub: '（这一句还没有译稿）',
    waterOne: w => `含水量 ${w}`,
    prev: '⏮ 上一幕',
    play: '▶ 播放',
    pause: '⏸ 暂停',
    next: '下一幕 ⏭',
    subsRow: '字幕轨',
    original: '原声',
    dubFailed: reason => `字幕组罢工了（${reason}），先放原声字幕`,
    unreadable: '译稿看不懂',
    menuTitle: '🎬 字幕组设置',
    menuRows: { track: '字幕轨', mode: '显示', style: '样式', lang: '语言', more: '更多' },
    menuHint: '方向键 / Tab 移动 · 回车或按方括号前的键选择 · Esc 关闭',
    menuOpened: '🎬 已打开字幕组设置（Esc 关闭）',
    bandMenu: '⚙ 设置',
    bandHint: '跟 Claude 说「换成毒舌字幕」也行 · /fansub 更多设置',
    dry: '✅ 本条无水分',
    welcome: ['🎬 字幕组已就位', 'Claude 一打官腔，下面就会出大白话字幕。试试问它：「这段代码能上线吗？」'],
    gotIt: '知道了',
    style: name => `换风格 ▸ ${name}`,
    redubbing: name => `🎬 换成「${name}」，正在把屏幕上的字幕重配一遍…`,
    description: '字幕组：打开设置菜单（换字幕风格、显示模式、语言）',
    cmdTrack: name => `🎬 字幕轨：${name}。从下一条回复开始。`,
    cmdMode: name => `🎬 字幕模式：${name}。`,
    cmdCinema: '🎬 放映厅开场：h/l 换幕，p 暂停，o/1-4 换字幕轨。',
    cmdLayout: name => `🎬 字幕样式：${name}。`,
    cmdLang: name => `🎬 界面语言：${name}。`,
    header: (t, m) => `🎬 字幕组 · 轨道「${t}」· ${m}`,
    stats: (n, w) => `本场已翻译 ${n} 句，平均官话含水量 ${w}`,
    help: [
      '/fansub                        打开设置菜单（最简单）',
      '也可以直接跟 Claude 说：「换成毒舌字幕」「关掉字幕」「字幕用英文界面」',
      '/fansub plain|roast|boss|kid   换字幕轨（通俗 / 毒舌 / 老板 / 幼儿园）',
      '/fansub dual|mute|off          双语 / 原声调暗 / 关字幕',
      '/fansub layout                 居中影院条 ⇄ 贴身旁注',
      '/fansub cinema                 打开放映厅，回放本场官话',
      '/fansub lang zh|en|auto        界面语言（auto 跟随系统）',
      '/fansub stats                  本场统计',
    ],
  },
  en: {
    tracks: { plain: 'Plain', roast: 'Roast', boss: 'Boss', kid: 'Kid' },
    modes: { dual: 'Dual', mute: 'Muted', off: 'Off' },
    layouts: { cinema: 'centered cinema bar', margin: 'margin note' },
    langs: { auto: 'follow system', zh: '中文', en: 'English' },
    picked: s => `[${s}]`,
    footer: (w, n) => `💧 Fluff ${w} · ${n} ${n === 1 ? 'line' : 'lines'} translated`,
    brand: '🎬 Fansub',
    track: 'Track',
    cinema: 'Cinema',
    live: 'LIVE',
    bandStats: (w, n) => `· fluff ${w} · ${n} ${n === 1 ? 'line' : 'lines'}`,
    trackToast: name => `🎬 Subtitle track: ${name}, from the next reply`,
    emptyReel: ['The reel is empty.', 'Come back after Claude says something diplomatic.'],
    theEnd: '— THE END —',
    endStats: (n, w) => `${n} diplomatic ${n === 1 ? 'line' : 'lines'} · average fluff ${w}`,
    best: '🏆 Best translation',
    scene: (i, n) => `Scene ${i} / ${n} · Claude (straight-faced)`,
    dubbing: 'The fansub team is pulling an all-nighter…',
    noDub: '(no translation for this line yet)',
    waterOne: w => `fluff ${w}`,
    prev: '⏮ Prev',
    play: '▶ Play',
    pause: '⏸ Pause',
    next: 'Next ⏭',
    subsRow: 'Subs',
    original: 'Original',
    dubFailed: reason => `The fansub team walked out (${reason}); showing the original subtitles`,
    unreadable: 'unreadable reply',
    menuTitle: '🎬 Fansub settings',
    menuRows: { track: 'Track', mode: 'Display', style: 'Style', lang: 'Language', more: 'More' },
    menuHint: 'Arrows / Tab to move · Enter or the key to pick · Esc to close',
    menuOpened: '🎬 Fansub settings opened (Esc to close)',
    bandMenu: '⚙ Settings',
    bandHint: 'or tell Claude "switch to roast subtitles" · /fansub for more',
    dry: '✅ No fluff in this reply',
    welcome: ['🎬 Fansub is on', 'When Claude gets diplomatic, a plain-talk subtitle shows up below. Try asking: "Is this code ready to ship?"'],
    gotIt: 'Got it',
    style: name => `Style ▸ ${name}`,
    redubbing: name => `🎬 Switched to ${name}, re-subtitling what's on screen…`,
    description: 'Fansub: open the settings menu (subtitle style, display, language)',
    cmdTrack: name => `🎬 Subtitle track: ${name}. Takes effect from the next reply.`,
    cmdMode: name => `🎬 Subtitle mode: ${name}.`,
    cmdCinema: '🎬 Now showing: h/l to change scene, p to pause, o/1-4 to switch track.',
    cmdLayout: name => `🎬 Subtitle style: ${name}.`,
    cmdLang: name => `🎬 Language: ${name}.`,
    header: (t, m) => `🎬 Fansub · track: ${t} · ${m}`,
    stats: (n, w) => `${n} ${n === 1 ? 'line' : 'lines'} translated this session, average fluff ${w}`,
    help: [
      '/fansub                        open the settings menu (easiest)',
      'Or just tell Claude: "switch to roast subtitles", "turn subtitles off"',
      '/fansub plain|roast|boss|kid   switch subtitle track',
      '/fansub dual|mute|off          both / dim the original / subtitles off',
      '/fansub layout                 centered cinema bar ⇄ margin note',
      '/fansub cinema                 open the cinema and replay this session',
      '/fansub lang zh|en|auto        interface language (auto follows the system)',
      '/fansub stats                  this session in numbers',
    ],
  },
}

/** 给模型看的示例：跟着界面语言走，字幕本身仍按用户说话的语言写。 */
export const EXAMPLES: Record<FansubLang, Record<FansubTrack, string>> = {
  zh: {
    plain: '当前实现尚未覆盖所有边界条件。⟦只测了正常输入。⟧\n该方案在性能上存在一定的优化空间。⟦有点慢。⟧',
    roast: '当前实现尚未覆盖所有边界条件。⟦正常输入能跑，别的随缘。⟧\n该方案在性能上存在一定的优化空间。⟦慢得能泡杯茶。⟧',
    boss: '当前实现尚未覆盖所有边界条件。⟦能演示，别上生产。⟧\n该方案在性能上存在一定的优化空间。⟦用户多了要加机器。⟧',
    kid: '当前实现尚未覆盖所有边界条件。⟦只试了好走的路，坑还没踩 🕳️⟧\n该方案在性能上存在一定的优化空间。⟦它跑得像小乌龟 🐢⟧',
  },
  en: {
    plain:
      'The current implementation does not yet cover all edge cases.⟦Only the happy path is tested.⟧\nThere is some room for performance optimization.⟦It is slow.⟧',
    roast:
      'The current implementation does not yet cover all edge cases.⟦Works on sunny days only.⟧\nThere is some room for performance optimization.⟦Slow enough to brew tea.⟧',
    boss: 'The current implementation does not yet cover all edge cases.⟦Fine for a demo, not for prod.⟧\nThere is some room for performance optimization.⟦More users, more servers.⟧',
    kid: 'The current implementation does not yet cover all edge cases.⟦We only walked the easy path; the holes are still out there 🕳️⟧\nThere is some room for performance optimization.⟦It runs like a little turtle 🐢⟧',
  },
}
