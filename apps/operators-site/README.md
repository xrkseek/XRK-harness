# XRK 干员分享站

> **读者**：维护者

Cloudflare **Pages 静态站**（与下载站 Worker `apps/site` **分开**）。  
页面只渲染目录与表情球；**zip / json 字节在 AGT**，下载按钮指向 AGT 绝对 URL。

| 站 | 产品 | 仓内 |
|----|------|------|
| 下载站 | Cloudflare **Worker** `xrk-harness` | `apps/site` |
| 干员站 | Cloudflare **Pages** `xrk-operators` | `apps/operators-site` |

两站顶栏互相链（本站读 `catalog.json` 的 `sites.download`；下载站用 env `OPERATORS_SITE`）。

## 表情球

**可以。** 复用下载站同源静态脚本：

`public/presence/emotion-ball/{rings,emotions,ball,engine}.js`

与产品壳 / `apps/site` 同契约：`EmotionBall.create(el, { emotion, idle, lite, shape, color, … })`。  
装扮与体色**只活在站点展示层**——`team_export` 的 card/pack **不** round-trip appearance（见 `agent-member-card.ts`）。

## 包契约（真源在 Face）

高级包 = `xrk-member-<名>.zip`：

| 根项 | 必填 |
|------|------|
| `.xrk-agent-pack` | 是（marker） |
| `manifest.json` | 是（`kind: xrk-agent-pack`） |
| `playbook.md` | 是 |
| `skills/<id>/SKILL.md` | 可选 |
| `workspace/` | 可选 |
| `env/SETUP.md` | 可选 |

瘦卡 = `xrk-member-<名>.json`（`kind: xrk-agent-member`）。  
用户导入：壳内拖 zip / `team_import pack=` 或 `card=`。

## AGT 落盘（建议）

```text
data/operator-share/
  catalog.json
  packs/<id>.zip
  cards/<id>.json
```

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/operators` | 列表（可替代本站静态 `catalog.json`） |
| `GET` | `/api/operators/:id/download` | 字节 |
| `POST` | `/api/operators` | 上传（须鉴权） |

本站优先 `fetch(agtOrigin + list)`；失败回退 `catalog.json`。

## Cloudflare Pages 填法（照抄）

| 字段 | 填什么 |
|------|--------|
| 连接仓库 | `xrkseek/XRK-harness` |
| Project name / 项目名称 | `xrk-operators`（**不要** `xrk-harness`） |
| Production branch / 生产分支 | `main` |
| Framework preset / 框架预设 | **无 / None** |
| Root directory（高级） | `apps/operators-site` |
| Build command / 构建命令 | **留空** |
| Build output directory / 构建输出目录 | `public` |
| Environment variables | 可不填 |

**不要**建 Worker。本站是纯静态 Pages。  
部署后把真实 `https://xrk-operators.pages.dev`（或自定义域）写进下载站 env `OPERATORS_SITE`，并把本站 `public/catalog.json` 里 `sites.download` 指回下载站。

本地预览：任意静态服务器指到 `public/`。

## 目录条目

`catalog.json` → `members[]`：

```json
{
  "id": "mem_example",
  "name": "示例干员",
  "brief": "一句话职责",
  "kind": "advanced",
  "shape": "blob",
  "color": "sage",
  "filename": "xrk-member-示例干员.zip",
  "downloadUrl": "https://xrk.siphot.com/api/operators/mem_example/download",
  "sizeBytes": 12000,
  "skills": ["xrk-example"]
}
```

`downloadUrl` 必须是 **AGT 绝对 URL**（或同源反代后的公开 HTTPS）。  
CF 不扛大包。

---

# XRK operators share site

> **Audience**: Maintainers

Cloudflare **Pages** (separate from the download **Worker** in `apps/site`).  
UI + emotion balls here; pack bytes on **AGT**.

Emotion-ball scripts are vendored under `public/presence/emotion-ball/` (same as `apps/site`). Pack layout: Face `agent-member-pack.ts`. Pages root = `apps/operators-site`, output = `public`, project name `xrk-operators`.
