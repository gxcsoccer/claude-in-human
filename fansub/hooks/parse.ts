// 字幕的纸面格式：官话。⟦大白话⟧ —— Claude 在原句后面就地打字幕。
export const OPEN = '⟦'
export const CLOSE = '⟧'

export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'sub'; text: string; formal: string; isOpen: boolean }

// 代码块和行内代码里的 ⟦⟧ 都是正文，不是字幕（比如在解释字幕格式时写的 `⟦…⟧`）。
const FENCE = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/
const SUB = /⟦([^⟦⟧]*)(⟧|$)/g

/** 原句：字幕前面那一句，去掉 markdown 记号。 */
export function lastSentence(before: string): string {
  const s = before.replace(/\s+$/, '')
  let i = s.length - 2
  // 英文的句号要后面跟空白才算句末，免得把 3.5、v1.2 当成断句。
  while (i >= 0 && !/[。！？!?\n；;]/.test(s[i] ?? '') && !(s[i] === '.' && /\s/.test(s[i + 1] ?? ''))) i--
  return s
    .slice(i + 1)
    .replace(/^\s*(?:[-*+]|\d+\.|#+|>)\s+/, '')
    .replace(/\*\*|__|`/g, '')
    .trim()
}

/** 把一段回复切成「正文 / 字幕」交替的片段；代码块、行内代码里不认字幕。 */
export function parse(raw: string): Segment[] {
  const text = normalize(raw)
  const out: Segment[] = []
  let prose = ''
  const pushText = (t: string) => {
    const last = out[out.length - 1]
    if (last?.kind === 'text') last.text += t
    else if (t) out.push({ kind: 'text', text: t })
  }
  for (const [i, part] of text.split(FENCE).entries()) {
    if (i % 2 === 1) {
      pushText(part)
      // 代码块另起一段；行内代码是句子的一部分，原句要连着它一起算。
      prose = part.startsWith('```') ? '' : prose + part
      continue
    }
    let at = 0
    for (const m of part.matchAll(SUB)) {
      const head = part.slice(at, m.index)
      pushText(head)
      prose += head
      const sub = (m[1] ?? '').trim()
      if (sub || m[2] === '') {
        out.push({ kind: 'sub', text: sub, formal: lastSentence(prose), isOpen: m[2] === '' })
      }
      at = (m.index ?? 0) + m[0].length
    }
    pushText(part.slice(at))
    prose += part.slice(at)
  }
  return out
}

// 流式输出时屏幕上的样子：每条字幕单独一行引用。回复结束后，引擎可能拿这份显示版来画消息，
// 所以解析前先把它还原成 ⟦⟧，两种来源画出来的字幕条一样。
const SHOWN = /\n> 🎬 ([^\n]*)\n\n/g
const SHOWN_MARK = '\n> 🎬 '

/** 把流式显示版里的「> 🎬 字幕」还原成 ⟦字幕⟧。 */
export function normalize(text: string): string {
  return text.includes(SHOWN_MARK) ? text.replace(SHOWN, (_, sub: string) => `${OPEN}${sub}${CLOSE}`) : text
}

export function hasSubs(text: string): boolean {
  return text.includes(OPEN) || text.includes(SHOWN_MARK)
}

/**
 * 流式输出时的显示版（只改屏幕，不改存下来的消息）：句子里的 ⟦字幕⟧ 换成紧跟其后的一行引用，
 * 不再在句子中间露出括号。按行处理，代码块跨好几次刷新，所以由调用方记住是否在代码块里。
 * 半截的字幕（最后一次刷新可能停在半行）先不显示；关掉字幕时整条去掉。
 */
export function streamView(delta: string, inFence: boolean, showSubs: boolean): { text: string; inFence: boolean } {
  const out: string[] = []
  for (const line of delta.split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      out.push(line)
      continue
    }
    if (inFence || !line.includes(OPEN)) {
      out.push(line)
      continue
    }
    let shown = ''
    for (const seg of parse(line)) {
      if (seg.kind === 'text') shown += shown.endsWith('\n\n') ? seg.text.replace(/^[ \t]+/, '') : seg.text
      else if (showSubs && !seg.isOpen && seg.text) shown += `${SHOWN_MARK}${seg.text}\n\n`
    }
    out.push(shown)
  }
  return { text: out.join('\n'), inFence }
}

/** 关字幕：只留 Claude 的原声。 */
export function strip(text: string): string {
  return parse(text)
    .filter(s => s.kind === 'text')
    .map(s => s.text)
    .join('')
    .replace(/[ \t]+\n/g, '\n')
}

export function pairsOf(text: string): { formal: string; sub: string }[] {
  return parse(text).flatMap(s =>
    s.kind === 'sub' && !s.isOpen && s.formal && s.text ? [{ formal: s.formal, sub: s.text }] : [],
  )
}

const width = (s: string) => Array.from(s).length

/** 含水量：官话比大白话多出来的那部分。 */
export function water(pairs: readonly { formal: string; sub: string }[]): number | null {
  const formal = pairs.reduce((n, p) => n + width(p.formal), 0)
  if (formal === 0) return null
  const sub = pairs.reduce((n, p) => n + width(p.sub), 0)
  return Math.max(0, Math.min(1, 1 - sub / formal))
}

export function pct(ratio: number | null): string {
  return ratio === null ? '—' : `${Math.round(ratio * 100)}%`
}

/** 放映厅里一句字幕停留的拍数（每拍一秒），字多就多停一会儿。 */
export function beatsFor(pair: { formal: string; sub: string }): number {
  return 2 + Math.ceil((width(pair.formal) + width(pair.sub)) / 18)
}
