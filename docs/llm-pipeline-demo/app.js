/* =========================================================
   KatGPT-RS — LLM Pipeline Educational Demo
   app.js
   ========================================================= */

'use strict';

// -------------------------------------------------------
// Configuration constants
// -------------------------------------------------------
/** Vocabulary size of the katgpt-rs micro-model (a–z + BOS = 27). */
const MICRO_VOCAB_SIZE = 27;

function createTimerGroup() {
  const entries = new Set();

  function remove(entry) {
    entries.delete(entry);
  }

  return {
    set(callback, ms) {
      const entry = { id: null, resolve: null };
      entry.id = window.setTimeout(() => {
        remove(entry);
        callback();
      }, ms);
      entries.add(entry);
      return entry.id;
    },
    sleep(ms) {
      return new Promise(resolve => {
        const entry = { id: null, resolve };
        entry.id = window.setTimeout(() => {
          remove(entry);
          resolve(true);
        }, ms);
        entries.add(entry);
      });
    },
    cancelAll() {
      entries.forEach(entry => {
        window.clearTimeout(entry.id);
        if (entry.resolve) entry.resolve(false);
      });
      entries.clear();
    },
  };
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}


// -------------------------------------------------------
(function () {
  const links = document.querySelectorAll('.toc-inner a');
  const sections = Array.from(links)
    .map(a => document.querySelector(a.getAttribute('href')))
    .filter(Boolean);

  function onScroll() {
    let current = sections[0];
    for (const s of sections) {
      if (window.scrollY + 120 >= s.offsetTop) current = s;
    }
    links.forEach(a => {
      a.classList.toggle(
        'active',
        a.getAttribute('href') === '#' + current.id
      );
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

// -------------------------------------------------------
// Token stream animation on the pipeline rows
// -------------------------------------------------------
(function () {
  const SAMPLES = {
    std: [
      ['The', 'std'], [' quick', 'std'], [' brown', 'std'],
      [' fox', 'std'], [' jumps', 'std'], [' over', 'std'],
      [' the', 'std'], [' lazy', 'std'], [' dog', 'std'],
      ['.', 'std'],
    ],
    kat: [
      [' quick', 'draft'], [' lazy', 'draft'], [' fox', 'draft'],
      ['✂ jumped?', 'prune'], ['✂ runs?', 'prune'],
      [' jumps', 'verify'], [' over', 'verify'], [' the', 'verify'],
      [' dog', 'commit'], [' !', 'commit'],
    ],
  };

  const timers = createTimerGroup();
  const statusEl = document.getElementById('token-flow-status');
  const tracks = [
    { id: 'token-track-std', tokens: SAMPLES.std, interval: 360 },
    { id: 'token-track-kat', tokens: SAMPLES.kat, interval: 280 },
  ];
  let running = false;
  let completed = 0;

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function clearTracks() {
    tracks.forEach(({ id }) => {
      const track = document.getElementById(id);
      if (track) track.innerHTML = '';
    });
  }

  function finishTrack() {
    completed += 1;
    if (completed === tracks.length) {
      running = false;
      setStatus('Done — press Play token flow to run the manual animation again.');
    }
  }

  function stepTrack(trackEl, tokens, interval, index) {
    if (!running || !trackEl) return;
    if (index >= tokens.length) {
      finishTrack();
      return;
    }

    const [text, cls] = tokens[index];
    const span = document.createElement('span');
    span.className = 'tok ' + cls;
    span.textContent = text;
    trackEl.appendChild(span);

    while (trackEl.children.length > 6) {
      const first = trackEl.firstChild;
      first.style.transition = 'opacity .2s';
      first.style.opacity = '0';
      timers.set(() => first.remove(), 180);
    }

    timers.set(() => stepTrack(trackEl, tokens, interval, index + 1), interval);
  }

  function playStreams() {
    if (running) return;
    timers.cancelAll();
    clearTracks();
    running = true;
    completed = 0;
    setStatus('Running token flow…');

    tracks.forEach(({ id, tokens, interval }) => {
      stepTrack(document.getElementById(id), tokens, interval, 0);
    });
  }

  function stopStreams(message = 'Stopped — press Play token flow to resume from the beginning.') {
    timers.cancelAll();
    running = false;
    setStatus(message);
  }

  function resetStreams() {
    stopStreams('Idle — token streams run only when you press Play.');
    clearTracks();
  }

  resetStreams();

  document.getElementById('btn-play-flows')?.addEventListener('click', playStreams);
  document.getElementById('btn-stop-flows')?.addEventListener('click', () => stopStreams());
  document.getElementById('btn-reset-flows')?.addEventListener('click', resetStreams);
})();

// -------------------------------------------------------
// Interactive sliders + live metric calculation
// -------------------------------------------------------
(function () {
  const sliders = {
    prompt: document.getElementById('sl-prompt'),
    output: document.getElementById('sl-output'),
    gamma:  document.getElementById('sl-gamma'),
    alpha:  document.getElementById('sl-alpha'),
    prune:  document.getElementById('sl-prune'),
    comp:   document.getElementById('sl-comp'),
    vlat:   document.getElementById('sl-vlat'),
    dlat:   document.getElementById('sl-dlat'),
  };
  const labels = {
    prompt: document.getElementById('lbl-prompt'),
    output: document.getElementById('lbl-output'),
    gamma:  document.getElementById('lbl-gamma'),
    alpha:  document.getElementById('lbl-alpha'),
    prune:  document.getElementById('lbl-prune'),
    comp:   document.getElementById('lbl-comp'),
    vlat:   document.getElementById('lbl-vlat'),
    dlat:   document.getElementById('lbl-dlat'),
  };

  function val(k) { return parseFloat(sliders[k].value); }

  /**
   * Expected accepted tokens per round with speculative decoding.
   * Derived from Leviathan et al. 2022 (Algorithm 1):
   *   - At each depth k (1…γ), a token is accepted with probability α^k.
   *   - On full acceptance of all γ tokens, a bonus token is sampled (always accepted).
   *   - Therefore E[#tokens] = Σ_{k=1}^{γ} α^k  +  α^γ  = (1 - α^(γ+1)) / (1 - α)
   *
   * The +1 from the bonus token is captured by the exponent going to (γ+1) in the
   * geometric series, giving the closed form below.
   */
  function expectedAccepted(alpha, gamma) {
    if (alpha >= 1.0) return gamma + 1;
    // Correct Leviathan formula:
    // E[#accepted] = (1 - α^(γ+1)) / (1 - α)
    return (1 - Math.pow(alpha, gamma + 1)) / (1 - alpha);
  }

  function prefillMs(promptLen, comp, vlat) {
    // Prefill cost proportional to prompt/comp, base unit = vlat
    return (promptLen / comp) * vlat * 0.3;
  }

  function updateMetrics() {
    const P    = val('prompt');
    const N    = val('output');
    const gamma= val('gamma');
    const alpha= val('alpha');
    const rho  = val('prune');
    const comp = val('comp');
    const vlat = val('vlat');  // ms per verifier pass
    const dlat = val('dlat');  // ms per draft step

    // Update labels
    labels.prompt.textContent = P;
    labels.output.textContent = N;
    labels.gamma.textContent  = gamma;
    labels.alpha.textContent  = alpha.toFixed(2);
    labels.prune.textContent  = rho.toFixed(2);
    labels.comp.textContent   = comp;
    labels.vlat.textContent   = vlat.toFixed(1);
    labels.dlat.textContent   = dlat.toFixed(1);

    // ---- katgpt-rs metrics ----
    const tpr    = expectedAccepted(alpha, gamma);  // tokens per round
    const rounds = Math.ceil(N / tpr);
    // Time per round: draft γ steps + one verifier pass
    const roundMs    = gamma * dlat + vlat;
    const prefillKat = prefillMs(P, comp, vlat);
    const totalKatMs = prefillKat + rounds * roundMs;
    const tpsKat     = (N / totalKatMs) * 1000;

    // ---- standard LLM metrics ----
    const prefillStd = prefillMs(P, 1, vlat);
    const totalStdMs = prefillStd + N * (dlat + vlat);
    const tpsStd     = (N / totalStdMs) * 1000;

    // ---- speedup ----
    const speedup = tpsKat / tpsStd;

    // ---- pruning ----
    const prunedBranches = Math.round(gamma * MICRO_VOCAB_SIZE * rho);
    const computeSaved   = (rho * 100).toFixed(0);

    // Update DOM
    setText('m-tpr',    tpr.toFixed(2) + ' tok');
    setText('m-rounds', rounds.toLocaleString());
    setText('m-tps-kat', Math.round(tpsKat).toLocaleString() + ' tok/s');
    setText('m-tps-std', Math.round(tpsStd).toLocaleString() + ' tok/s');
    setText('m-speedup', speedup.toFixed(1) + '×');
    setText('m-lat-kat', Math.round(totalKatMs).toLocaleString() + ' ms');
    setText('m-lat-std', Math.round(totalStdMs).toLocaleString() + ' ms');
    setText('m-pruned', prunedBranches + ' nodes (' + computeSaved + '% saved)');

    // Progress bars (latency comparison)
    const maxLat = Math.max(totalKatMs, totalStdMs);
    const barKatPct = ((totalKatMs / maxLat) * 100).toFixed(1);
    const barStdPct = '100';
    const barKat = document.getElementById('bar-kat');
    const barStd = document.getElementById('bar-std');
    if (barKat) barKat.style.width = barKatPct + '%';
    if (barStd) barStd.style.width = barStdPct + '%';
    setText('bar-kat-label', Math.round(totalKatMs).toLocaleString() + ' ms');
    setText('bar-std-label', Math.round(totalStdMs).toLocaleString() + ' ms');

    // Colour the speedup
    const mspeedup = document.getElementById('m-speedup');
    if (mspeedup) {
      mspeedup.style.color = speedup >= 2 ? 'var(--green)' :
                             speedup >= 1 ? 'var(--orange)' : 'var(--red)';
    }
  }

  function setText(id, txt) {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  }

  Object.values(sliders).forEach(sl => sl && sl.addEventListener('input', updateMetrics));
  updateMetrics();
})();

// -------------------------------------------------------
// Animated walkthrough
// -------------------------------------------------------
(function () {
  const log = document.getElementById('anim-log');
  const speedSel = document.getElementById('anim-speed');
  const timers = createTimerGroup();
  let running = false;

  function speed() { return parseInt(speedSel ? speedSel.value : '200', 10); }

  function appendLog(html) {
    const line = document.createElement('div');
    line.innerHTML = html;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  function sleep(ms) {
    return timers.sleep(ms);
  }

  async function runStandard() {
    if (running) return;
    running = true;
    timers.cancelAll();
    log.innerHTML = '';
    const sp = speed();

    appendLog('<span class="log-info">── Standard LLM Pipeline ──────────────────</span>');
    if (!(await sleep(sp))) return;

    appendLog('<span class="log-std">① Tokenizing prompt…</span>');
    if (!(await sleep(sp))) return;
    appendLog('<span class="log-std">   "The quick brown fox" → [The][▁quick][▁brown][▁fox]</span>');
    if (!(await sleep(sp * 1.5))) return;

    appendLog('<span class="log-std">② Prefill: processing 4 prompt tokens through Transformer…</span>');
    if (!(await sleep(sp * 2))) return;
    appendLog('<span class="log-std">   KV cache built. TTFT ≈ 4 × verifier_latency ms</span>');
    if (!(await sleep(sp))) return;

    const words = ['jumps', '▁over', '▁the', '▁lazy', '▁dog', '.'];
    for (let i = 0; i < words.length; i++) {
      appendLog(`<span class="log-std">③ Forward pass ${i + 1} → logits → sample → </span><span class="log-commit">[${words[i]}]</span>`);
      if (!(await sleep(sp))) return;
    }

    appendLog('<span class="log-info">   Committed 6 tokens in 6 forward passes.</span>');
    appendLog('<span class="log-std">Done ✓</span>');
    running = false;
  }

  async function runKatgpt() {
    if (running) return;
    running = true;
    timers.cancelAll();
    log.innerHTML = '';
    const sp = speed();

    const gamma = parseInt(document.getElementById('sl-gamma')?.value || '4', 10);
    const alpha = parseFloat(document.getElementById('sl-alpha')?.value || '0.75');
    const rho = parseFloat(document.getElementById('sl-prune')?.value || '0.60');

    appendLog('<span class="log-info">── katgpt-rs Hybrid Pipeline ──────────────</span>');
    if (!(await sleep(sp))) return;

    appendLog('<span class="log-kat">① Tokenize + State Encode:</span>');
    if (!(await sleep(sp))) return;
    appendLog('<span class="log-kat">   "The quick brown fox" → [The][▁quick][▁brown][▁fox]</span>');
    if (!(await sleep(sp))) return;

    appendLog('<span class="log-kat">② PFlash Compressed Prefill (21× seq reduction)…</span>');
    if (!(await sleep(sp * 1.5))) return;
    appendLog('<span class="log-kat">   TTFT ≈ 4/21 × verifier_latency ms  (29× faster)</span>');
    if (!(await sleep(sp))) return;

    let totalCommitted = 0;
    let round = 1;

    while (totalCommitted < 6) {
      appendLog(`<span class="log-info">── Round ${round} ─────────────────────────────</span>`);
      if (!(await sleep(sp * 0.5))) return;

      appendLog(`<span class="log-draft">③ DFlash Draft: predict marginals for γ=${gamma} future positions…</span>`);
      if (!(await sleep(sp))) return;

      const drafts = [['▁jumps', '▁leaps', '▁runs'], ['▁over', '▁above', '▁past'], ['▁the', '▁a', '▁this']];
      for (let depth = 0; depth < drafts.length; depth++) {
        const line = drafts[depth].map((c, i) =>
          `<span class="log-draft">${c}(${(0.7 - i * 0.2).toFixed(1)})</span>`
        ).join(' | ');
        appendLog(`   Depth ${depth}: ${line}`);
        if (!(await sleep(sp * 0.7))) return;
      }

      const prunedCount = Math.round(drafts.length * drafts[0].length * rho);
      appendLog(`<span class="log-prune">④ ConstraintPruner: removed ${prunedCount} invalid candidates (${(rho * 100).toFixed(0)}% pruned)</span>`);
      if (!(await sleep(sp))) return;

      appendLog(`<span class="log-draft">⑤ DDTree: build best-first candidate tree (budget=${gamma * 3})…</span>`);
      if (!(await sleep(sp))) return;
      appendLog('   Tree nodes: [▁jumps→▁over→▁the] [▁jumps→▁above→▁a] [▁leaps→▁over→▁the]');
      if (!(await sleep(sp))) return;

      appendLog('<span class="log-verify">⑥ LeviathanVerifier: run target model over tree…</span>');
      if (!(await sleep(sp * 1.5))) return;

      let accepted = 0;
      const seq = ['▁jumps', '▁over', '▁the'];
      for (const tok of seq) {
        const u = Math.random();
        const accept = u < alpha;
        if (accept) {
          accepted += 1;
          appendLog(`   <span class="log-verify">p/q check ${tok}: U=${u.toFixed(2)} < α=${alpha.toFixed(2)} → </span><span class="log-commit">✓ ACCEPT</span>`);
        } else {
          accepted += 1;
          appendLog(`   <span class="log-verify">p/q check ${tok}: U=${u.toFixed(2)} ≥ α=${alpha.toFixed(2)} → </span><span class="log-prune">✗ REJECT → residual sample → [▁the]</span>`);
          break;
        }
        if (!(await sleep(sp * 0.6))) return;
      }

      if (accepted === seq.length) {
        accepted += 1;
        appendLog('   <span class="log-commit">Bonus token at γ: [▁lazy] → COMMIT</span>');
      }

      totalCommitted += accepted;
      appendLog(`<span class="log-commit">⑦ Commit ${accepted} token(s) this round. Total: ${totalCommitted}</span>`);
      if (!(await sleep(sp))) return;
      round += 1;
    }

    appendLog(`<span class="log-kat">Done ✓ — ${totalCommitted} tokens in ${round - 1} verifier rounds</span>`);
    running = false;
  }

  function stopAnim(message = 'Walkthrough stopped. Press a run button to start again.') {
    timers.cancelAll();
    running = false;
    if (message) log.innerHTML = `<span class="log-info">${message}</span>`;
  }

  function resetAnim() {
    stopAnim('Press ▶ Run Standard LLM or ▶ Run katgpt-rs to begin the simulation…');
  }

  document.getElementById('btn-run-std')?.addEventListener('click', runStandard);
  document.getElementById('btn-run-kat')?.addEventListener('click', runKatgpt);
  document.getElementById('btn-stop')?.addEventListener('click', () => stopAnim());
  document.getElementById('btn-reset')?.addEventListener('click', resetAnim);
})();

// -------------------------------------------------------
// DDTree SVG Visualization
// -------------------------------------------------------
(function () {
  const svg = document.getElementById('tree-svg');
  const treeLog = document.getElementById('tree-log');
  if (!svg) return;

  const NS = 'http://www.w3.org/2000/svg';
  const W = 800, H = 340;
  const timers = createTimerGroup();

  const COL = {
    default: '#4f8ef7',
    draft: '#f7d03e',
    pruned: '#f75c5c',
    accepted: '#3ecf8e',
    rejected: '#f75c5c',
    bg: '#1e2536',
    line: '#2a3350',
    text: '#e2e8f0',
  };

  const TREE_DEF = [
    { id: 0, parent: null, token: '[root]', depth: 0, prob: 1.0, x: 400, y: 30 },
    { id: 1, parent: 0, token: 'jumps', depth: 1, prob: 0.62, x: 200, y: 110 },
    { id: 2, parent: 0, token: 'leaps', depth: 1, prob: 0.31, x: 400, y: 110 },
    { id: 3, parent: 0, token: 'PRUNE', depth: 1, prob: 0.07, x: 620, y: 110, pruned: true },
    { id: 4, parent: 1, token: 'over', depth: 2, prob: 0.71, x: 100, y: 195 },
    { id: 5, parent: 1, token: 'above', depth: 2, prob: 0.29, x: 250, y: 195 },
    { id: 6, parent: 2, token: 'over', depth: 2, prob: 0.58, x: 390, y: 195 },
    { id: 7, parent: 2, token: 'PRUNE', depth: 2, prob: 0.42, x: 540, y: 195, pruned: true },
    { id: 8, parent: 4, token: 'the', depth: 3, prob: 0.85, x: 60, y: 280 },
    { id: 9, parent: 4, token: 'a', depth: 3, prob: 0.15, x: 160, y: 280 },
    { id: 10, parent: 5, token: 'the', depth: 3, prob: 0.78, x: 260, y: 280 },
    { id: 11, parent: 6, token: 'the', depth: 3, prob: 0.88, x: 370, y: 280 },
    { id: 12, parent: 6, token: 'a', depth: 3, prob: 0.12, x: 450, y: 280 },
  ];

  let nodes = [];
  let phase = 'empty';
  let running = false;

  function clear() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('width', W);
    rect.setAttribute('height', H);
    rect.setAttribute('fill', COL.bg);
    rect.setAttribute('rx', 8);
    svg.appendChild(rect);
  }

  function drawIdleState() {
    clear();
    const text = document.createElementNS(NS, 'text');
    text.setAttribute('x', W / 2);
    text.setAttribute('y', H / 2 - 10);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('fill', '#8892a4');
    text.setAttribute('font-size', '16');
    text.textContent = 'Tree visualization is idle.';
    const sub = document.createElementNS(NS, 'text');
    sub.setAttribute('x', W / 2);
    sub.setAttribute('y', H / 2 + 18);
    sub.setAttribute('text-anchor', 'middle');
    sub.setAttribute('fill', '#8892a4');
    sub.setAttribute('font-size', '12');
    sub.textContent = 'Click Build Demo Tree to render the candidate tree.';
    svg.appendChild(text);
    svg.appendChild(sub);
    if (treeLog) treeLog.textContent = 'Idle — click Build Demo Tree to start.';
  }

  function makeNode(nd) {
    const g = document.createElementNS(NS, 'g');
    const r = nd.depth === 0 ? 18 : 22;
    const circle = document.createElementNS(NS, 'circle');
    circle.setAttribute('cx', nd.x);
    circle.setAttribute('cy', nd.y);
    circle.setAttribute('r', r);

    let fill = 'transparent';
    let stroke = COL.default;
    if (nd.pruned) { stroke = COL.pruned; fill = 'rgba(247,92,92,.12)'; }
    else if (nd.state === 'accepted') { stroke = COL.accepted; fill = 'rgba(62,207,142,.18)'; }
    else if (nd.state === 'rejected') { stroke = COL.rejected; fill = 'rgba(247,92,92,.18)'; }
    else if (nd.depth > 0) { stroke = COL.draft; fill = 'rgba(247,208,62,.08)'; }
    else { stroke = COL.default; fill = 'rgba(79,142,247,.15)'; }

    circle.setAttribute('fill', fill);
    circle.setAttribute('stroke', stroke);
    circle.setAttribute('stroke-width', nd.depth === 0 ? 2 : 1.5);

    const label = document.createElementNS(NS, 'text');
    label.setAttribute('x', nd.x);
    label.setAttribute('y', nd.y + 1);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'middle');
    label.setAttribute('font-size', nd.pruned ? '9' : '10');
    label.setAttribute('fill', nd.pruned ? COL.pruned :
      nd.state === 'accepted' ? COL.accepted :
      nd.state === 'rejected' ? COL.rejected :
      nd.depth === 0 ? COL.text : COL.draft);
    label.setAttribute('font-weight', '700');
    label.textContent = nd.token.length > 6 ? nd.token.slice(0, 6) : nd.token;

    const prob = document.createElementNS(NS, 'text');
    prob.setAttribute('x', nd.x);
    prob.setAttribute('y', nd.y + r + 11);
    prob.setAttribute('text-anchor', 'middle');
    prob.setAttribute('font-size', '9');
    prob.setAttribute('fill', '#8892a4');
    prob.textContent = nd.depth === 0 ? '' : (nd.prob * 100).toFixed(0) + '%';

    g.appendChild(circle);
    g.appendChild(label);
    g.appendChild(prob);
    return g;
  }

  function makeLine(from, to, color) {
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', from.x);
    line.setAttribute('y1', from.y + 18);
    line.setAttribute('x2', to.x);
    line.setAttribute('y2', to.y - 22);
    line.setAttribute('stroke', color || COL.line);
    line.setAttribute('stroke-width', 1.5);
    line.setAttribute('stroke-dasharray', to.pruned ? '4 3' : 'none');
    return line;
  }

  function render() {
    clear();
    const nodeMap = {};
    nodes.forEach(n => { nodeMap[n.id] = n; });

    nodes.forEach(nd => {
      if (nd.parent === null) return;
      const parent = nodeMap[nd.parent];
      const color = nd.pruned ? COL.pruned :
        nd.state === 'accepted' ? COL.accepted :
        nd.state === 'rejected' ? COL.rejected : COL.line;
      svg.appendChild(makeLine(parent, nd, color));
    });

    nodes.forEach(nd => {
      svg.appendChild(makeNode(nd));
    });
  }

  function stopTree(message = 'Tree animation stopped.') {
    timers.cancelAll();
    running = false;
    if (treeLog && message) treeLog.textContent = message;
  }

  async function buildTree() {
    stopTree();
    nodes = [TREE_DEF[0]];
    phase = 'draft';
    running = true;
    if (treeLog) treeLog.textContent = 'Building DDTree with DFlash marginals…';
    render();

    const stagedDepths = [1, 2, 3];
    for (const depth of stagedDepths) {
      if (!(await timers.sleep(180))) return;
      nodes = TREE_DEF.filter(node => node.depth <= depth).map(node => ({ ...node }));
      render();
    }

    running = false;
    if (treeLog) treeLog.textContent = `Tree built: ${nodes.length - 1} candidate nodes across 3 depth levels. Pruned nodes shown in red.`;
  }

  async function verifyTree() {
    if (running || phase === 'empty') return;
    stopTree();
    running = true;
    phase = 'verified';
    if (treeLog) treeLog.textContent = 'LeviathanVerifier: running target model over tree…';

    const bestPath = [1, 4, 8];
    for (const id of bestPath) {
      if (!(await timers.sleep(240))) return;
      const depth = nodes.find(node => node.id === id)?.depth;
      nodes = nodes.map(node => {
        if (node.id === id) return { ...node, state: 'accepted' };
        if (!node.pruned && node.depth === depth && node.id !== id) return { ...node, state: 'rejected' };
        return node;
      });
      render();
    }

    running = false;
    if (treeLog) treeLog.textContent = 'Verification complete. Path “jumps → over → the” accepted (3 tokens committed in 1 verifier call).';
  }

  function resetTree() {
    stopTree('Idle — click Build Demo Tree to start.');
    nodes = [];
    phase = 'empty';
    drawIdleState();
  }

  resetTree();

  document.getElementById('btn-build-tree')?.addEventListener('click', buildTree);
  document.getElementById('btn-verify-tree')?.addEventListener('click', verifyTree);
  document.getElementById('btn-stop-tree')?.addEventListener('click', () => stopTree('Tree animation stopped.'));
  document.getElementById('btn-reset-tree')?.addEventListener('click', resetTree);
})();

// -------------------------------------------------------
// Sudoku mini-demo
// -------------------------------------------------------
(function () {
  const board = document.getElementById('sudoku-board');
  const logEl = document.getElementById('sudoku-log');
  if (!board) return;

  const timers = createTimerGroup();
  const GIVEN = [
    [5, 3, 0, 0, 7, 0, 0, 0, 0],
    [6, 0, 0, 1, 9, 5, 0, 0, 0],
    [0, 9, 8, 0, 0, 0, 0, 6, 0],
    [8, 0, 0, 0, 6, 0, 0, 0, 3],
    [4, 0, 0, 8, 0, 3, 0, 0, 1],
    [7, 0, 0, 0, 2, 0, 0, 0, 6],
    [0, 6, 0, 0, 0, 0, 2, 8, 0],
    [0, 0, 0, 4, 1, 9, 0, 0, 5],
    [0, 0, 0, 0, 8, 0, 0, 7, 9],
  ];

  const FILL_SEQ = [
    [0, 2, 4], [0, 3, 6], [0, 5, 1], [0, 6, 9], [0, 7, 2],
    [0, 8, 8], [1, 1, 7], [1, 2, 1], [1, 6, 3], [1, 7, 4],
  ];

  let cells = [];
  let running = false;
  let boardReady = false;

  function setIdleBoard() {
    board.classList.add('idle');
    board.innerHTML = '<div class="sudoku-placeholder">Board loads on demand. Click Simulate to run the short constraint-pruning demo.</div>';
    boardReady = false;
  }

  function buildBoard() {
    board.classList.remove('idle');
    board.innerHTML = '';
    cells = [];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const div = document.createElement('div');
        div.className = 'sudoku-cell';
        if (c === 2 || c === 5) div.classList.add('box-right');
        if (r === 2 || r === 5) div.classList.add('box-bottom');

        const g = GIVEN[r][c];
        if (g !== 0) {
          div.textContent = g;
          div.classList.add('given');
        }

        board.appendChild(div);
        cells.push({ el: div, row: r, col: c, given: g !== 0 });
      }
    }
    boardReady = true;
  }

  function ensureBoard() {
    if (!boardReady) buildBoard();
  }

  function cellEl(r, c) {
    return cells[r * 9 + c].el;
  }

  function paintCell(el, r, c, text, cls) {
    el.textContent = text;
    el.className = `sudoku-cell ${cls}`.trim();
    if (r === 2 || r === 5) el.classList.add('box-bottom');
    if (c === 2 || c === 5) el.classList.add('box-right');
  }

  async function runSudoku() {
    if (running) return;
    running = true;
    timers.cancelAll();
    ensureBoard();

    for (const [r, c, digit] of FILL_SEQ) {
      const el = cellEl(r, c);
      let draftDigit = digit;
      while (draftDigit === digit) {
        draftDigit = Math.floor(Math.random() * 9) + 1;
      }

      paintCell(el, r, c, draftDigit, 'draft');
      if (logEl) logEl.textContent = `Trying cell(${r + 1},${c + 1}): draft=${draftDigit} → constraint check…`;
      if (!(await timers.sleep(120))) return;

      paintCell(el, r, c, '✗', 'pruned');
      if (logEl) logEl.textContent = `  ✗ pruned: ${draftDigit} already conflicts with the row, column, or box`;
      if (!(await timers.sleep(100))) return;

      paintCell(el, r, c, digit, 'accepted');
      if (logEl) logEl.textContent = `  ✓ accepted: cell(${r + 1},${c + 1}) = ${digit}`;
      if (!(await timers.sleep(140))) return;
    }

    running = false;
    if (logEl) logEl.textContent = 'Mini-run complete. The pruner eliminated invalid digits before the search tree expanded.';
  }

  function stopSudoku(message = 'Sudoku demo stopped. Press Simulate to restart the short run.') {
    timers.cancelAll();
    running = false;
    if (logEl) logEl.textContent = message;
  }

  function resetSudoku() {
    stopSudoku('Idle — click Simulate to load the board and run the short demo.');
    ensureBoard();
  }

  setIdleBoard();
  if (logEl) logEl.textContent = 'Idle — click Simulate to load the board and run the short demo.';

  document.getElementById('btn-sudoku-run')?.addEventListener('click', runSudoku);
  document.getElementById('btn-sudoku-stop')?.addEventListener('click', () => stopSudoku());
  document.getElementById('btn-sudoku-reset')?.addEventListener('click', resetSudoku);
})();
