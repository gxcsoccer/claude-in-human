# 🎬 Claude 说人话

Claude 最近越来越不说人话了，写一个插件来同声翻译下它的语言。

![fansub demo](assets/fansub-demo.gif)

> 当前实现尚未覆盖所有边界条件。
> **只测了正常输入。**

fansub 是一个 Claude Code 插件。Claude 照常用专业、克制的口吻回答你；遇到委婉、打官腔、或者把坏消息说得很软的句子，句子下面会多出一条黄字字幕，直接说出它的真实意思。

## 安装

```bash
claude plugin marketplace add gxcsoccer/claude-in-human
claude plugin install fansub@claude-in-human
```

装好后新开一个 Claude Code 会话就会生效。第一次使用时，提示框上方会出现欢迎提示。

需要支持函数钩子（function hooks）插件的 Claude Code 版本，开发和测试用的是 2.1.290。

卸载：

```bash
claude plugin uninstall fansub@claude-in-human
```

## 四种字幕风格

同一句「该方案在性能上存在一定的优化空间。」：

| 风格 | 字幕 |
|---|---|
| 通俗 | 有点慢。 |
| 毒舌 | 慢得能泡杯茶。 |
| 老板 | 用户多了要加机器。 |
| 幼儿园 | 它跑得像小乌龟 🐢 |

换风格时，屏幕上已有的字幕会当场按新风格重配一遍，不用等下一条回复。

## 怎么用

**换风格**，四种方式随便选：

- 直接跟 Claude 说：「换成毒舌字幕」「关掉字幕」
- 点提示框上方控制台里的「换风格」
- 在输入框里单打 `t` 回车（`p` `r` `b` `k` 直接切到通俗、毒舌、老板、幼儿园）
- 输入 `/fansub` 打开设置菜单

**设置菜单**（`/fansub`）里还能改：

- 显示：双语 / 原声调暗（官话变暗，只盯字幕）/ 关字幕
- 样式：居中影院条 / 贴身旁注
- 语言：中文 / English / 跟随系统

**放映厅**：在菜单里打开，或者单打 `c` 回车。把这次会话里所有官话按电影的方式一句句重放，`h` `l` 换幕，`p` 暂停，`o` `1`–`4` 换字幕轨。

**其他命令**：`/fansub stats` 看本场统计；`/fansub plain|roast|boss|kid`、`/fansub dual|mute|off`、`/fansub layout`、`/fansub lang zh|en|auto`。

## 它是怎么工作的

- 每条消息会附带一段只有 Claude 看得到的说明，请它在委婉的句子后面写上 `⟦字幕⟧`。完整说明约 400 token，只在第一轮、换风格或语言之后、对话压缩之后发送；其余轮次只附一行约 40 token 的提醒。
- 插件把回复里的 `⟦…⟧` 画成句子下方的字幕条，流式输出时显示为单独的一行。
- 字幕只加在一轮最后给你的回复里，干活过程中的进度汇报不加。
- 换风格时，用 haiku 把屏幕上最近 20 句字幕重配一遍。

## 已知限制

- 字幕由 Claude 自己写，哪句需要字幕、写得好不好笑，取决于模型当时的判断。纯事实的回复不会有字幕，末尾会显示「✅ 本条无水分」。
- `⟦…⟧` 标记保存在真实的对话记录里：复制回复时会带上它，卸载插件后旧消息会露出原始括号。
- 插件依赖 Claude Code 的函数钩子插件接口，这套接口仍处于早期阶段，Claude Code 升级后可能需要跟着调整。

## 开发

```bash
claude plugin test fansub       # 跑测试
claude plugin validate fansub   # 校验清单和钩子
claude --plugin-dir ./fansub    # 用本地目录加载
```

## 许可证

[MIT](LICENSE)

---

## English

**fansub** is a Claude Code plugin. Claude keeps answering in its usual measured tone; whenever a sentence is diplomatic, hedged or softens bad news, a yellow subtitle appears underneath saying what it really means.

```bash
claude plugin marketplace add gxcsoccer/claude-in-human
claude plugin install fansub@claude-in-human
```

Four subtitle styles: **Plain**, **Roast**, **Boss** (what a manager hears) and **Kid** (explained to a five-year-old). Switch by telling Claude ("switch to roast subtitles"), by pressing **Style** on the band above the prompt, or with `/fansub`, which opens the settings menu. The interface follows your system language (Chinese or English).
