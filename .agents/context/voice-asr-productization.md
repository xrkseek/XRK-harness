# 语音输入产品化方案（ASR 从「能调用」到「零基础能用」）

> 依据：`.tmp/dsh-asr-tts-audit.md`（640 行 DSH 取证）+ 本仓 `packages/exec/voice`、
> `packages/client/ui-settings-plugins`、`docs/voice.md` 逐条核对。
> 老板的问题：DSH 的下载/环境准备学了没有？插件的配置卡片做了没有？

---

## 0. 先纠正一句话

上一轮我说「DSH 同款 ASR」——**说过头了**。准确的表述是：

| 层 | 状态 |
|---|---|
| 采集（16k mono PCM WAV） | ✅ 学到并落地（`input/voice-capture.ts`） |
| 传输（client → Host Remote） | ✅ 学到并落地（`voice/transcribe`） |
| 引擎（sherpa + SenseVoice + Silero） | ⚠️ **本仓早就有**（`sensevoice-local.ts`），但只读二进制、不管怎么来 |
| **资产获取（下载/校验/镜像）** | ❌ **完全没做** — 文件自己写明了 `no download/prepare pipeline in this MVP slice` |
| **配置卡片（零基础引导）** | ⚠️ **卡有，但不可用** — `mode` 是手输文本框，选 `local` 后零引导 |
| 平台适配 | ❌ 没做 — DSH 白名单里**没有 android**，而这正是老板的设备 |

`docs/voice.md:26` 自己的原话：「SenseVoice 资源准备（下载 / SHA）与 Silero 分段工作进程
仍对齐 DSH 实验包语义逐步补齐」—— 也就是说，**欠的账是对的，只是从来没还**。

---

## 1. DSH 到底是怎么做的（三件我们没做的事）

### 1.1 资产：仓库不含模型，靠锁文件 + 用户点「下载」

`packages/experimental/speech-to-text-sensevoice/runtime/assets.json` 钉死三元组：

```json
{ "models": { "int8": { "name": "model.int8.onnx",
    "url": "https://huggingface.co/csukuangfj/…/resolve/2365bae…/model.int8.onnx",
    "bytes": 239233841,
    "sha256": "c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51" } },
  "tokens": { "name": "tokens.txt", "bytes": 315894 },
  "vad": { "name": "silero_vad.onnx", "bytes": 1807522 } }
```

体积：**int8 ≈ 228 MiB**（默认）、fp32 ≈ 894 MiB、tokens 308 KiB、Silero VAD 1.7 MiB。

下载工程四件套（值得整段抄，都是防"半截文件/坏模型"的）：

1. **唯一 `.part` 临时文件** + `wx` flag（已存在就直接失败，不并发写坏）
2. **边下边算 sha256**，且**超过声明字节数立刻失败**（防止源返回 HTML 错误页）
3. **原子 `rename`** 发布
4. **多源并发 HEAD 探测选最快**，失败回退下一个，全失败保留配置序
   默认源：`https://huggingface.co` + `https://hf-mirror.com`（**国内镜像，对我们直接有用**）

### 1.2 环境：sherpa-onnx-node 是安装期依赖，不是运行时下载

`"sherpa-onnx-node": "1.13.8"` 是**普通 dependencies**（不是 optional），随安装落地，
含 6 个平台原生包（darwin-arm64/x64、linux-arm64/x64、win-ia32/x64）。

平台白名单（不满足就明确的"本机语音在该平台不可用"）：

```ts
const supported = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64']
```

DSH 自己在 README 里承认这是**隐形成本**：「安装 dsh 时会一并安装 sherpa-onnx-node
及其平台原生运行时（含 ONNX Runtime），**即使此 Bundle 处于禁用状态**。」

### 1.3 UI：麦克风按钮本身就是引导入口

```tsx
<Tooltip label={t('dictate')} disabled={!usable}>
  <Button aria-label={t(usable ? 'start' : 'setupPrompt.trigger')}
          aria-haspopup={usable ? undefined : 'dialog'}
          onClick={() => { if (usable) void start(); else setSetupOpen(true) }}>
    <IconMicrophoneOutlineRegular size={18} />
  </Button>
</Tooltip>
```

**未就绪时按钮不消失**，点它打开「准备」对话框（下载 + 进度 + 失败重试）。
另有失败文案分类学 `network|dns|timeout|certificate|http|integrity|storage|unknown`，
每类配一句"用户下一步做什么"。

