import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {
  FansubLang,
  FansubLayout,
  FansubLive,
  FansubMode,
  FansubPair,
  FansubReel,
  FansubTrack,
} from '../types'
import { EXAMPLES, STRINGS, firstAppleLanguage, langOf } from './i18n'
import { beatsFor, hasSubs, pairsOf, parse, pct, streamView, strip, water } from './parse'

const TRACK = { plugin: 'fansub', key: 'track' } as const
const MODE = { plugin: 'fansub', key: 'mode' } as const
const LAYOUT = { plugin: 'fansub', key: 'layout' } as const
const LIVE = { plugin: 'fansub', key: 'live' } as const
const DUBBING = { plugin: 'fansub', key: 'dubbing' } as const
const LANG = { plugin: 'fansub', key: 'lang' } as const
const track = atom(TRACK, 'plain')
const mode = atom(MODE, 'dual')
const layout = atom(LAYOUT, 'cinema')
const pairs = atom({ plugin: 'fansub', key: 'pairs' } as const, [])
const live = atom(LIVE, null)
const reel = atom({ plugin: 'fansub', key: 'reel' } as const, { at: 0, isPlaying: false, track: 'original' })
const dubs = atom({ plugin: 'fansub', key: 'dubs' } as const, {})
const dubbing = atom(DUBBING, null)
const lang = atom(LANG, 'en')
const DRY = { plugin: 'fansub', key: 'dry' } as const
const IS_NEW = { plugin: 'fansub', key: 'isNew' } as const
const SWITCHED = { plugin: 'fansub', key: 'hasSwitched' } as const
const dry = atom(DRY, [])
const isNew = atom(IS_NEW, false)
const hasSwitched = atom(SWITCHED, false)
const BRIEFED = { plugin: 'fansub', key: 'briefed' } as const
const briefed = atom(BRIEFED, null)

/** 一段回复的指纹：结尾 120 个字，用来认出「整轮没有官话」的那段。 */
const fingerprint = (text: string) => text.trim().slice(-120)

const PANE = 'fansub-cinema'
const MENU = 'fansub-menu'
const SUB_FG = '#FFD84D'
const SUB_BG = '#000000'

// 控制台上的换轨键只用字母：输入框为空时，单敲一个数字会按下控制台的按钮，
// 绑数字的话打「1. 帮我……」开头的消息就会误切字幕轨。放映厅里没这个问题，仍用 1-4。
const TRACKS: Record<FansubTrack, { hotkey: string; brief: string }> = {
  plain: { hotkey: 'p', brief: 'Plain talk. Say bluntly what the sentence actually means, like a frank colleague would.' },
  roast: {
    hotkey: 'r',
    brief: 'Roast. A snarky friend heckling in the danmaku: sharp, funny, self-deprecating about Claude, never insulting the user.',
  },
  boss: {
    hotkey: 'b',
    brief: 'What the boss hears. Translate into the only things a manager cares about: will it ship, is it late, does it cost money, is there risk.',
  },
  kid: { hotkey: 'k', brief: 'Explain it to a five-year-old, with one emoji.' },
}
const TRACK_IDS = Object.keys(TRACKS) as FansubTrack[]
const MODE_IDS: FansubMode[] = ['dual', 'mute', 'off']

type Prefs = { track?: FansubTrack; mode?: FansubMode; layout?: FansubLayout; lang?: FansubLang | 'auto' }

function section(t: FansubTrack, l: FansubLang): string {
  return `# Subtitles (fansub)
This note comes from the user's fansub plugin, not from the user. Their terminal shows your replies like a film with subtitles underneath. Keep speaking exactly as you normally would: precise, professional, measured. Do not change your own register.

But right after any sentence that is diplomatic, hedged, euphemistic, jargon-heavy, or that softens an inconvenient fact, append a subtitle wrapped in ⟦ and ⟧ saying what the sentence really means.

Subtitle track: ${STRINGS.en.tracks[t]}. ${TRACKS[t].brief}

Examples:
${EXAMPLES[l][t]}

Rules:
- The subtitle goes immediately after the sentence's final punctuation, on the same line.
- Short: ideally under 20 Chinese characters or 12 English words. Write it in the language the user writes in.
- Honest and specific to the situation at hand: name the real thing being glossed over, not a generic paraphrase.
- Only sentences that need it. Plain sentences get none; most replies have 1 to 5 subtitles, a purely factual one may have none.
- Only in your final reply of a turn. The short progress notes you write between tool calls get no subtitles.
- Never inside code blocks, inline code, tables, headings, commit messages, files you write, or any tool input.
- Never mention, explain or apologise for the subtitles.
- If the user asks to change the subtitles (track, display, style, interface language), call the tool mcp__fansub__subtitles rather than explaining slash commands.`
}

