"""Draws the evaluation charts from the saved experiment results.

Reads test/experiments/results/*.json (written by the experiment scripts) and
writes three PNGs to public/images/. Nothing is typed in by hand: re-run the
experiments, re-run this, and the charts change with the data.

Run:  python3 test/experiments/make-charts.py
"""
import json
import pathlib

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

HERE = pathlib.Path(__file__).resolve().parent
RESULTS = HERE / "results"
OUT = HERE.parent.parent / "public" / "images"
OUT.mkdir(parents=True, exist_ok=True)

INK, MUTED, GREEN, RED, BLUE = "#1a1a1a", "#666666", "#0b8f63", "#c0392b", "#2c6fbb"
plt.rcParams.update({
    "font.family": "DejaVu Sans", "font.size": 10, "axes.edgecolor": MUTED, "axes.labelcolor": INK,
    "xtick.color": INK, "ytick.color": INK, "axes.spines.top": False, "axes.spines.right": False,
})

lat = json.loads((RESULTS / "latency.json").read_text())
fan = json.loads((RESULTS / "fanout-scale.json").read_text())

# ---------------------------------------------------------------- chart 1: push vs polling
push = lat["H1a"]["totalMs"]
poll = lat["H1b"]["pollingMs"]
fig, ax = plt.subplots(figsize=(8.2, 3.3))
for y, vals, colour in [(1, push, GREEN), (0, poll, RED)]:
    ax.scatter(vals, [y] * len(vals), s=52, color=colour, alpha=0.8, zorder=3, edgecolor="white", linewidth=0.6)
    med = sorted(vals)[len(vals) // 2]
    ax.plot([med, med], [y - 0.28, y + 0.28], color=INK, linewidth=2.2, zorder=4)
    label = f"median {med / 1000:.2f} s" if med >= 1000 else f"median {med} ms"
    ax.annotate(label, (med, y + 0.3), ha="center", fontsize=9, color=INK)
for x, text in [(100, "0.1 s\nfeels instant"), (1000, "1 s\nflow of thought\nstays unbroken"), (10000, "10 s\nattention\nlimit")]:
    ax.axvline(x, color=MUTED, linestyle="--", linewidth=0.9, zorder=1)
    ax.text(x * 1.06, -0.62, text, fontsize=7.6, color=MUTED, va="bottom")
ax.set_xscale("log")
ax.set_xlim(80, 30000)
ax.set_ylim(-0.75, 1.65)
ax.set_yticks([0, 1])
ax.set_yticklabels([f"Page polling every 20 s\n(n={len(poll)})", f"Web Push\n(n={len(push)})"])
ax.set_xlabel("Time from the news being released to it appearing (milliseconds, log scale)")
ax.set_title("Push reaches the user inside Nielsen's 1-second limit; polling does not", fontsize=10.5, color=INK, loc="left")
fig.tight_layout()
fig.savefig(OUT / "eval-latency.png", dpi=170)
plt.close(fig)

# ---------------------------------------------------------------- chart 2: scale with and without indexes
def series(with_idx):
    rows = [r for r in fan["rows"] if r["withIndexes"] == with_idx and r["fraction"] == 1]
    rows.sort(key=lambda r: r["n"])
    return [r["n"] for r in rows], [r["deliverMs"] for r in rows]

fig, ax = plt.subplots(figsize=(8.2, 3.5))
xn, yn = series(False)
xy, yy = series(True)
ax.plot(xn, yn, marker="o", color=RED, linewidth=2, label="without indexes (quadratic)")
ax.plot(xy, yy, marker="o", color=GREEN, linewidth=2, label="with indexes (roughly linear)")
ax.annotate(f"{yn[-1] / 1000:.0f} s", (xn[-1], yn[-1]), textcoords="offset points", xytext=(-8, 8), ha="right", color=RED, fontsize=9)
ax.annotate(f"{yy[-1] / 1000:.2f} s", (xy[-1], yy[-1]), textcoords="offset points", xytext=(-8, -16), ha="right", color=GREEN, fontsize=9)
ax.set_xscale("log")
ax.set_yscale("log")
ax.set_xticks([1000, 10000, 50000])
ax.set_xticklabels(["1,000", "10,000", "50,000"])
ax.set_xlabel("Users holding the stock, all with alerts on (log scale)")
ax.set_ylabel("Delivery job time (ms, log scale)")
ax.set_title("Two missing indexes made the delivery job quadratic: 51 s became 0.45 s", fontsize=10.5, color=INK, loc="left")
ax.legend(frameon=False, loc="upper left", fontsize=9)
fig.tight_layout()
fig.savefig(OUT / "eval-scale.png", dpi=170)
plt.close(fig)

# ---------------------------------------------------------------- chart 3: plan parity
free, std, gap = lat["H8"]["freeMs"], lat["H8"]["standardMs"], lat["H8"]["gapMs"]
trials = list(range(1, len(free) + 1))
fig, ax = plt.subplots(figsize=(8.2, 3.2))
for t, f, s in zip(trials, free, std):
    ax.plot([t, t], [f, s], color=MUTED, linewidth=1, zorder=1)
ax.scatter(trials, free, color=BLUE, s=60, label="Free plan (Alex)", zorder=3, edgecolor="white")
ax.scatter(trials, std, color=GREEN, s=60, marker="s", label="Standard plan (Sam)", zorder=3, edgecolor="white")
ax.set_xticks(trials)
ax.set_xlabel("Trial (two separate real Chrome browsers, same news item, same moment)")
ax.set_ylabel("Arrival after release (ms)")
ax.set_ylim(0, 1000)
ax.axhline(1000, color=MUTED, linestyle="--", linewidth=0.9)
ax.set_title(f"Both plans were told together: worst gap {max(gap)} ms. Only the detail they can read differs", fontsize=10.5, color=INK, loc="left")
ax.legend(frameon=False, loc="upper right", fontsize=9, ncol=2)
fig.tight_layout()
fig.savefig(OUT / "eval-parity.png", dpi=170)
plt.close(fig)
print("wrote", ", ".join(p.name for p in sorted(OUT.glob("eval-*.png"))))
