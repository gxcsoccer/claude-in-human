import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { firstAppleLanguage, langOf } from './i18n'
import { normalize, pairsOf, parse, streamView, strip, water } from './parse'

const REPLY = [
  '我已经完成了登录模块的重构。',
  '当前实现尚未覆盖所有边界条件。⟦只测了正常输入。⟧该方案在性能上存在一定的优化空间。⟦有点慢。⟧',
  '',
  '```ts',
  'const s = "⟦这不是字幕⟧"',
  '```',
].join('\n')

const typed = (args: string) =>
  ({ command: 'fansub', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } }) as const
const SUBMIT = { text: '登录模块能上线吗？', wait: false, origin: { kind: 'composer' } } as const
const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
} as const
const CINEMA = {
  title: 'Cinema',
  isFocused: true,
  bodyColumns: 60,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
} as const
const ONE_LINE = '当前实现尚未覆盖所有边界条件。⟦只测了正常输入。⟧'

/** 引擎那一侧：模型流式吐出一段带字幕的回复。 */
function feed(on: On, text = ONE_LINE) {
  on('turn.step', async function* (_$, e) {
    yield { kind: 'text', index: 0, text, ref: 0 }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
}

async function play($: Engine) {
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'test', messageCount: 1 })) {
    // drain
  }
}

// ---- 纯函数 ----

test('parse finds each subtitle and the sentence it translates, never inside code', () => {
  expect(pairsOf(REPLY)).toEqual([
    { formal: '当前实现尚未覆盖所有边界条件。', sub: '只测了正常输入。' },
    { formal: '该方案在性能上存在一定的优化空间。', sub: '有点慢。' },
  ])
  expect(strip(REPLY)).not.toContain('只测了正常输入')
  expect(strip(REPLY)).toContain('⟦这不是字幕⟧')
  expect(water(pairsOf(REPLY))).toBeGreaterThan(0.5)
})

test('⟦⟧ inside inline code is text, and a sentence keeps the inline code it contains', () => {
  const reply = '而不是直接显示成 `⟦…⟧` 原文。运行 `npm test` 之后发现覆盖率尚未达标。⟦测试没写够。⟧'
  expect(pairsOf(reply)).toEqual([{ formal: '运行 npm test 之后发现覆盖率尚未达标。', sub: '测试没写够。' }])
  expect(strip(reply)).toContain('`⟦…⟧`')
})

test('english sentences end at a period followed by a space, not inside 3.5', () => {
  expect(pairsOf('It builds. Version 3.5 does not yet cover all edge cases.⟦Only the happy path.⟧')).toEqual([
    { formal: 'Version 3.5 does not yet cover all edge cases.', sub: 'Only the happy path.' },
  ])
})

test('a subtitle still streaming is open', () => {
  const segs = parse('当前实现尚未覆盖所有边界条件。⟦只测了')
  expect(segs[segs.length - 1]).toEqual({
    kind: 'sub',
    text: '只测了',
    formal: '当前实现尚未覆盖所有边界条件。',
    isOpen: true,
  })
})

test('system language tags fold to zh or en', () => {
  expect(langOf('zh-Hans-CN')).toBe('zh')
  expect(langOf('zh_CN.UTF-8')).toBe('zh')
  expect(langOf('Chinese')).toBe('zh')
  expect(langOf('en_US.UTF-8')).toBe('en')
  expect(langOf('ja-JP')).toBe('en')
  expect(langOf('C')).toBeNull()
  expect(langOf(undefined)).toBeNull()
  expect(firstAppleLanguage('(\n    "zh-Hans-CN",\n    "en-CN"\n)')).toBe('zh-Hans-CN')
})

// ---- 模型那一侧 ----

test('each prompt carries the chosen track for the model, and none when off', async ($, on) => {
  mock.store(on)
  let seen: readonly string[] = []
  on('prompt.submit', (_$, e) => {
    seen = e.context ?? []
    return { text: e.text }
  })
  const note = async () => {
    await $.prompt.submit(SUBMIT)
    return seen.find(c => c.includes('fansub'))
  }
  expect(await note()).toContain('Plain')
  await $.command.run(typed('roast'))
  expect(await note()).toContain('Roast')
  await $.command.run(typed('lang zh'))
  expect(await note()).toContain('慢得能泡杯茶')
  await $.command.run(typed('lang en'))
  expect(await note()).toContain('Slow enough to brew tea')
  await $.command.run(typed('off'))
  expect(await note()).toBeUndefined()
})