---

## 2. 本仓现状：卡长什么样

`packages/client/ui-settings-plugins/src/client/voice-card-controller.ts`（141 行）目前四个字段：

| 字段 | 现状 | 问题 |
|---|---|---|
| `mode` | **纯文本输入**（`textField` 语义） | 用户要手敲 `off` / `openai` / `local` |
| `baseUrl` | 文本框 | 可以接受 |
| `speakTools` | 开关 | 只关 TTS 工具，与听写无关 |
| `apiKey` | 凭据写入 | 只有 openai 模式用得上 |

Host 侧 schema **本来就是枚举**（`settings-schemas.ts:357` `Schema.union(["off","openai","local"]).default("off")`）
—— 也就是说**卡片没跟上 schema**，这是纯粹的前端欠账，不是我发明的概念。

`local` 模式下用户能看到的全部信息量 = **无**。而 `sensevoice-local.ts` 其实已经写好了
`inspectSenseVoiceAssets()`（返回 `{ ready, dataRoot, missing, paths }`）—— **信息已经有了，
只是没接到 UI 上**。

---

## 3. 决定性风险：老板的设备是 Termux（Android）

这是整份方案里唯一需要老板先拍板的事。

- DSH 白名单 `linux-arm64` 指的是 **glibc** linux；Termux 跑的是 **Bionic** libc
- `sherpa-onnx-node` 的 `linux-arm64` 预编译 `.node` **大概率加载不了**（要么缺 glibc 符号，
  要么 ABI 不认）
- 而且 DSH 自己也没做 Android/Windows 签名包验收（原文：「Windows、Linux 真实机器及签名后的
  安装包仍需平台验收」）

**两条出路：**

### 路线 A：Host 原生（桌面优先）
- Windows / macOS / Linux 桌面：直接可用，性能最好（CPU，无 Python）
- **Termux：不做承诺**，靠"平台不支持"文案诚实拒绝
- 工作量：**小**

### 路线 B：浏览器 WASM（手机/Termux 唯一可行）
- sherpa-onnx 有官方 WASM 构建，SenseVoice INT8 在浏览器里跑（实测加载 ~2.5s）
- 模型 238 MB 下载到浏览器 Cache Storage，**不经过 Termux，不需要任何原生模块**
- 代价：手机首次要下 238 MB；每次打开要 ~2.5s 加载；吃手机内存
- **好处**：桌面/手机/任何有浏览器的设备**一套代码**，零平台白名单
- 工作量：**大**（要接 Emscripten glue + Classic Worker + Cache Storage 管理）

> 关键洞察：路线 B 其实**顺便解决**了"配置卡片"的一半问题 —— 下载目标从"用户自己去放文件"
> 变成"点一下，进度条在浏览器里跑"，这本来就是 Web 最擅长的形态。

---

## 4. 分期落地（按"每一期都能单独验收"切）

### P0 · 卡片先变得能用（低成本，1 天内）

**做什么**
1. `mode` 改成**三选一控件**：关 / 云端（OpenAI 兼容）/ 本机（免费，需要下载）
2. 选「本机」时，卡片显示 `inspectSenseVoiceAssets()` 的真实结果：
   - `ready: true` → 绿点「引擎已就绪」+ 显示模型精度 / 目录
   - `ready: false` → 列出 **缺哪几个文件** + 目标目录 + **一键复制下载命令**
3. `sherpa-onnx-node` 没装时，明确说"需要安装可选依赖"并给出命令

**为什么先做这个**：`inspectSenseVoiceAssets` 已经存在，Host 只需暴露一个只读 remote；
卡片从"什么都不告诉你"变成"告诉你缺什么、去哪放"。**零基础用户第一次能自己走通。**

**改哪里**
| 文件 | 改什么 |
|---|---|
| `packages/client/ui-settings-plugins/src/client/voice-card-controller.ts` | `modeField` 换选择器语义；加 `localReady/localMissing/localRoot` 投影 |
| `packages/client/ui-settings-plugins/src/client/VoiceCard.tsx`（94 行） | 渲染状态块 |
| `packages/server/face/src/handlers/voice.ts`（本轮新建的） | 加 `voice/inspect` 只读 handler |
| `packages/stubs/xrk-api-remotes/client.d.ts` | 加 `voice.inspect` 声明 |

