import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
  Header, Footer, AlignmentType, LevelFormat, HeadingLevel,
  BorderStyle, WidthType, ShadingType, VerticalAlign, PageNumber, PageBreak
} from "docx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const OUT = path.join(__dirname, "XRK-Harness-项目书.docx");
const LOGO_PLATE = path.join(ROOT, "docs/assets/logo-plate.png");

const INK = "232321";
const GOLD = "B0803C";
const BROWN = "7A5A34";
const GREY = "6B655C";
const CREAM = "F6F1E8";
const BORDER_C = "D8CDBD";

const FONT = "Microsoft YaHei";
function runFont() { return { ascii: FONT, eastAsia: FONT, hAnsi: FONT, cs: FONT }; }

const cellBorders = {
  top: { style: BorderStyle.SINGLE, size: 1, color: BORDER_C },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: BORDER_C },
  left: { style: BorderStyle.SINGLE, size: 1, color: BORDER_C },
  right: { style: BorderStyle.SINGLE, size: 1, color: BORDER_C },
};

function para(text, opts = {}) {
  const { bold, size = 21, color = "2A2A28", align, spacing = { after: 120, line: 300 }, indent, keepNext } = opts;
  return new Paragraph({ children: [new TextRun({ text, bold, size, color, font: runFont() })],
    alignment: align, spacing, indent, keepNext });
}

function h1(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_1,
    spacing: { before: 300, after: 160, line: 320 },
    children: [new TextRun({ text, bold: true, size: 28, color: INK, font: runFont() })],
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: GOLD, space: 5 } } });
}

function h2(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_2,
    spacing: { before: 220, after: 120, line: 300 },
    children: [new TextRun({ text, bold: true, size: 24, color: BROWN, font: runFont() })] });
}

function bullet(text, level = 0) {
  return new Paragraph({ numbering: { reference: "bullets", level },
    spacing: { after: 60, line: 300 },
    children: [new TextRun({ text, size: 21, color: "2A2A28", font: runFont() })] });
}

function num(text) {
  return new Paragraph({ numbering: { reference: "numbers", level: 0 },
    spacing: { after: 60, line: 300 },
    children: [new TextRun({ text, size: 21, color: "2A2A28", font: runFont() })] });
}

const CHART_SIZE = {
  "market-growth.png": [560, 278],
  "pilot-failure.png": [300, 373],
  "cancellation.png": [560, 222],
  "adoption.png": [560, 260],
  "lost-middle.png": [560, 258],
};

function chart(file, caption) {
  const [w, h] = CHART_SIZE[file];
  const img = new Paragraph({ alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 40, line: 260 },
    children: [new ImageRun({ type: "png",
      data: fs.readFileSync(path.join(__dirname, "charts", file)),
      transformation: { width: w, height: h },
      altText: { title: caption, description: caption, name: file } })] });
  const cap = new Paragraph({ alignment: AlignmentType.CENTER,
    spacing: { after: 220, line: 260 },
    children: [new TextRun({ text: caption, size: 17, color: GREY, italics: true, font: runFont() })] });
  return [img, cap];
}

function cellParagraph(cell) {
  if (cell && cell.startsWith("**") && cell.endsWith("**")) {
    return new Paragraph({ children: [new TextRun({ text: cell.slice(2, -2), bold: true, size: 20, color: "6B4A24", font: runFont() })] });
  }
  return new Paragraph({ children: [new TextRun({ text: cell, size: 20, color: "2A2A28", font: runFont() })] });
}

function bodyCell(c, i, ri, widths) {
  return new TableCell({
    borders: cellBorders,
    width: { size: widths[i], type: WidthType.DXA },
    shading: { fill: ri % 2 === 0 ? CREAM : "FFFFFF", type: ShadingType.CLEAR },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 70, bottom: 70, left: 120, right: 120 },
    children: (Array.isArray(c) ? c : [c]).map(cellParagraph),
  });
}