/** 完整说明已经给过时，每轮只附这一行，提醒它别忘了。 */
function reminder(t: FansubTrack): string {
  return `(fansub: keep adding ⟦subtitles⟧ to diplomatic sentences in your final reply, as the earlier fansub note says. Track: ${STRINGS.en.tracks[t]}.)`
}

async function strings($: EngineInterface) {
  return STRINGS[await read($, lang)]
}

async function savePrefs($: EngineInterface, patch: Prefs) {
  const saved = ((await $.store.get('prefs')) ?? {}) as Prefs
  await $.store.set('prefs', { ...saved, ...patch })
}

// ---- 宿主机：平台和语言。引擎只允许 $ 在同一个文件里传递，所以写在这里。----

type Platform = 'mac' | 'windows' | 'linux'

/** 跑一条命令；起不来、超时、非零退出都算失败，绝不抛出。 */
async function run($: EngineInterface, argv: string[]): Promise<{ ok: boolean; out: string }> {
  try {
    const r = await $.process.run(argv, { timeoutMs: 20000 })
    return { ok: r.exitCode === 0, out: r.stdout.trim() }
  } catch {
    return { ok: false, out: '' }
  }
}

async function platformOf($: EngineInterface): Promise<Platform> {
  const os = await $.env.get('OS').catch(() => undefined)
  if (os === 'Windows_NT') return 'windows'
  return (await run($, ['uname', '-s'])).out === 'Darwin' ? 'mac' : 'linux'
}

/**
 * 系统语言，按这个顺序：Claude Code 设置里的 language → 系统界面语言（macOS 的
 * AppleLanguages、Windows 的 UI 语言）→ LC_ALL / LC_MESSAGES / LANG。中文用中文，其余英文。
 */
async function systemLang($: EngineInterface): Promise<FansubLang> {
  const settings = (await $.settings.read().catch(() => ({}))) as { language?: unknown }
  const configured = langOf(settings.language)
  if (configured) return configured

  const os = await platformOf($)
  if (os === 'mac') {
    const ui = langOf(firstAppleLanguage((await run($, ['defaults', 'read', '-g', 'AppleLanguages'])).out))
    if (ui) return ui
  }
  if (os === 'windows') {
    const ui = langOf((await run($, ['powershell', '-NoProfile', '-Command', '(Get-UICulture).Name'])).out)
    if (ui) return ui
  }
  for (const value of [
    await $.env.get('LC_ALL').catch(() => undefined),
    await $.env.get('LC_MESSAGES').catch(() => undefined),
    await $.env.get('LANG').catch(() => undefined),
  ]) {
    const env = langOf(value)
    if (env) return env
  }
  return 'en'
}

/** 本场最佳：含水量最高的一句，一样高就挑原话更长的；两三个字以下的字幕不算（「…」这种会把含水量顶到 98%）。 */
function bestOf(list: readonly FansubPair[]): FansubPair | undefined {
  return [...list.filter(p => Array.from(p.sub.trim()).length >= 3)].sort((a, b) => (water([b]) ?? 0) - (water([a]) ?? 0) || b.formal.length - a.formal.length)[0]
}