**验收**：设置里选「本机」，卡片准确列出缺的文件；把三个文件手工放进去后刷新，显示"已就绪"。

---

### P1 · 下载器（中成本，1–2 天）

**做什么**：抄 DSH 的 `.part` + sha256 边下边校验 + 原子 rename + 多源探测。

```
voice/prepare        { }            → 启动下载，返回 taskId
voice/prepareStatus  { taskId }     → { phase, bytesDone, bytesTotal, speed, eta, failure? }
```

**只做 desktop 平台**（`win32-x64 / darwin-arm64 / darwin-x64 / linux-x64`），
其余平台直接返回"该平台请用浏览器内识别"。

**新增**：`packages/exec/voice/assets.json`（钉 int8 + tokens + Silero VAD 的 url/bytes/sha256）
+ `packages/exec/voice/src/sensevoice-runtime.ts`（下载/校验/发布）
+ `assets` 来源要在 `docs/voice.md` 写明**第三方来源与许可**（`csukuangfj/*` 社区镜像，别默认信任）。

**验收**：断网 → 失败且给出 `network` 分类文案；中途 kill → 不留半截文件；下载完成 → sha256 对得上才 rename。

---

### P2 · 进度 UI + 失败文案 + 试一句（中成本，1 天）

**做什么**
1. 卡片里进度条：已下 / 总量 / 速度 / 剩余时间；可取消
2. 失败分类文案（照抄 DSH 的 8 类，每类一句"下一步做什么"）
3. **「试一句」按钮**：录 3 秒 → 走本轮的 `voice/transcribe` → 显示识别文本
   —— 这是零基础用户唯一能自己判断"到底好没好"的方式，比任何状态灯都值钱
4. 麦克风按钮联动：`local` 模式未就绪时，点麦克风**打开设置卡片**而不是报错
   （DSH 的 `setupPrompt` 模式）

**验收**：全新机器 → 设置里点下载 → 进度跑完 → 点「试一句」→ 说话 → 出字。

---

### P3 · 浏览器 WASM（大成本，3–5 天，**可选**）

**只有当老板确认"主要用手机/Termux"时才做。**

- 接 sherpa-onnx 的 Emscripten WASM 构建（Classic Worker + `importScripts`）
- 模型进 Cache Storage，带 sha256 校验与版本淘汰
- 一旦就绪，`voice/transcribe` 在浏览器内闭环，Host 完全不参与

---

## 5. 需要老板拍板的三件事

| # | 决策 | 影响 |
|---|---|---|
| 1 | **主要在哪个设备用？** 桌面 / 手机 Termux / 都要 | 手机 → P3 是主线，P1 只能服务桌面；桌面 → P0+P1+P2 就够 |
| 2 | **228 MB 模型下载能接受吗**（手机流量 / 存储） | 不能接受 → 只能走云端 openai 模式，本地路线作废 |
| 3 | **要不要支持 fp32**（894 MB） | 建议**不要**：int8 质量够、体积差 4 倍 |

---

## 6. 明确不做什么（防过度设计）

- ❌ **不做按钮位置配置**：DSH 专门论证过没做，我们已经有 slot 体系
- ❌ **不移植 DSH 的 RPC 协议**：只学"语音调用不产生 Session 事件、绝不自动提交"这条边界
- ❌ **不做常开麦克风 / 唤醒词 / 流式字幕**：`docs/voice.md:28` 已明确未交付，DSH 也没做
- ❌ **不做 TTS 对齐**：DSH 根本没有 TTS，我们的 `text_to_speech` + `voice_session` 是净优势
- ❌ **不把 sherpa-onnx-node 变强制依赖**：它是 6 个平台的原生包，强制装等于给每个用户塞
  ONNX Runtime。用 **optionalDependency + 明确提示**

---

## 7. 一句话总结

**能调用的部分已经通了（本轮），不能用的部分是"资产获取 + 引导"这两件产品壳。**
最小可行路径是 **P0（半天，让卡片说实话）→ P2 里的「试一句」（半天，让用户能自证）**，
先不写下载器 —— 因为老板的设备是 Termux，而下载器只对桌面有意义。
**P1 要不要做、P3 要不要做，取决于第 5 节第 1 个决策。**