function makeTable({ widths, header, rows }) {
  const rowHeader = new TableRow({
    tableHeader: true,
    children: header.map((h, i) => new TableCell({
      borders: cellBorders,
      width: { size: widths[i], type: WidthType.DXA },
      shading: { fill: INK, type: ShadingType.CLEAR },
      verticalAlign: VerticalAlign.CENTER,
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({ alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: h, bold: true, size: 20, color: "FFFFFF", font: runFont() })] })],
    })),
  });
  const bodyRows = rows.map((r, ri) => new TableRow({
    children: r.map((c, i) => bodyCell(c, i, ri, widths)),
  }));
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    rows: [rowHeader, ...bodyRows],
  });
}

const PAGEW = 11906, PAGEH = 16838, MARGIN = 1440;

const CHAPTERS = [
  "一、行业背景与痛点",
  "二、项目概述",
  "三、产品描述与功能",
  "四、目标用户与市场",
  "五、竞争对手分析",
  "六、技术架构与创新点",
  "七、商业模式与发展规划",
  "八、团队组成",
  "九、风险分析与对策",
  "十、结语",
  "附录：项目信息一览",
];

let TOC_PAGES = {};
try {
  const raw = fs.readFileSync(path.join(__dirname, "toc_pages.json"), "utf8");
  TOC_PAGES = JSON.parse(raw.replace(/^\uFEFF/, ""));
} catch (e) { /* not present yet -> placeholders */ }

function staticToc() {
  return makeTable({
    widths: [6900, 2126],
    header: ["章    节", "页码"],
    rows: CHAPTERS.map((t) => [t, TOC_PAGES[t] ? String(TOC_PAGES[t]) : "—"]),
  });
}

