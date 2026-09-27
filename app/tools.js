// Test-day tools: Desmos graphing calculator, math reference sheet, countdown timer.
import { $, h, fmtSec } from './util.js';

let calc = null;
export function toggleCalculator(force) {
  if (!calc) {
    calc = h(`<div class="float-panel calc" hidden>
      <div class="fp-head"><span>Desmos graphing calculator</span><span><button class="fp-size" title="Resize">⤢</button><button class="fp-close" title="Close">✕</button></span></div>
      <iframe src="https://www.desmos.com/calculator" title="Desmos graphing calculator" allow="clipboard-write"></iframe></div>`);
    document.body.append(calc);
    calc.querySelector('.fp-close').onclick = () => calc.hidden = true;
    calc.querySelector('.fp-size').onclick = () => calc.classList.toggle('big');
    dragify(calc);
  }
  calc.hidden = force === undefined ? !calc.hidden : !force;
}

let ref = null;
export function toggleReference(force) {
  if (!ref) {
    ref = h(`<div class="float-panel refsheet" hidden>
      <div class="fp-head"><span>Math reference</span><button class="fp-close" title="Close">✕</button></div>
      <div class="ref-body">
        <table>
          <tr><th>Circle</th><td>A = πr²&emsp;C = 2πr</td></tr>
          <tr><th>Rectangle</th><td>A = ℓw</td></tr>
          <tr><th>Triangle</th><td>A = ½bh</td></tr>
          <tr><th>Pythagorean theorem</th><td>c² = a² + b²</td></tr>
          <tr><th>Special right triangles</th><td>30°-60°-90°: sides x, x√3, 2x<br>45°-45°-90°: sides s, s, s√2</td></tr>
          <tr><th>Rectangular prism</th><td>V = ℓwh</td></tr>
          <tr><th>Cylinder</th><td>V = πr²h</td></tr>
          <tr><th>Sphere</th><td>V = (4/3)πr³</td></tr>
          <tr><th>Cone</th><td>V = (1/3)πr²h</td></tr>
          <tr><th>Pyramid</th><td>V = (1/3)ℓwh</td></tr>
        </table>
        <p>The number of degrees of arc in a circle is 360.<br>The number of radians of arc in a circle is 2π.<br>
        The sum of the measures in degrees of the angles of a triangle is 180.</p>
      </div></div>`);
    document.body.append(ref);
    ref.querySelector('.fp-close').onclick = () => ref.hidden = true;
    dragify(ref);
  }
  ref.hidden = force === undefined ? !ref.hidden : !force;
}
export function closeTools() { if (calc) calc.hidden = true; if (ref) ref.hidden = true; }

function dragify(panel) {
  const head = panel.querySelector('.fp-head');
  head.onpointerdown = e => {
    if (e.target.closest('button')) return;
    const r = panel.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    head.setPointerCapture(e.pointerId);
    head.onpointermove = m => {
      panel.style.left = Math.max(0, Math.min(innerWidth - 80, m.clientX - dx)) + 'px';
      panel.style.top = Math.max(0, Math.min(innerHeight - 40, m.clientY - dy)) + 'px';
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
    };
    head.onpointerup = () => { head.onpointermove = null; };
  };
}

// Countdown that survives reloads: the caller persists `remaining` (seconds) via onTick.
export function countdown(el, remaining, { onTick = () => {}, onEnd = () => {} }) {
  let hidden = false, last = Date.now(), stopped = false;
  const paint = () => {
    el.querySelector('.t').textContent = hidden ? '' : fmtSec(Math.max(0, remaining));
    el.classList.toggle('warn', remaining <= 300);
  };
  el.innerHTML = `<span class="t"></span><button class="btn-lite small">Hide</button>`;
  el.querySelector('button').onclick = e => { hidden = !hidden; e.target.textContent = hidden ? 'Show' : 'Hide'; paint(); };
  const id = setInterval(() => {
    const now = Date.now();
    remaining -= (now - last) / 1000; last = now;
    paint(); onTick(remaining);
    if (remaining <= 0 && !stopped) { stopped = true; clearInterval(id); onEnd(); }
  }, 1000);
  paint();
  return { stop() { stopped = true; clearInterval(id); }, get remaining() { return remaining; } };
}