// ---- 界面 ----

test('in chinese, a streamed reply fills the reel and every site draws in chinese', async ($, on) => {
  mock.store(on)
  feed(on)
  await $.command.run(typed('lang zh'))
  await play($)

  for (const surface of ['terminal', 'desktop'] as const) {
    const msg = await $.ui.mount({
      plugin: 'fansub',
      surface,
      component: 'AssistantMessage',
      props: { text: REPLY, isFirstOfReply: true },
    })
    expect(await msg.find({ type: 'Text', text: /只测了正常输入/ })).toBeDefined()
    expect(await msg.find({ type: 'Text', text: /官话含水量/ })).toBeDefined()
    await msg.unmount()

    await $.command.run(typed('plain'))
    const band = await $.ui.mount({ plugin: 'fansub', surface, component: 'AbovePrompt', props: BAND })
    expect(await band.find({ type: 'Text', text: /含水量 \d+% · 1 句/ })).toBeDefined()
    expect((await band.find({ key: 'style' }))?.props.label).toBe('换风格 ▸ 通俗')
    await band.press({ key: 'style' })
    expect((await band.find({ key: 'style' }))?.props.label).toBe('换风格 ▸ 毒舌')
    await band.unmount()

    const pane = await $.ui.mount({ plugin: 'fansub', surface, component: 'Pane', requestId: 'fansub-cinema', props: CINEMA })
    await pane.press({ key: 'prev' })
    expect(await pane.find({ type: 'Text', text: /第 1 \/ 1 幕/ })).toBeDefined()
    await pane.press({ key: 'next' })
    expect(await pane.find({ type: 'Text', text: /全 剧 终/ })).toBeDefined()
    await pane.unmount()
  }
})

test('in english, every site draws in english', async ($, on) => {
  mock.store(on)
  feed(on, 'The current implementation does not yet cover all edge cases.⟦Only the happy path is tested.⟧')
  await $.command.run(typed('lang en'))
  await play($)

  const msg = await $.ui.mount({
    plugin: 'fansub',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: 'It builds. The current implementation does not yet cover all edge cases.⟦Only the happy path is tested.⟧', isFirstOfReply: true },
  })
  expect(await msg.find({ type: 'Text', text: /Fluff \d+% · 1 line translated/ })).toBeDefined()
  await msg.unmount()

  const band = await $.ui.mount({ plugin: 'fansub', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ type: 'Text', text: /fluff \d+% · 1 line$/ })).toBeDefined()
  expect((await band.find({ key: 'style' }))?.props.label).toBe('Style ▸ Plain')
  await band.unmount()

  const pane = await $.ui.mount({ plugin: 'fansub', surface: 'terminal', component: 'Pane', requestId: 'fansub-cinema', props: CINEMA })
  await pane.press({ key: 'prev' })
  expect(await pane.find({ type: 'Text', text: /Scene 1 \/ 1/ })).toBeDefined()
  await pane.unmount()
})

test('the band binds no digit, so a prompt starting with one never switches the track', async ($, on) => {
  mock.store(on)
  feed(on)
  await play($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'fansub', surface, component: 'AbovePrompt', props: BAND })
    const hotkeys: string[] = []
    const walk = (node: unknown) => {
      if (typeof node !== 'object' || node === null) return
      const el = node as { type?: string; props?: { hotkey?: string; children?: unknown }; children?: unknown }
      if (el.type === 'Button' && el.props?.hotkey) hotkeys.push(el.props.hotkey)
      for (const kids of [el.children, el.props?.children]) if (Array.isArray(kids)) kids.forEach(walk)
    }
    walk(await band.drawn())
    expect(hotkeys.length).toBeGreaterThan(0)
    expect(hotkeys.filter(k => /^\d$/.test(k))).toEqual([])
    await band.unmount()
  }
})