const doc = new Document({
  creator: "XRK-Harness 团队",
  title: "XRK-Harness 项目计划书",
  description: "面向个人的 TypeScript 智能体运行时与服务器套件项目书",
  styles: {
    default: { document: { run: { font: runFont(), size: 21 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: runFont(), color: INK },
        paragraph: { spacing: { before: 300, after: 160 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: runFont(), color: BROWN },
        paragraph: { spacing: { before: 220, after: 120 }, outlineLevel: 1 } },
    ],
  },
  numbering: { config: [
    { reference: "bullets", levels: [
      { level: 0, format: LevelFormat.BULLET, text: "◆", alignment: AlignmentType.LEFT,
        style: { run: { color: GOLD }, paragraph: { indent: { left: 460, hanging: 220 } } } },
      { level: 1, format: LevelFormat.BULLET, text: "◦", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 900, hanging: 220 } } } },
    ]},
    { reference: "numbers", levels: [
      { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 460, hanging: 220 } } } },
    ]},
  ]},
  sections: [
    // ---------- COVER ----------
    {
      properties: { page: { size: { width: PAGEW, height: PAGEH }, margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } } },
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 900, after: 200 },
          children: [new ImageRun({ type: "png", data: fs.readFileSync(LOGO_PLATE), transformation: { width: 260, height: 260 },
            altText: { title: "XRK-Harness 徽标", description: "XRK-Harness 项目徽标", name: "logo" } })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 300, after: 60 },
          children: [new TextRun({ text: "XRK-Harness", bold: true, size: 64, color: INK, font: runFont() })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 },
          children: [new TextRun({ text: "项目计划书 · 项目书", bold: true, size: 40, color: GOLD, font: runFont() })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 },
          children: [new TextRun({ text: "面向个人的 TypeScript 智能体运行时与服务器套件", size: 24, color: GREY, font: runFont() })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 40, after: 80 },
          children: [new TextRun({ text: "—— 向阳而生，笃光而行 ——", size: 22, color: BROWN, font: runFont() })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 360 },
          children: [new TextRun({ text: "一、行 业 背 景 与 痛 点", bold: true, size: 26, color: GOLD, font: runFont() })] }),
        makeTable({
          widths: [2400, 6626],
          header: ["项目", "填报信息"],
          rows: [
            ["**项目名称**", "XRK-Harness 智能体运行时与服务器套件"],
            ["**所属领域**", "信息技术服务业"],
            ["**所在地区**", "辽宁省 沈阳市"],
            ["**当前版本**", "v0.1.21（官方公开发布线）"],
            ["**开源协议**", "MIT License"],
            ["**技术栈**", "TypeScript · Node.js ≥ 26"],
            ["**填报日期**", "2026 年 8 月 26 日"],
          ],
        }),
      ],
    },
    // ---------- BODY ----------
    {
      properties: { page: { size: { width: PAGEW, height: PAGEH }, margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } } },
      headers: {
        default: new Header({ children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER_C, space: 2 } },
          spacing: { after: 60 },
          children: [new TextRun({ text: "XRK-Harness 项目计划书", size: 16, color: GREY, font: runFont() })] })] }),
      },
      footers: {
        default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: "第 ", size: 16, color: GREY, font: runFont() }),
            new TextRun({ children: [PageNumber.CURRENT], size: 16, color: GREY, font: runFont() }),
            new TextRun({ text: " 页 / 共 ", size: 16, color: GREY, font: runFont() }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: GREY, font: runFont() }),
            new TextRun({ text: " 页", size: 16, color: GREY, font: runFont() }),
          ] })] }),
      },
      children: [
        // ============ 目录页（静态目录，页码由 Word COM 回填） ============
        new Paragraph({ spacing: { after: 60 },
          children: [new TextRun({ text: "目 录", bold: true, size: 32, color: INK, font: runFont() })] }),
        staticToc(),
        new Paragraph({ children: [new PageBreak()] }),

        // ============ 一、行业背景与痛点 ============
        h1("一、行业背景与痛点"),
        para("大模型的能力正从「对话工具」跃迁为「可执行任务的智能体」，带来一个高速增长的市场，也暴露出一条明显的落地鸿沟：供给在爆发，生产却在失速。本章用可量化的行业数据说明这一矛盾，并点出 XRK-Harness 的切入点。以下数据均取自可回溯的公开权威来源（Grand View Research、MIT、Gartner、TACL 学术论文等）。"),
        h2("1.1 市场：从「尝鲜」走向「基础设施」"),
        para("据 Grand View Research（2025 年 5 月）发布的《AI Agents Market Report》，全球 AI Agent 市场规模预计到 2030 年达到 503.1 亿美元，2025—2030 年复合增长率（CAGR）为 45.8%。以此 CAGR 倒推，2025 年市场规模约 76 亿美元。这意味着智能体正从「尝鲜」走向「基础设施」。"),
        ...chart("market-growth.png", "图 1-1  全球 AI Agent 市场规模（数据来源：Grand View Research，2025-05-06；2025 年数值为按 CAGR 反推的估算值）"),
        h2("1.2 渗透：企业软件正在快速嵌入智能体"),
        para("Gartner（2025 年 6 月）预测，到 2028 年将有 33% 的企业软件应用包含智能体（agentic AI）能力，而 2024 年这一比例不足 1%；同期，至少 15% 的日常工作决策将由智能体自主完成（2024 年为 0%）。但 Gartner 同时警示：据其对 2025 年 1 月 3,412 名 Webinar 参会者的调研，仅 19% 的组织已进行显著投资，42% 为保守投资，31% 仍在观望。"),
        ...chart("adoption.png", "图 1-2  企业软件智能体渗透率：2024 vs 2028 预测（数据来源：Gartner，2025-06-25）"),
        para("需求侧的渗透速度很快，但「落地质量」远未跟上，这正是行业痛点的根源。"),
        h2("1.3 痛点一：试点到生产，成功率极低"),
        para("MIT NANDA 报告《The GenAI Divide: State of AI in Business 2025》指出：尽管企业累计投入 300—400 亿美元于生成式 AI，仍有 95% 的企业试点未能带来财务回报，只有约 5% 的整合型试点真正提取到价值。这说明失败的主因不在模型，而在工程与治理链路。"),
        ...chart("pilot-failure.png", "图 1-3  企业生成式 AI / 智能体试点结果（数据来源：MIT NANDA，《The GenAI Divide》，2025）"),
        h2("1.4 痛点二：项目被大量取消，成本与价值失衡"),
        para("Gartner（2025 年 6 月 25 日）预测，到 2027 年底将有超过 40% 的智能体项目被取消，主因是成本攀升、商业价值不清晰或风险控制不足。Gartner 更进一步估计：在成千上万的智能体供应商中，真正具备 agentic 能力的仅约 130 家，存在明显的「agent washing」。"),
        ...chart("cancellation.png", "图 1-4  Gartner：到 2027 年底超 40% 的智能体项目将被取消（数据来源：Gartner，2025-06-25）"),
        h2("1.5 痛点三：长上下文「中间迷失」，精准度下降"),
        para("跨模型的能力局限同样真实存在。Liu 等人在《Lost in the Middle: How Language Models Use Long Contexts》（TACL 2024，斯坦福 / 加州伯克利 / Samaya AI）中发现：当相关信息位于输入上下文中间时，模型性能会显著下降。例如 GPT-3.5-Turbo 在多文档问答上的性能下降可超过 20%，且长上下文模型同样受此影响，呈现出「U 型」注意力曲线。"),
        ...chart("lost-middle.png", "图 1-5  长上下文「中间迷失」示意：信息位置对可用性的影响（依据 Liu et al., TACL 2024 的 U 型曲线结论绘制；纵轴为相对可用性，非论文原始刻度）"),
        para("因此，「把上下文当作稀缺资源来治理」而非「一味堆大窗口」，成为智能体工程化的关键之一。"),
        h2("1.6 痛点归纳与机会"),
        makeTable({
          widths: [2300, 6726],
          header: ["行业痛点", "XRK-Harness 的回应"],
          rows: [
            ["**编排与集成复杂**", "预置接线 minimal / harness / server 只做组合，不写业务，开箱即用。"],
            ["**会话不可追溯**", "以会话事件为唯一真源，长会话可压缩、可导出、可复盘。"],
            ["**评估与可观测缺失**", "工具流水线 + 状态/视图分离，链路清晰；能力矩阵诚实三态标注。"],
            ["**上下文不受控**", "长会话换窗压缩，壳上可见 token 与上下文压力，缓解「中间迷失」。"],
            ["**厂商锁定**", "厂商中立的多模型 Registry，支持 openai / anthropic / gemini 等协议。"],
            ["**数据与权限风险**", "本地优先 + 三级权限预设与策略放行，敏感数据默认本机。"],
          ],
        }),

        new Paragraph({ children: [new PageBreak()] }),

        // ============ 二、项目概述 ============
        h1("二、项目概述"),
        para("XRK-Harness 是一套面向个人开发者与小型团队的智能体（Agent）运行时与服务器套件。它以会话（Session）为唯一真源，用纯 TypeScript 构建，运行于 Node.js 26 及以上版本，旨在让「每个人都能低成本拥有自己的智能体」。"),
        para("项目提供一条命令行（xrkh run）与一个网页（xrkh web / serve）双入口：既能在终端里快速验证想法，也能在浏览器中完成模型配置、会话管理、工具与权限调参、插件挂载等日常操作。整体遵循「可组合」原则——最小、完整、服务三套预置接线只做组合、不写业务逻辑，开发者按需拼装，即可从零到一搭建可运行的智能体。"),
        h2("2.1 项目定位"),
        para("开源、本地优先、TypeScript 原生的个人智能体运行时与服务器套件。以会话事件日志为对话真源，通过可组合预置接线与可扩展插件体系，承载个人助理、研究助手、知识工作台等场景。"),
        h2("2.2 核心价值主张"),
        makeTable({
          widths: [2600, 6426],
          header: ["价值维度", "具体体现"],
          rows: [
            ["**可信可溯**", "会话事件为唯一真源，长会话可压缩、可导出、可复盘。"],
            ["**本地优先**", "密钥与会话默认落在本机 ~/.xrk，数据边界可控。"],
            ["**可组合**", "minimal / harness / server 预置只接线、不写业务，按需拼装。"],
            ["**可扩展**", "进程插件、MCP、社区客户端均可挂载，生态开放。"],
            ["**诚实边界**", "能力矩阵用「能跑 / 未稳 / 未做」三态对标，交付即注明现状。"],
          ],
        }),

        new Paragraph({ children: [new PageBreak()] }),

        // ============ 三、产品描述与功能 ============
        h1("三、产品描述与功能"),
        h2("3.1 产品形态"),
        makeTable({
          widths: [2200, 6826],
          header: ["入口", "说明"],
          rows: [
            ["**命令行**", "xrkh run：终端快速验证；xrkh plugin add 安装社区插件；xrkh doctor 体检。"],
            ["**网页**", "xrkh web / serve：浏览器完成模型与密钥配置、会话管理、工具与权限调参、插件挂载。"],
            ["**对外 CLI 包**", "@xrkseek/harness-cli（主命令 xrkh，亦 xrk-harness），npm 一键全局安装。"],
          ],
        }),
        h2("3.2 核心能力矩阵"),
        makeTable({
          widths: [2500, 6526],
          header: ["能力", "说明"],
          rows: [
            ["**会话真源**", "append-only 事件日志，可重建模型可见输入；turn / loop 短命。"],
            ["**工具流水线**", "pre → guards → execute → post → finalize → settle；无全局代理，链路清晰。"],
            ["**投影与压缩**", "状态/视图分离；长会话换窗压缩，壳上可见 token 与上下文压力。"],
            ["**多厂商模型**", "LLM Registry（openai-chat / anthropic-messages / openai-responses / gemini）。"],
            ["**权限与政策**", "只读、工作区写、完全访问三级预设；shell 等按策略放行。"],
            ["**MCP 支持**", "stdio / streamable-http；在设置中配置并热挂载。"],
            ["**可组合预置**", "minimal / harness / server 三种接线，只做组合不写业务逻辑。"],
            ["**社区生态**", "npm 社区包一键安装；自研 Host 兼容容器接入。"],
            ["**产品壳**", "Conversation、附件、子代理、@file/@session 引用、Session 日志导出。"],
          ],
        }),
        h2("3.3 典型使用流程"),
        num("全局安装 CLI：npm install -g @xrkseek/harness-cli；"),
        num("在任意工作目录启动：xrkh web（默认 harness 预置）；"),
        num("进入设置 → 模型 / 凭据，配置模型与密钥；"),
        num("按需安装插件：xrkh plugin add <包名>；"),
        num("在会话中委派任务，长任务可用 todo 维护计划，必要时 /compact 换窗压缩；"),
        num("查看工具卡片、审批、提问与 Session 日志，掌控执行全过程。"),

        new Paragraph({ children: [new PageBreak()] }),

        // ============ 四、目标用户与市场 ============
        h1("四、目标用户与市场"),
        h2("4.1 用户画像"),
        makeTable({
          widths: [2400, 6626],
          header: ["用户类型", "典型需求"],
          rows: [
            ["**独立开发者 / 极客**", "低成本部署自有智能体，掌控模型与数据。"],
            ["**研究与学习者**", "可复盘的会话、可压缩的长上下文，便于实验与教学。"],
            ["**知识工作者**", "把重复性工作交给智能体，专注判断与决策。"],
            ["**小团队 / 私有化**", "数据不出内网，按需扩展工具与插件。"],
          ],
        }),
        h2("4.2 应用场景"),
        bullet("个人助理：聚合多个模型与工具，辅助写作、检索、总结；"),
        bullet("研究实验台：多厂商模型对比、会话溯源、能力边界验证；"),
        bullet("知识工作台：@file / @session 引用，跨会话 prepare，沉淀专属工作流；"),
        bullet("企业内部工具：私有化部署，策略内控，敏感数据不出内网。"),
        h2("4.3 市场空间"),
        para("全球 Agent 框架与工作流平台持续升温，开源方案与平台化方案并行发展。个人开发者与小型团队对「自主可控、可组合、本地优先」的运行时存在真实且持续增长的需求。相比绑定单一模型或单一厂商的云端平台，本项目的差异化在于开源、厂商中立、数据本地化与诚实的能力披露。"),

        new Paragraph({ children: [new PageBreak()] }),

        // ============ 五、竞争对手分析 ============
        h1("五、竞争对手分析"),
        h2("5.1 竞品格局"),
        para("当前主要竞争者可分为三类：框架类（如 OpenAI Agents SDK、LangGraph、AutoGen、CrewAI）、工作流平台类（如 Dify、Coze、n8n、RAGFlow）、终端智能体类（如 Claude Code、Cursor）。它们各有侧重：框架强调底层编排，平台强调低门槛可视化，终端智能体强调即开即用。"),
        h2("5.2 对比矩阵"),
        makeTable({
          widths: [2600, 6426],
          header: ["方案", "特点 / 局限"],
          rows: [
            ["**OpenAI Agents SDK**", "上手快，但主要面向 OpenAI 模型，多厂商与本地优先较弱。"],
            ["**LangGraph**", "以状态图建模 workflow，功能强、学习曲线较陡；偏 Python 生态。"],
            ["**AutoGen / CrewAI**", "多智能体协作范式成熟；部分方案更适合研究/原型，生产成熟度不一。"],
            ["**Dify / Coze / n8n**", "低门槛可视化平台；适合业务人员，但常绑定平台、数据与厂商。"],
            ["**Claude Code / Cursor**", "终端/IDE 智能体，体验佳；深度绑定具体厂商与模型。"],
          ],
        }),
        h2("5.3 差异化优势"),
        bullet("TypeScript 原生 + Node ≥ 26：面向现代前端/Node 开发者，工具链一致；"),
        bullet("会话真源 + 事件溯源：对话可重建、可压缩、可导出，可追溯性突出；"),
        bullet("厂商中立的多模型 Registry：openai / anthropic / gemini 等多协议接入；"),
        bullet("本地优先与隐私：默认本机落盘，数据边界可控，契合私有化诉求；"),
        bullet("诚实能力边界：以「能跑 / 未稳 / 未做」三态标注，交付与预期一致；"),
        bullet("可组合 + 可扩展：预置只接线，插件、MCP、社区客户端皆可挂载。"),

        new Paragraph({ children: [new PageBreak()] }),

        // ============ 六、技术架构与创新点 ============
        h1("六、技术架构与创新点"),
        h2("6.1 总体架构"),
        para("项目采用 Monorepo 结构：应用层（apps）聚焦 CLI 与产品壳；包层（packages）沉淀会话、工具、模型、执行、工作区与策略等内核能力；预置层（presets）只做组合接线；扩展层（extensions）承载进程插件。整体分层清晰、依赖单向。"),
        makeTable({
          widths: [2600, 6426],
          header: ["层级", "职责"],
          rows: [
            ["**apps**", "cli（命令入口）、web（产品壳）、console（验证台）。"],
            ["**packages**", "core、session、protocol、llm、mcp、exec、workspace、policy 等内核能力。"],
            ["**presets**", "minimal / harness / server：只组合接线，不含业务逻辑。"],
            ["**extensions**", "进程插件：tools、prompt、commands、policy、llm 等，按需挂载。"],
          ],
        }),
        h2("6.2 关键技术点"),
        bullet("会话事件为真源：模型可见输入可由事件日志重建，turn / loop 短命；"),
        bullet("工具流水线：pre → guards → execute → post → finalize → settle，链路明确、可审计；"),
        bullet("投影与压缩：状态/视图分离，长上下文换窗压缩并展示 token 与上下文压力；"),
        bullet("多模型 Registry：多协议适配，厂商中立；"),
        bullet("权限三级预设 + 策略：只读、工作区写、完全访问，shell 等按策略放行；"),
        bullet("Host + Face：HTTP、Unary RPC、双 WebSocket，浏览器产品壳随 CLI 提供；"),
        bullet("MCP 与社区生态：stdio / streamable-http 热挂载，插件易装易卸；"),
        bullet("Web 端到端：Playwright 用例覆盖产品壳主路径。"),
        h2("6.3 创新点"),
        num("以会话事件为唯一真源，重塑「对话即数据」的可信模型，兼顾可追溯与长上下文；"),
        num("可组合预置 + 插件体系，把「接线」与「业务」解耦，降低上手与维护成本；"),
        num("厂商中立的多模型 Registry，避免单一厂商锁定；"),
        num("本地优先 + 三级权限策略，兼顾自主可控与安全；"),
        num("以「能跑 / 未稳 / 未做」三态公开能力边界，建立用户信任。"),

        new Paragraph({ children: [new PageBreak()] }),

        // ============ 七、商业模式与发展规划 ============
        h1("七、商业模式与发展规划"),
        h2("7.1 商业模式"),
        makeTable({
          widths: [2400, 6626],
          header: ["方面", "规划"],
          rows: [
            ["**核心开源**", "以 MIT License 开源运行时与核心能力，面向个人与开发者免费使用。"],
            ["**社区生态**", "开放插件与社区客户端接入，形成可扩展的工具生态。"],
            ["**增值方向（远期）**", "面向团队的私有化部署、托管服务、专业支持与定制化扩展。"],
          ],
        }),
        h2("7.2 当前进展"),
        para("项目主流路径已进入「能跑」状态：内核（Session、Agent、工具、HTTP、Host Face、MCP）可用；多厂商 LLM Registry 可用；社区客户端经自研兼容容器接入；产品网页与浏览器端到端测试（Playwright）覆盖主路径；对外 CLI 包 @xrkseek/harness-cli 已发布至 v0.1.21。"),
        h2("7.3 实施规划"),
        makeTable({
          widths: [1900, 4626, 2500],
          header: ["阶段", "重点", "目标"],
          rows: [
            ["**阶段一 · 夯实**", "内核稳定、会话持久化、产品壳主路径、端到端测试。", "形成可稳定运行的 v0.1.x 公开发行线。"],
            ["**阶段二 · 生态**", "插件市场、MCP 热挂载、社区客户端兼容、调用链增强。", "开放可扩展，社区可共建。"],
            ["**阶段三 · 场景**", "知识工作台、研究助手、多厂商模型对照、权限策略深化。", "围绕真实场景沉淀工作流。"],
            ["**阶段四 · 服务**", "团队私有化部署、托管服务、专业支持。", "形成可持续的商业闭环。"],
          ],
        }),
        h2("7.4 近期里程碑"),
        bullet("稳定 v0.1.x 发布线，持续完善文档与能力矩阵；"),
        bullet("开放插件与社区接入，沉淀真实应用案例；"),
        bullet("深化安全与权限策略，面向私有化场景打磨；"),
        bullet("建立用户反馈闭环，以诚实边界与可追溯赢得信任。"),

        new Paragraph({ children: [new PageBreak()] }),

        // ============ 八、团队组成 ============
        h1("八、团队组成"),
        para("（下表为团队组成建议模板，请根据实际成员填写：姓名、院校/单位、专业、分工、职责。）"),
        makeTable({
          widths: [1800, 2400, 2400, 2426],
          header: ["成员", "院校 / 单位", "专业 / 方向", "分工与职责"],
          rows: [
            ["（姓名）", "（院校）", "（专业）", "项目负责人 · 架构与核心开发"],
            ["（姓名）", "（院校）", "（专业）", "产品与前端（产品壳 / 交互）"],
            ["（姓名）", "（院校）", "（专业）", "模型接入与算法 / 测试"],
            ["（姓名）", "（院校）", "（专业）", "社区与运营 / 文档"],
          ],
        }),
        h2("8.1 团队优势"),
        bullet("全栈 TypeScript 能力，覆盖内核、产品壳与社区接入；"),
        bullet("清晰的分层架构与文档沉淀，便于协作与可持续维护；"),
        bullet("开源与社区导向，注重能力边界与用户信任。"),

        new Paragraph({ children: [new PageBreak()] }),

        // ============ 九、风险分析与对策 ============
        h1("九、风险分析与对策"),
        makeTable({
          widths: [2600, 6426],
          header: ["风险类型", "风险描述与应对思路"],
          rows: [
            ["**技术风险**", "大模型与框架迭代快。对策：厂商中立 Registry，抽象适配层，降低耦合；以测试保障主路径稳定。"],
            ["**市场风险**", "竞品众多、同质化。对策：聚焦「本地优先 + 会话真源 + 诚实边界」差异化，深耕个人与私有化场景。"],
            ["**安全与隐私**", "智能体执行侧风险。对策：三级权限预设 + 策略放行，敏感数据默认本机；披露能力边界与安全清单。"],
            ["**商业化风险**", "开源项目盈利路径待验证。对策：先以开源聚生态与口碑，再谨慎推进团队私有化与托管服务。"],
          ],
        }),
        h2("9.1 应对原则"),
        bullet("保持「能跑 / 未稳 / 未做」的诚实能力矩阵，迭代公开；"),
        bullet("以测试与全链路审计保障工程质量；"),
        bullet("优先满足个人与私有化场景的真实刚需，再谈规模化。"),

        new Paragraph({ children: [new PageBreak()] }),

        // ============ 十、结语 ============
        h1("十、结语"),
        para("XRK-Harness 以「向阳而生，笃光而行」为理念，坚持开源、本地优先、厂商中立与诚实披露，致力于让每个人都能低成本拥有属于自己的智能体。项目不追求功能的堆砌，而是把会话真源、可组合架构、诚实边界这三件事做扎实。"),
        para("我们期待与更多开发者、研究者一起，把这套运行时打磨成可信、可扩展、可长期使用的个人智能体基座。"),

        new Paragraph({ children: [new PageBreak()] }),

        // ============ 附录：项目信息一览 ============
        h1("附录：项目信息一览"),
        makeTable({
          widths: [2600, 6426],
          header: ["字段", "内容"],
          rows: [
            ["**项目名称**", "XRK-Harness（XRK 智能体运行时与服务器套件）"],
            ["**所属领域**", "信息技术服务业"],
            ["**所在地区**", "辽宁省 沈阳市"],
            ["**开源协议**", "MIT License"],
            ["**技术栈**", "TypeScript · Node.js ≥ 26 · pnpm"],
            ["**对外 CLI**", "@xrkseek/harness-cli（主命令 xrkh，亦 xrk-harness）"],
            ["**当前版本**", "v0.1.21"],
            ["**填报日期**", "2026 年 8 月 26 日"],
            ["**核心定位**", "开源、本地优先、厂商中立的个人智能体运行时与服务器套件"],
            ["**官方网站**", "https://github.com/xrkseek/XRK-harness"],
          ],
        }),
        para("注：以上版本、能力、竞品与规划信息基于项目文档与公开资料整理。行业背景与痛点数据均取自可回溯的公开权威来源：Grand View Research（AI Agents Market Report，2025-05-06）、MIT NANDA（《The GenAI Divide: State of AI in Business 2025》）、Gartner（2025-06-25 预测）、Liu 等（《Lost in the Middle》，TACL 2024）。图表中标注「估算」「示意」的数值，为基于上述来源的推导或示意，非原文原始刻度。其余未经核实、来源为转述性博客的数据一律未采用。填报时如需调整，可在 Word 中直接修改。", { size: 18, color: GREY }),
      ],
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log("written:", OUT, buf.length, "bytes");
});
