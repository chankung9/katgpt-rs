# LLM Pipeline Interactive Demo

A self-contained static educational webpage explaining how a standard LLM
pipeline works and how the **katgpt-rs** hybrid pipeline achieves higher
throughput.

## How to open

No build step required. Open `index.html` directly in any modern browser:

```bash
# From the repository root:
open docs/llm-pipeline-demo/index.html

# Or serve locally (optional, for any browser security policies):
python3 -m http.server 8080 --directory docs/llm-pipeline-demo
# then visit http://localhost:8080
```

## Contents

| File | Purpose |
|------|---------|
| `index.html` | Main page — all sections, markup, glossary |
| `styles.css`  | Dark-theme styles, pipeline diagrams, animations |
| `app.js`      | Interactive sliders, real-time metrics, step animations, DDTree SVG, Sudoku demo |

## Sections

1. **Standard LLM Pipeline** — tokenization → prefill → autoregressive decode
2. **katgpt-rs Hybrid Pipeline** — PFlash → DFlash draft → ConstraintPruner → DDTree → LeviathanVerifier → commit
3. **Side-by-Side Comparison** — feature table
4. **Interactive Simulation** — 8 sliders + 8 derived metrics (tok/s, latency, pruned branches…)
5. **Animated Walkthrough** — step-by-step log animation of both pipelines
6. **DDTree Visualization** — animated SVG of the candidate token tree being built and verified
7. **Games & Puzzles** — how the same architecture applies to game AI (Bomber, Sudoku)
8. **Glossary** — plain-English definitions of every LLM/katgpt-rs term

## Notes

- This is an **educational simulation**, not a strict benchmark.
- Metric formulas use the Leviathan et al. 2022 expected-acceptance formula.
- Performance numbers (29× TTFT, 21× seq reduction, 93.8% KV reduction) are
  taken directly from the [README](../../README.md) and
  [speculative decoding docs](../../.docs/03_speculative_decoding.md).
- Animations are manual-only: token flow, walkthroughs, DDTree, and Sudoku stay idle until the user clicks a control.
- The page works on desktop widths; minimum comfortable width is ~900 px.