test('a dub that throws lets go of the busy flag, so the next try still runs', async ($, on) => {
  mock.store(on)
  feed(on)
  on('ui.toast', () => ({ value: undefined }))
  let calls = 0
  on('model.complete', () => {
    calls += 1
    if (calls === 1) throw new Error('model blocked')
    return {
      value: {
        isAnswered: true,
        text: '["正常输入能跑，别的随缘。"]',
        usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    }
  })
  await play($)
  const pane = await $.ui.mount({ plugin: 'fansub', surface: 'terminal', component: 'Pane', requestId: 'fansub-cinema', props: CINEMA })
  await pane.press({ key: 'prev' })
  await pane.press({ key: 'dub-roast' })
  expect(calls).toBe(1)
  expect(await pane.find({ type: 'Text', text: /no translation for this line yet/ })).toBeDefined()
  await pane.press({ key: 'dub-roast' })
  expect(calls).toBe(2)
  expect(await pane.find({ type: 'Text', text: /正常输入能跑，别的随缘/ })).toBeDefined()
  await pane.unmount()
})

// ---- 换字幕轨的几个入口 ----

const MENU_PROPS = { ...CINEMA, title: 'Fansub settings' } as const

test('a bare /fansub opens the settings menu, where a press switches the track', async ($, on) => {
  mock.store(on)
  on('ui.toast', () => ({ value: undefined }))
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  let seen: readonly string[] = []
  on('prompt.submit', (_$, e) => {
    seen = e.context ?? []
    return { text: e.text }
  })
  await $.command.run(typed('lang zh'))
  await $.command.run(typed(''))
  expect(opened).toEqual(['fansub-menu'])

  for (const surface of ['terminal', 'desktop'] as const) {
    await $.command.run(typed('plain'))
    const menu = await $.ui.mount({ plugin: 'fansub', surface, component: 'Pane', requestId: 'fansub-menu', props: MENU_PROPS })
    expect((await menu.find({ key: 'menu-track-plain' }))?.props.label).toBe('「通俗」')
    await menu.press({ key: 'menu-track-roast' })
    expect((await menu.find({ key: 'menu-track-roast' }))?.props.label).toBe('「毒舌」')
    await menu.press({ key: 'menu-mode-mute' })
    expect((await menu.find({ key: 'menu-mode-mute' }))?.props.label).toBe('「原声调暗」')
    await menu.unmount()
  }
  await $.prompt.submit(SUBMIT)
  expect(seen.find(c => c.includes('fansub'))).toContain('Roast')
})

test('asking Claude works: its tool call switches the track', async ($, on) => {
  mock.store(on)
  on('ui.toast', () => ({ value: undefined }))
  let seen: readonly string[] = []
  on('prompt.submit', (_$, e) => {
    seen = e.context ?? []
    return { text: e.text }
  })
  const called = await $.tool.call({ tool: 'mcp__fansub__subtitles', track: 'boss' } as never)
  expect(JSON.stringify(called)).toContain('Boss')
  await $.prompt.submit(SUBMIT)
  expect(seen.find(c => c.includes('fansub'))).toContain('Subtitle track: Boss')

  const empty = await $.tool.call({ tool: 'mcp__fansub__subtitles' } as never)
  expect(JSON.stringify(empty)).toContain('Nothing to change')
})

test('a lone band letter typed into the prompt does what the key would, and never reaches the model', async ($, on) => {
  mock.store(on)
  feed(on)
  on('ui.toast', () => ({ value: undefined }))
  const reached: string[] = []
  let seen: readonly string[] = []
  on('prompt.submit', (_$, e) => {
    reached.push(e.text)
    seen = e.context ?? []
    return { text: e.text }
  })
  // 片库还空着（控制台还没出现）时，一个 r 就是普通消息。
  await $.prompt.submit({ ...SUBMIT, text: 'r' })
  expect(reached).toEqual(['r'])

  await play($)
  const dropped = await $.prompt.submit({ ...SUBMIT, text: 'r' })
  expect(dropped.drop).toContain('Roast')
  expect(reached).toEqual(['r'])
  await $.prompt.submit(SUBMIT)
  expect(seen.find(c => c.includes('fansub'))).toContain('Subtitle track: Roast')
  // 分享已经删掉：单打一个 s 就是普通消息。
  await $.prompt.submit({ ...SUBMIT, text: 's' })
  expect(reached).toContain('s')
})

// ---- 让一般人看得懂：空状态、首次引导、换完马上看到 ----

const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

/** 一轮里的几步：每步一段文字，和它的结束原因（tool_use 表示后面还有一步）。 */
function feedSteps(on: On, steps: { text: string; stop: 'end_turn' | 'tool_use' }[]) {
  let at = 0
  on('turn.step', async function* (_$, e) {
    const step = steps[Math.min(at++, steps.length - 1)]!
    yield { kind: 'text', index: 0, text: step.text, ref: 0 }
    yield { kind: 'stop', stopReason: step.stop, usage: null, ref: 0 }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: step.stop, usage: null }
  })
}