/** 字幕组连夜重配：用 haiku 把官话按另一条字幕轨重新翻一遍。 */
async function dub($: EngineInterface, t: FansubTrack, limit = 20) {
  const list = await read($, pairs)
  const have = (await read($, dubs))[t] ?? {}
  const todo = list.slice(-limit).filter(p => p.track !== t && have[String(p.id)] === undefined)
  if (todo.length === 0 || (await read($, dubbing)) !== null) return
  const S = await strings($)
  await $.state.set(DUBBING, t)
  // 不管模型答没答、报没报错，都要放下「翻译中」的牌子，否则以后再也重配不了。
  try {
    const r = await $.model.complete({
      model: 'haiku',
      effort: 'low',
      timeoutMs: 60000,
      maxTokens: 4096,
      system: `You are a fansub group writing subtitles for a very formal AI. Track: ${STRINGS.en.tracks[t]}. ${TRACKS[t].brief}\nExamples (formal⟦subtitle⟧):\n${EXAMPLES[await read($, lang)][t]}\nEach subtitle is short and in the same language as its line. Answer with a JSON array of plain strings only (no ⟦ ⟧ brackets), one per input line, same order.`,
      prompt: todo.map((p, i) => `${i + 1}. ${p.formal}`).join('\n'),
    })
    let subs: unknown = null
    if (r.isAnswered) {
      try {
        subs = JSON.parse(r.text.slice(r.text.indexOf('['), r.text.lastIndexOf(']') + 1))
      } catch {
        subs = null
      }
    }
    if (Array.isArray(subs)) {
      await update($, dubs, all => {
        const merged = { ...(all[t] ?? {}) }
        todo.forEach((p, i) => {
          // haiku 常照着示例的格式，把每条字幕再套一层 ⟦⟧：剥掉。
          const line = typeof subs[i] === 'string' ? subs[i].trim().replace(/^⟦\s*/, '').replace(/\s*⟧$/, '').trim() : ''
          if (line) merged[String(p.id)] = line
        })
        return { ...all, [t]: merged }
      })
    } else {
      $.ui.toast(S.dubFailed(r.isAnswered ? S.unreadable : r.reason))
    }
  } catch (err) {
    $.ui.toast(S.dubFailed(err instanceof Error ? err.message : String(err)))
  } finally {
    await $.state.set(DUBBING, null)
  }
  // 重配期间又换了风格：接着把新风格也配上。
  const now = await read($, track)
  if (now !== t) await dub($, now, limit)
}

// ---- 设置：菜单、命令、Claude 的工具、单字母输入，四个入口共用这几个函数 ----

const nextMode = (m: FansubMode): FansubMode => (m === 'dual' ? 'mute' : m === 'mute' ? 'off' : 'dual')

async function setTrack($: EngineInterface, id: FansubTrack): Promise<string> {
  await $.state.set(TRACK, id)
  await savePrefs($, { track: id })
  await $.state.set(SWITCHED, true)
  await $.store.set('hasSwitched', true)
  const S = await strings($)
  // 屏幕上已有的字幕当场按新风格重配一遍，不用等下一条回复才看出变化。
  // 放进计时器里跑：按键、命令、工具调用都先返回，重配在后台慢慢来。
  if ((await read($, pairs)).some(p => p.track !== id)) {
    $.clock.after(0, () => void dub($, id))
    return S.redubbing(S.tracks[id])
  }
  return S.cmdTrack(S.tracks[id])
}

/** 依次换到下一种风格。 */
async function cycleTrack($: EngineInterface): Promise<string> {
  const now = await read($, track)
  return setTrack($, TRACK_IDS[(TRACK_IDS.indexOf(now) + 1) % TRACK_IDS.length] ?? 'plain')
}

/** 第一次看到字幕，或点了「知道了」：以后不再给欢迎引导。 */
async function welcomed($: EngineInterface) {
  if (!(await read($, isNew))) return
  await $.state.set(IS_NEW, false)
  await $.store.set('welcomed', true)
}

async function setMode($: EngineInterface, m: FansubMode): Promise<string> {
  await $.state.set(MODE, m)
  await savePrefs($, { mode: m })
  const S = await strings($)
  return S.cmdMode(S.modes[m])
}

async function setLayout($: EngineInterface, look: FansubLayout): Promise<string> {
  await $.state.set(LAYOUT, look)
  await savePrefs($, { layout: look })
  const S = await strings($)
  return S.cmdLayout(S.layouts[look])
}

async function setLang($: EngineInterface, picked: FansubLang | 'auto'): Promise<string> {
  const l = picked === 'auto' ? await systemLang($) : picked
  await $.state.set(LANG, l)
  await savePrefs($, { lang: picked })
  const S = STRINGS[l]
  return S.cmdLang(picked === 'auto' ? `${S.langs.auto} (${S.langs[l]})` : S.langs[l])
}

async function openCinema($: EngineInterface): Promise<string> {
  await update($, reel, r => ({ ...r, at: 0, isPlaying: true }))
  const S = await strings($)
  await $.ui.open({ id: PANE, title: S.cinema, focus: true })
  return S.cmdCinema
}

async function openMenu($: EngineInterface): Promise<string> {
  const S = await strings($)
  await $.ui.open({ id: MENU, title: S.menuTitle, focus: true, closeOnEscape: true, rows: 14 })
  return S.menuOpened
}

