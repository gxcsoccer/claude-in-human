/** 字幕轨：同一句官话，四种翻法。 */
export type FansubTrack = 'plain' | 'roast' | 'boss' | 'kid'
/** 界面语言：中文环境用中文，其余用英文。 */
export type FansubLang = 'zh' | 'en'
/** 双语 / 原声调暗（只盯字幕）/ 关字幕。 */
export type FansubMode = 'dual' | 'mute' | 'off'
/** 居中影院条 / 贴身旁注。 */
export type FansubLayout = 'cinema' | 'margin'
/** 一句官话和它的字幕；track 是打这条字幕时用的字幕轨。 */
export type FansubPair = { id: number; formal: string; sub: string; track?: FansubTrack }
/** 正在流式生成的那句字幕（同声传译）。 */
export type FansubLive = { formal: string; sub: string; isTyping: boolean }
/** 放映厅的放映进度；track 为 original 时放 Claude 自己打的字幕。 */
export type FansubReel = { at: number; isPlaying: boolean; track: FansubTrack | 'original' }
/** 每条字幕轨的重配版本：pair id → 字幕。 */
export type FansubDubs = { [track: string]: { [id: string]: string } }

declare module 'claude-code' {
  interface PluginState {
    fansub: {
      track: FansubTrack
      mode: FansubMode
      layout: FansubLayout
      pairs: FansubPair[]
      live: FansubLive | null
      reel: FansubReel
      dubs: FansubDubs
      dubbing: string | null
      lang: FansubLang
      /** 整轮没有官话的回复，按结尾文字记下来，好在它下面写「本条无水分」。 */
      dry: string[]
      /** 从没见过字幕的新用户：控制台给他看欢迎引导。 */
      isNew: boolean
      /** 成功换过一次风格：控制台上的提示就不再显示。 */
      hasSwitched: boolean
      /** 模型已经拿到完整说明时的「风格|语言」；变了、压缩了、/clear 了就清空，下一轮重发。 */
      briefed: string | null
    }
  }
}