async function step($: Engine, turnId: string, index: number) {
  for await (const _ of $.turn.step({ turnId, index, model: 'test', messageCount: 1 })) {
    // drain
  }
}

test('a reply with no fluff at all says so, so nobody thinks the mod is broken', async ($, on) => {
  mock.store(on)
  // 测试里没有引擎自己的消息渲染：垫一个最简单的，好让 next(e) 有东西可画。
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  feedSteps(on, [
    { text: 'All 42 tests pass.', stop: 'end_turn' },
    { text: 'Coverage is not yet complete.⟦Half the code is untested.⟧', stop: 'tool_use' },
    { text: 'Done.', stop: 'end_turn' },
  ])
  await step($, 't1', 0)
  await step($, 't2', 0)
  await step($, 't2', 1)

  const dry = await $.ui.mount({ plugin: 'fansub', surface: 'terminal', component: 'AssistantMessage', props: { text: 'All 42 tests pass.', isFirstOfReply: true } })
  expect(await dry.find({ type: 'Text', text: /No fluff in this reply/ })).toBeDefined()
  await dry.unmount()

  // 同一轮前面一步已经出过字幕：最后那段就不再写「无水分」。
  const tail = await $.ui.mount({ plugin: 'fansub', surface: 'terminal', component: 'AssistantMessage', props: { text: 'Done.', isFirstOfReply: false } })
  expect(await tail.find({ type: 'Text', text: /No fluff/ })).toBeUndefined()
  await tail.unmount()
})