export const register: Register = on => {
  // 放映厅的节拍：模块变量，热重载后从头数。
  let beat = 0

  on('session.start', async ($, e, next) => {
    const saved = ((await $.store.get('prefs')) ?? {}) as Prefs
    if (saved.track && TRACKS[saved.track]) await $.state.set(TRACK, saved.track)
    if (saved.mode && MODE_IDS.includes(saved.mode)) await $.state.set(MODE, saved.mode)
    if (saved.layout) await $.state.set(LAYOUT, saved.layout)
    const l = saved.lang === 'zh' || saved.lang === 'en' ? saved.lang : await systemLang($)
    await $.state.set(LANG, l)
    // 「翻译中」的牌子存在跨热重载的状态里；重载会打断正在跑的重配，牌子却留着，
    // 以后每次重配都以为「已经在配了」而跳过，字幕后面一直挂着 ⟳。每次加载先摘掉。
    await $.state.set(DUBBING, null)
    await $.state.set(IS_NEW, (await $.store.get('welcomed')) !== true)
    await $.state.set(SWITCHED, (await $.store.get('hasSwitched')) === true)

    await $.command.register({
      name: 'fansub',
      description: STRINGS[l].description,
      argumentHint: '[plain|roast|boss|kid|dual|mute|off|layout|cinema|lang|stats]',
      immediate: true,
    })

    // 让人直接用嘴说：「换成毒舌字幕」「关掉字幕」，Claude 调这个工具去改。
    await $.tool
      .register({
        name: 'subtitles',
        description:
          "Change the user's fansub subtitle settings when they ask, e.g. \"switch to roast subtitles\", \"turn subtitles off\", \"字幕换成老板版\". " +
          'track: plain (blunt plain talk), roast (snarky heckling), boss (what a manager hears), kid (explained to a five-year-old). ' +
          'mode: dual (original and subtitles), mute (dim the original), off (no subtitles). layout: cinema (centered bar) or margin (side note). ' +
          "lang: zh, en or auto for the plugin's own interface. Pass only what the user asked to change.",
        inputSchema: {
          type: 'object',
          properties: {
            track: { type: 'string', enum: TRACK_IDS },
            mode: { type: 'string', enum: MODE_IDS },
            layout: { type: 'string', enum: ['cinema', 'margin'] },
            lang: { type: 'string', enum: ['zh', 'en', 'auto'] },
          },
          additionalProperties: false,
        },
      })
      .catch(() => undefined)

    $.clock.every(1000, () => {
      void (async () => {
        const r = await read($, reel)
        if (!r.isPlaying) return
        const list = await read($, pairs)
        const pair = list[r.at]
        beat += 1
        if (pair && beat < beatsFor(pair)) return
        beat = 0
        await update($, reel, cur => {
          const at = Math.min(cur.at + 1, list.length)
          return { ...cur, at, isPlaying: at < list.length }
        })
      })()
    })

    return next(e)
  })

  // 每条消息背后附一段只给模型看的说明：继续一本正经，但每句官话后面打上字幕。
  // （系统提示走不通：内置安全插件不让用户级插件改 prompt.compose。）
  on('prompt.submit', async ($, e, next) => {
    // 控制台的快捷键要先把焦点移过去才生效；直接在输入框里敲一个 t（或 p/r/b/k/m/c）回车的人，
    // 其实就是想按那个键。照它的意思办，这条不发给模型。
    const key = e.text.trim().toLowerCase()
    if (e.origin.kind === 'composer' && /^[prbktmc]$/.test(key) && (await read($, pairs)).length > 0) {
      const id = TRACK_IDS.find(t => TRACKS[t].hotkey === key)
      if (id) return { drop: await setTrack($, id) }
      if (key === 't') return { drop: await cycleTrack($) }
      if (key === 'm') return { drop: await setMode($, nextMode(await read($, mode))) }
      return { drop: await openCinema($) }
    }
    await $.state.set(LIVE, null)
    if ((await read($, mode)) === 'off') {
      await $.state.set(BRIEFED, null)
      return next(e)
    }
    // 完整说明约 400 token，每轮都带太贵：第一轮、换了风格或语言、压缩或 /clear 之后才带完整的，
    // 其余轮次只带一行提醒。
    const t = await read($, track)
    const l = await read($, lang)
    const brief = `${t}|${l}`
    const isBriefed = (await read($, briefed)) === brief
    if (!isBriefed) await $.state.set(BRIEFED, brief)
    return next({ ...e, context: [...(e.context ?? []), isBriefed ? reminder(t) : section(t, l)] })
  })

  // 对话被压缩后，前面那份完整说明可能被压没了：下一轮重新带上。
  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && done.skip === undefined) await $.state.set(BRIEFED, null)
    return done
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await $.state.set(BRIEFED, null)
    return next(e)
  })

  // 流式输出时屏幕上的样子：⟦字幕⟧ 不在句子中间露出括号，换成紧跟其后的一行「> 🎬 字幕」。
  // 只改显示，不改存下来的消息；代码块会跨好几次刷新，按消息记住是否在代码块里。
  const inFence = new Map<string, boolean>()
  on('classic.MessageDisplay', async ($, e, next) => {
    const done = await next(e)
    const shown = streamView(done.displayContent ?? e.delta, inFence.get(e.message_id) ?? false, (await read($, mode)) !== 'off')
    if (e.final) inFence.delete(e.message_id)
    else inFence.set(e.message_id, shown.inFence)
    return { ...done, displayContent: shown.text }
  })

  // 同声传译：边流边抓最新那句字幕，回复完了再把整段的字幕收进片库。
  // 一轮里出没出过字幕：一轮可能有好几步（中间穿插工具调用），按 turnId 记。
  const turnHadSubs = new Map<string, boolean>()

  // 同声传译：边流边抓最新那句字幕，回复完了再把整段的字幕收进片库。
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    const blocks: string[] = []
    let shown = ''
    let isFinal = false
    for await (const chunk of next(e)) {
      yield chunk
      if (chunk.kind === 'stop') isFinal = chunk.stopReason !== 'tool_use'
      if (chunk.kind !== 'text') continue
      const block = (blocks[chunk.index] ?? '') + chunk.text
      blocks[chunk.index] = block
      if (!hasSubs(block)) continue
      const subs = parse(block).filter(s => s.kind === 'sub')
      const last = subs[subs.length - 1]
      if (last?.kind !== 'sub') continue
      const key = last.text + (last.isOpen ? '…' : '')
      if (key === shown) continue
      shown = key
      const now: FansubLive = { formal: last.formal, sub: last.text, isTyping: last.isOpen }
      await $.state.set(LIVE, now)
    }
    const found = blocks.flatMap(b => pairsOf(b ?? ''))
    if (found.length > 0) {
      turnHadSubs.set(e.turnId, true)
      const t = await read($, track)
      const before = await read($, pairs)
      const base = (before[before.length - 1]?.id ?? -1) + 1
      const added: FansubPair[] = found.map((p, i) => ({ id: base + i, ...p, track: t }))
      await update($, pairs, list => [...list, ...added].slice(-500))
      await welcomed($)
    }
    // 一整轮都没有官话：记下最后那段回复，让它底下写一句「本条无水分」，免得人以为 mod 坏了。
    const tail = [...blocks].reverse().find(b => b?.trim())
    if (isFinal && tail && !turnHadSubs.get(e.turnId) && (await read($, mode)) !== 'off') {
      await update($, dry, list => [...list, fingerprint(tail)].slice(-200))
    }
    if (isFinal) turnHadSubs.delete(e.turnId)
  })

  // 每一段回复：原文一句，底下一条黑底黄字的字幕。
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const m = await read($, mode)
    if (!hasSubs(e.props.text)) {
      // 整轮都没有官话的那段回复：底下写一句「本条无水分」，让人知道字幕组在岗。
      if (m === 'off' || !(await read($, dry)).includes(fingerprint(e.props.text))) return next(e)
      const S = await strings($)
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          {await next(e)}
          <Box justifyContent="flex-end">
            <Text dimColor>{S.dry}</Text>
          </Box>
        </Box>
      )
    }
    if (m === 'off') return next({ ...e, props: { ...e.props, text: strip(e.props.text) } })

    const S = await strings($)
    const look = await read($, layout)
    const now = await read($, track)
    const list = await read($, pairs)
    const allDubs = await read($, dubs)
    const busy = await read($, dubbing)
    const { Box, Text, Markdown } = $.ui.resolve(e)
    const segs = parse(e.props.text)
    const isStreaming = segs.some(s => s.kind === 'sub' && s.isOpen)

    // 每句字幕按当前风格显示：打字幕时用的就是这个风格，原样；否则有重配版就用重配版。
    const shown = segs.map(s => {
      if (s.kind !== 'sub' || s.isOpen) return null
      const pair = list.find(p => p.formal === s.formal && p.sub === s.text)
      if (!pair || pair.track === undefined || pair.track === now) return { sub: s.text, isPending: false }
      const redone = allDubs[now]?.[String(pair.id)]
      return redone ? { sub: redone, isPending: false } : { sub: s.text, isPending: busy === now }
    })
    const done = segs.flatMap((s, i) => {
      const view = shown[i]
      return s.kind === 'sub' && view ? [{ formal: s.formal, sub: view.sub }] : []
    })

    const body = segs.map((s, i) => {
      if (s.kind === 'text') {
        // 字幕后面接着的正文常以空格开头（「…⟧ 可以改成…」），不去掉就会缩进一格。
        const after = segs[i - 1]?.kind === 'sub'
        const text = s.text.replace(/^[ \t]*\n/, '').replace(after ? /^[ \t]+/ : /^$/, '').replace(/[ \t]+$/, '')
        if (!text.trim()) return null
        return <Markdown key={`t${i}`} text={text} dimColor={m === 'mute'} />
      }
      const view = shown[i]
      const words = s.isOpen ? `${s.text}▌` : `${view?.sub ?? s.text}${view?.isPending ? ' ⟳' : ''}`
      return look === 'cinema' ? (
        <Box key={`s${i}`} justifyContent="center" marginBottom={1}>
          <Text backgroundColor={SUB_BG} color={SUB_FG} bold>
            {` ${words} `}
          </Text>
        </Box>
      ) : (
        <Box key={`s${i}`} marginBottom={1}>
          <Text color={SUB_FG}>{'  ╰─ '}</Text>
          <Text color={SUB_FG} italic>
            {words}
          </Text>
        </Box>
      )
    })

    return (
      <Box flexDirection="row" marginTop={1}>
        <Box width={2} flexShrink={0}>
          <Text>{e.props.isFirstOfReply ? '⏺' : ' '}</Text>
        </Box>
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          {body}
          {!isStreaming && done.length > 0 && (
            <Box justifyContent="flex-end">
              <Text dimColor>{S.footer(pct(water(done)), done.length)}</Text>
            </Box>
          )}
        </Box>
      </Box>
    )
  })

  // 提示框上方的「字幕控制台」：同传字幕 + 换轨 + 放映厅入口。
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const list = await read($, pairs)
    const now = await read($, live)
    const fresh = await read($, isNew)
    if (list.length === 0 && now === null && !fresh) return next(e)

    const S = await strings($)
    const t = await read($, track)
    const { Box, Text, Button } = $.ui.resolve(e)
    const styleButton = (
      <Button key="style" plain hotkey="t" label={S.style(S.tracks[t])} onPress={async () => $.ui.toast(await cycleTrack($))} />
    )

    // 新用户、还没见过字幕：告诉他这是什么、怎么触发。第一条字幕出来或点「知道了」就收起。
    if (fresh && list.length === 0 && now === null) {
      return (
        <Box flexDirection="column">
          <Box flexWrap="wrap" columnGap={1}>
            <Text color={SUB_FG} bold>
              {S.welcome[0]}
            </Text>
            <Text dimColor>{S.welcome[1]}</Text>
          </Box>
          <Box columnGap={2}>
            {styleButton}
            <Button key="got-it" plain label={S.gotIt} onPress={() => welcomed($)} />
          </Box>
        </Box>
      )
    }

    // 平时只留两个动作：换风格、分享；其余都在 /fansub 菜单里。
    const switched = await read($, hasSwitched)
    return (
      <Box flexDirection="column">
        {e.props.isWorking && now !== null && (
          <Box justifyContent="center">
            <Text color="red">● </Text>
            <Text dimColor>{S.live} </Text>
            <Text backgroundColor={SUB_BG} color={SUB_FG} bold wrap="truncate-end">
              {` ${now.sub}${now.isTyping ? '▌' : ''} `}
            </Text>
          </Box>
        )}
        <Box flexWrap="wrap" columnGap={2}>
          <Text color={SUB_FG}>{S.brand}</Text>
          {styleButton}
          <Button key="menu" plain label="⚙" onPress={async () => void (await openMenu($))} />
          {list.length > 0 && <Text dimColor>{S.bandStats(pct(water(list)), list.length)}</Text>}
          {!switched && <Text dimColor>{S.bandHint}</Text>}
        </Box>
      </Box>
    )
  })

  // 放映厅：把本场所有官话按电影方式一句句重放，可换字幕轨重配。
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const S = await strings($)
    const list = await read($, pairs)
    const r = await read($, reel)
    const allDubs = await read($, dubs)
    const busy = await read($, dubbing)
    const cols = Math.max(20, e.props.bodyColumns)
    const bar = <Text color="gray">{'▀'.repeat(cols)}</Text>
    const barBottom = <Text color="gray">{'▄'.repeat(cols)}</Text>
    const subOf = (p: FansubPair) =>
      r.track === 'original' || p.track === r.track ? p.sub : (allDubs[r.track]?.[String(p.id)] ?? null)

    const isEnd = list.length > 0 && r.at >= list.length
    const best = bestOf(list)
    const shown = isEnd ? best : list[r.at]

    let screen
    if (list.length === 0) {
      screen = (
        <Box flexDirection="column" alignItems="center" paddingY={1}>
          <Text dimColor>{S.emptyReel[0]}</Text>
          <Text dimColor>{S.emptyReel[1]}</Text>
        </Box>
      )
    } else if (isEnd && best) {
      screen = (
        <Box flexDirection="column" alignItems="center" paddingY={1}>
          <Text bold>{S.theEnd}</Text>
          <Text> </Text>
          <Text dimColor>{S.endStats(list.length, pct(water(list)))}</Text>
          <Text> </Text>
          <Text dimColor>{S.best}</Text>
          <Text italic>“{best.formal}”</Text>
          <Text backgroundColor={SUB_BG} color={SUB_FG} bold>
            {` ${subOf(best) ?? best.sub} `}
          </Text>
        </Box>
      )
    } else if (shown) {
      const sub = subOf(shown)
      screen = (
        <Box flexDirection="column" alignItems="center" paddingY={1}>
          <Text dimColor>{S.scene(r.at + 1, list.length)}</Text>
          <Text> </Text>
          <Text italic>“{shown.formal}”</Text>
          <Text> </Text>
          {sub === null ? (
            <Text dimColor>{busy ? S.dubbing : S.noDub}</Text>
          ) : (
            <Text backgroundColor={SUB_BG} color={SUB_FG} bold>
              {` ${sub} `}
            </Text>
          )}
          <Text dimColor>{S.waterOne(pct(water([shown])))}</Text>
        </Box>
      )
    }

    const seek = (to: number) => {
      beat = 0
      return update($, reel, cur => ({ ...cur, at: Math.max(0, Math.min(list.length, to)) }))
    }
    const pick = async (to: FansubTrack | 'original') => {
      await update($, reel, cur => ({ ...cur, track: to }))
      if (to !== 'original') void dub($, to, 500)
    }

    return (
      <Box flexDirection="column">
        {bar}
        {screen}
        {barBottom}
        <Box flexWrap="wrap" columnGap={1} justifyContent="center">
          <Button key="prev" plain hotkey="h" label={S.prev} onPress={() => seek(r.at - 1)} />
          <Button
            key="play"
            plain
            hotkey="p"
            label={r.isPlaying ? S.pause : S.play}
            onPress={() =>
              update($, reel, cur => ({
                ...cur,
                at: cur.at >= list.length ? 0 : cur.at,
                isPlaying: !cur.isPlaying,
              }))
            }
          />
          <Button key="next" plain hotkey="l" label={S.next} onPress={() => seek(r.at + 1)} />
        </Box>
        <Box flexWrap="wrap" columnGap={1} justifyContent="center">
          <Text dimColor>{S.subsRow}</Text>
          <Button
            key="dub-original"
            plain
            hotkey="o"
            label={r.track === 'original' ? S.picked(S.original) : S.original}
            dimColor={r.track !== 'original'}
            onPress={() => pick('original')}
          />
          {TRACK_IDS.map((id, i) => (
            <Button
              key={`dub-${id}`}
              plain
              hotkey={String(i + 1)}
              label={r.track === id ? S.picked(S.tracks[id]) : S.tracks[id]}
              dimColor={r.track !== id}
              onPress={() => pick(id)}
            />
          ))}
        </Box>
      </Box>
    )
  })

  on('tool.call', { tool: /^mcp__fansub__subtitles$/ }, async ($, e) => {
    const input = e as unknown as { track?: unknown; mode?: unknown; layout?: unknown; lang?: unknown }
    const done: string[] = []
    if (TRACK_IDS.includes(input.track as FansubTrack)) done.push(await setTrack($, input.track as FansubTrack))
    if (MODE_IDS.includes(input.mode as FansubMode)) done.push(await setMode($, input.mode as FansubMode))
    if (input.layout === 'cinema' || input.layout === 'margin') done.push(await setLayout($, input.layout))
    if (input.lang === 'zh' || input.lang === 'en' || input.lang === 'auto') done.push(await setLang($, input.lang))
    if (done.length === 0) return { deny: 'Nothing to change: pass track, mode, layout or lang.' }
    $.ui.toast(done.join(' '))
    return { result: `${done.join('\n')}\n(Subtitle track changes apply from the next reply.)` }
  })

  // 设置菜单：/fansub 一敲就弹出来，方向键 / Tab 走、回车或按键选、Esc 关。
  on('ui.render', { component: 'Pane', requestId: MENU }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const S = await strings($)
    const t = await read($, track)
    const m = await read($, mode)
    const look = await read($, layout)
    const l = await read($, lang)
    const pref = (((await $.store.get('prefs')) ?? {}) as Prefs).lang ?? 'auto'
    const labelWidth = l === 'zh' ? 8 : 11

    const row = (label: string, ...buttons: ReturnType<typeof Button>[]) => (
      <Box flexWrap="wrap" columnGap={1}>
        <Box width={labelWidth} flexShrink={0}>
          <Text dimColor>{label}</Text>
        </Box>
        {buttons}
      </Box>
    )
    const choice = (key: string, hotkey: string, label: string, isOn: boolean, press: () => Promise<string>, autoFocus = false) => (
      <Button
        key={key}
        plain
        hotkey={hotkey}
        label={isOn ? S.picked(label) : label}
        dimColor={!isOn}
        autoFocus={autoFocus ? true : undefined}
        onPress={async () => {
          $.ui.toast(await press())
        }}
      />
    )

    return (
      <Box flexDirection="column" rowGap={1}>
        <Text bold color={SUB_FG}>
          {S.menuTitle}
        </Text>
        {row(
          S.menuRows.track,
          ...TRACK_IDS.map((id, i) => choice(`menu-track-${id}`, String(i + 1), S.tracks[id], id === t, () => setTrack($, id), id === t)),
        )}
        {row(
          S.menuRows.mode,
          choice('menu-mode-dual', 'd', S.modes.dual, m === 'dual', () => setMode($, 'dual')),
          choice('menu-mode-mute', 'u', S.modes.mute, m === 'mute', () => setMode($, 'mute')),
          choice('menu-mode-off', 'x', S.modes.off, m === 'off', () => setMode($, 'off')),
        )}
        {row(
          S.menuRows.style,
          choice('menu-layout-cinema', 'v', S.layouts.cinema, look === 'cinema', () => setLayout($, 'cinema')),
          choice('menu-layout-margin', 'n', S.layouts.margin, look === 'margin', () => setLayout($, 'margin')),
        )}
        {row(
          S.menuRows.lang,
          choice('menu-lang-zh', 'z', S.langs.zh, pref === 'zh', () => setLang($, 'zh')),
          choice('menu-lang-en', 'e', S.langs.en, pref === 'en', () => setLang($, 'en')),
          choice('menu-lang-auto', 'a', S.langs.auto, pref === 'auto', () => setLang($, 'auto')),
        )}
        {row(
          S.menuRows.more,
          <Button key="menu-cinema" plain hotkey="c" label={S.cinema} onPress={async () => void (await openCinema($))} />,
        )}
        <Text dimColor>{S.menuHint}</Text>
      </Box>
    )
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    await update($, reel, r => ({ ...r, isPlaying: false }))
    return next(e)
  })

  on('command.run', { command: 'fansub' }, async ($, e) => {
    const [verb = '', arg = ''] = e.args.trim().toLowerCase().split(/\s+/)
    const S = await strings($)

    if (verb === '' || verb === 'menu' || verb === 'settings' || verb === '设置') return { text: await openMenu($) }
    const asTrack = TRACK_IDS.find(id => id === verb || STRINGS.zh.tracks[id] === verb || STRINGS.en.tracks[id].toLowerCase() === verb)
    if (asTrack) return { text: await setTrack($, asTrack) }
    if (MODE_IDS.includes(verb as FansubMode) || verb === 'on') {
      return { text: await setMode($, verb === 'on' ? 'dual' : (verb as FansubMode)) }
    }
    if (verb === 'cinema' || verb === '放映厅') return { text: await openCinema($) }
    if (verb === 'layout') return { text: await setLayout($, (await read($, layout)) === 'cinema' ? 'margin' : 'cinema') }
    if (verb === 'lang') return { text: await setLang($, arg === 'auto' || arg === '' ? 'auto' : (langOf(arg) ?? 'auto')) }

    const list = await read($, pairs)
    const lines = [
      S.header(S.tracks[await read($, track)], S.modes[await read($, mode)]),
      S.stats(list.length, pct(water(list))),
      ...list.slice(-5).map(p => `  “${p.formal}”\n    ↳ ${p.sub}`),
      '',
      ...S.help,
    ]
    return { text: lines.join('\n') }
  })
}
