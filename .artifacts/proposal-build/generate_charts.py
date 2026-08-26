import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib import font_manager
import os

for cand in ["Microsoft YaHei", "SimHei", "Microsoft JhengHei", "SimSun"]:
    try:
        font_manager.findfont(cand, fallback_to_default=False)
        plt.rcParams["font.sans-serif"] = [cand, "DejaVu Sans"]
        break
    except Exception:
        continue
plt.rcParams["axes.unicode_minus"] = False
plt.rcParams["font.family"] = "sans-serif"

INK = "#232321"; GOLD = "#B0803C"; BROWN = "#7A5A34"
CREAM = "#F6F1E8"; GREY = "#6B655C"; LGREY = "#C9C2B6"; GRID = "#E6E0D5"

OUT = "charts"
os.makedirs(OUT, exist_ok=True)

def clean(ax, horizontal=False):
    for s in ["top", "right", "left"]:
        ax.spines[s].set_visible(False)
    if horizontal:
        ax.spines["bottom"].set_visible(False)
        ax.spines["left"].set_color(LGREY)
        ax.grid(axis="x", color=GRID, linewidth=0.8)
    else:
        ax.spines["bottom"].set_color(LGREY)
        ax.grid(axis="y", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    ax.tick_params(colors=GREY, labelsize=9)

# ============================================================
# 图1-1  市场规模（Grand View Research，2025-05-06）
#   报告口径：2030 年达 503.1 亿美元；2025-2030 CAGR 45.8%
#   2025 基准值 = 50.31 / (1.458^5)，按 CAGR 倒推，属“推算”
# ============================================================
base = 50.31 / (1.458 ** 5)
fig, ax = plt.subplots(figsize=(7.0, 3.5), dpi=200)
labels = ["2025 年\n(≈基准)", "2030 年\n(报告目标)"]
vals = [round(base, 1), 50.31]
bars = ax.bar(labels, vals, width=0.52, color=[CREAM, GOLD], edgecolor=INK, linewidth=1.3, zorder=3)
for b, v in zip(bars, vals):
    ax.text(b.get_x() + b.get_width()/2, v + 1.2, f"{v:.1f} 亿美元",
            ha="center", va="bottom", fontsize=9, color=INK, fontweight="bold")
clean(ax)
ax.set_ylim(0, 60)
ax.set_ylabel("市场规模（亿美元）", fontsize=9, color=GREY)
ax.annotate("CAGR ≈ 45.8%", xy=(1, 50.31), xytext=(1.15, 45),
            fontsize=10, color=BROWN, fontweight="bold", arrowprops=dict(arrowstyle="->", color=GOLD))
ax.set_title("全球 AI Agent 市场规模：2025 → 2030", fontsize=11, color=INK, fontweight="bold", loc="left", pad=10)
fig.tight_layout()
fig.savefig(f"{OUT}/market-growth.png", dpi=200, bbox_inches="tight", facecolor="white")
plt.close(fig)

# ============================================================
# 图1-2  智能体试点 → 生产失败率（MIT NANDA, "The GenAI Divide", 2025）
#   “95% 的企业生成式 AI 试点未实现财务回报；仅 5% 提取到价值”
# ============================================================
fig, ax = plt.subplots(figsize=(4.6, 4.1), dpi=200)
sizes = [5, 95]
cols = [GOLD, "#D9D2C4"]
w, _ = ax.pie(sizes, startangle=90, colors=cols, counterclock=False,
              wedgeprops=dict(width=0.42, edgecolor="white", linewidth=2))
ax.text(0, 0.10, "5%", ha="center", va="center", fontsize=22, color=INK, fontweight="bold")
ax.text(0, -0.22, "实现价值", ha="center", va="center", fontsize=10, color=GREY)
ax.legend(w, ["实现财务回报", "未实现财务回报"], loc="lower center", bbox_to_anchor=(0.5, -0.16),
          ncol=1, frameon=False, fontsize=9)
ax.set_title("企业生成式 AI 试点结果\n（MIT NANDA · 2025）", fontsize=10.5, color=INK, fontweight="bold", loc="left", pad=6)
fig.tight_layout()
fig.savefig(f"{OUT}/pilot-failure.png", dpi=200, bbox_inches="tight", facecolor="white")
plt.close(fig)

# ============================================================
# 图1-3  智能体项目终止率（Gartner，2025-06-25）
#   “到 2027 年底，超过 40% 的 agentic AI 项目将被取消”
# ============================================================
fig, ax = plt.subplots(figsize=(6.4, 2.6), dpi=200)
y = ["被取消的项目"]
v = [40]
bars = ax.barh(y, v, height=0.5, color=GOLD, edgecolor=INK, linewidth=1.2, zorder=3)
ax.set_xlim(0, 100)
ax.barh(y, 100, height=0.5, color=CREAM, edgecolor="none", zorder=2)
for b, val in zip(bars, v):
    ax.text(val + 1.5, b.get_y()+b.get_height()/2, f"超过 {val}%", va="center",
            fontsize=11, color=INK, fontweight="bold")
ax.set_xticks([0, 20, 40, 60, 80, 100])
ax.set_xticklabels(["0", "20%", "40%", "60%", "80%", "100%"], fontsize=8)
clean(ax, horizontal=True)
ax.set_yticks([])
ax.set_title("Gartner：到 2027 年底超 40% 的智能体项目将被取消", fontsize=10.5, color=INK,
             fontweight="bold", loc="left", pad=10)
fig.tight_layout()
fig.savefig(f"{OUT}/cancellation.png", dpi=200, bbox_inches="tight", facecolor="white")
plt.close(fig)

# ============================================================
# 图1-4  企业软件智能体渗透率（Gartner，2025-06-25）
#   “2028 年 33% 的企业软件将包含 agentic AI，2024 年不足 1%”
# ============================================================
fig, ax = plt.subplots(figsize=(7.0, 3.3), dpi=200)
labs = ["2024 年", "2028 年（预测）"]
vals = [0.99, 33.0]
bars = ax.bar(labs, vals, width=0.5, color=[CREAM, GOLD], edgecolor=INK, linewidth=1.3, zorder=3)
ax.text(0, 0.99 + 1.0, "< 1%", ha="center", va="bottom", fontsize=9, color=INK, fontweight="bold")
ax.text(1, 33.0 + 1.0, "33%", ha="center", va="bottom", fontsize=10, color=INK, fontweight="bold")
clean(ax)
ax.set_ylim(0, 40)
ax.set_ylabel("包含智能体的企业软件占比（%）", fontsize=9, color=GREY)
ax.set_title("企业软件中的智能体（agentic AI）渗透率", fontsize=11, color=INK, fontweight="bold", loc="left", pad=10)
fig.tight_layout()
fig.savefig(f"{OUT}/adoption.png", dpi=200, bbox_inches="tight", facecolor="white")
plt.close(fig)

# ============================================================
# 图1-5  长上下文“中间迷失”（Liu et al., TACL 2024）
#   论文原句：信息位于上下文中间时性能“可下降超过 20%”（UGPT-3.5-Turbo 多文档问答）
# ============================================================
fig, ax = plt.subplots(figsize=(6.4, 3.0), dpi=200)
labels = ["相关信息位于\n上下文开头/结尾", "相关信息位于\n上下文中间"]
vals = [100, 78]  # 简化为相对可用性示意；数值区间以论文“>20%下降”为准
bars = ax.bar(labels, vals, width=0.5, color=[GOLD, "#C9A76B"], edgecolor=INK, linewidth=1.2, zorder=3)
ax.text(1, 78 + 1.5, "下降 > 20%", ha="center", va="bottom", fontsize=10, color=INK, fontweight="bold")
clean(ax)
ax.set_ylim(0, 108)
ax.set_yticks([0, 20, 40, 60, 80, 100])
ax.set_yticklabels(["0", "20%", "40%", "60%", "80%", "100%"], fontsize=8)
ax.set_title("“中间迷失” Long-context：信息位置对可用性的影响", fontsize=10.5, color=INK,
             fontweight="bold", loc="left", pad=10)
fig.tight_layout()
fig.savefig(f"{OUT}/lost-middle.png", dpi=200, bbox_inches="tight", facecolor="white")
plt.close(fig)

print("base 2025 derived:", round(base, 1), "亿美元")
print("charts written:")
for f in sorted(os.listdir(OUT)):
    print(" -", f, os.path.getsize(os.path.join(OUT, f)), "bytes")