test('a new user gets a welcome band until the first subtitle shows up', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  feed(on)
  on('session.start', (_$, e) => e as never)
  on('command.register', () => ({ value: { command: 'fansub' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__fansub__subtitles' } }) as never)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)

  const band = await $.ui.mount({ plugin: 'fansub', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ type: 'Text', text: /Fansub is on/ })).toBeDefined()
  expect(await band.find({ key: 'got-it' })).toBeDefined()
  await band.unmount()

  await play($)
  const after = await $.ui.mount({ plugin: 'fansub', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await after.find({ type: 'Text', text: /Fansub is on/ })).toBeUndefined()
  expect(await after.find({ key: 'style' })).toBeDefined()
  await after.unmount()
})

test('switching style re-subtitles what is already on screen', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  feed(on)
  on('ui.toast', () => ({ value: undefined }))
  // haiku 的真实回法：包在 ```json 里，每条还照着示例套了一层 ⟦⟧。
  on('model.complete', () => ({ value: { isAnswered: true, text: '```json\n["⟦正常输入能跑，别的随缘。⟧"]\n```', usage: USAGE } }))
  await play($)

  const band = await $.ui.mount({ plugin: 'fansub', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  await band.press({ key: 'style' })
  await clock.advance(10)
  await band.unmount()

  const msg = await $.ui.mount({ plugin: 'fansub', surface: 'terminal', component: 'AssistantMessage', props: { text: ONE_LINE, isFirstOfReply: true } })
  expect(await msg.find({ type: 'Text', text: /正常输入能跑，别的随缘/ })).toBeDefined()
  expect(await msg.find({ type: 'Text', text: /⟦|⟧/ })).toBeUndefined()
  expect(await msg.find({ type: 'Text', text: /只测了正常输入/ })).toBeUndefined()
  await msg.unmount()
})

// ---- 省 token：完整说明只在需要时带 ----

const HISTORY = { role: 'user', text: '登录模块能上线吗？', toolUses: [] } as const

test('the full note goes out once, then a one-line reminder, and again after a style change or compaction', async ($, on) => {
  mock.store(on)
  on('ui.toast', () => ({ value: undefined }))
  let compacts = 0
  // 第一次压缩被跳过（什么也没压），第二次真的压了。
  on('session.compact', () => (++compacts === 1 ? { skip: 'nothing to compact' } : { messages: [HISTORY] }) as never)
  let seen: readonly string[] = []
  on('prompt.submit', (_$, e) => {
    seen = e.context ?? []
    return { text: e.text }
  })
  const note = async () => {
    await $.prompt.submit(SUBMIT)
    return seen.find(c => c.includes('fansub')) ?? ''
  }
  const first = await note()
  expect(first).toContain('Examples:')
  expect(first).toContain('Only in your final reply of a turn')

  const second = await note()
  expect(second).not.toContain('Examples:')
  expect(second).toContain('Track: Plain')
  expect(second.length).toBeLessThan(200)

  await $.command.run(typed('roast'))
  expect(await note()).toContain('Subtitle track: Roast')
  expect(await note()).not.toContain('Examples:')

  await $.session.compact({ trigger: 'manual', messages: [HISTORY] } as never)
  expect(await note()).not.toContain('Examples:')
  await $.session.compact({ trigger: 'manual', messages: [HISTORY] } as never)
  expect(await note()).toContain('Examples:')
})

test('text right after a subtitle does not start with a stray space', async ($, on) => {
  mock.store(on)
  const msg = await $.ui.mount({
    plugin: 'fansub',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: '聊得越久累积越多。⟦越聊越贵。⟧ 可以改成只在三种时候附带。', isFirstOfReply: true },
  })
  const texts: string[] = []
  const walk = (node: unknown) => {
    if (typeof node !== 'object' || node === null) return
    const el = node as { type?: string; props?: { text?: string; children?: unknown }; children?: unknown }
    if (el.type === 'Markdown' && el.props?.text) texts.push(el.props.text)
    for (const kids of [el.children, el.props?.children]) if (Array.isArray(kids)) kids.forEach(walk)
  }
  walk(await msg.drawn())
  expect(texts).toEqual(['聊得越久累积越多。', '可以改成只在三种时候附带。'])
  await msg.unmount()
})

// ---- 流式输出时不露括号 ----

test('while streaming, each subtitle moves to its own quoted line, code blocks untouched', () => {
  const first = streamView('当前实现尚未覆盖所有边界条件。⟦只测了正常输入。⟧ 该方案在性能上有优化空间。⟦有点慢。⟧\n```ts', false, true)
  expect(first.text).toBe('当前实现尚未覆盖所有边界条件。\n> 🎬 只测了正常输入。\n\n该方案在性能上有优化空间。\n> 🎬 有点慢。\n\n\n```ts')
  expect(first.inFence).toBe(true)
  // 代码块跨到下一次刷新：里面的 ⟦⟧ 原样保留
  const second = streamView('const s = "⟦这不是字幕⟧"\n```\n收尾。⟦半截', first.inFence, true)
  expect(second.text).toBe('const s = "⟦这不是字幕⟧"\n```\n收尾。')
  expect(second.inFence).toBe(false)
  // 关掉字幕：整条去掉
  expect(streamView('尚未达标。⟦没测够。⟧', false, false).text).toBe('尚未达标。')
})

test('the streamed view parses back to the same subtitles as the stored text', () => {
  const stored = '- 幻觉：模型有时会生成看似可信但并不准确的内容。⟦会一本正经地编。⟧\n- 知识截止：训练数据有截止日期。'
  const shown = streamView(stored, false, true).text
  expect(normalize(shown)).toBe(stored)
  expect(pairsOf(shown)).toEqual(pairsOf(stored))
})

test('the MessageDisplay hook rewrites what streams, and a message drawn from that view still gets subtitle bars', async ($, on) => {
  mock.store(on)
  on('classic.MessageDisplay', () => ({}))
  const shown = await $.classic.MessageDisplay({ turn_id: 't1', message_id: 'm1', index: 0, final: false, delta: '覆盖率尚未达标。⟦测试没写够。⟧\n' } as never)
  const text = (shown as { displayContent?: string }).displayContent ?? ''
  expect(text).toContain('> 🎬 测试没写够。')
  expect(text).not.toContain('⟦')

  const msg = await $.ui.mount({ plugin: 'fansub', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
  expect(await msg.find({ type: 'Text', text: /测试没写够/ })).toBeDefined()
  expect(await msg.find({ text: /🎬/ })).toBeUndefined()
  await msg.unmount()
})
