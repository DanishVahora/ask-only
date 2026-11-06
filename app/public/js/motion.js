/**
 * AskOnly — motion primitives.
 *
 * Springs rather than keyframes for anything a person can touch, because a
 * fixed-duration animation cannot respond to new input and a spring can: new
 * input just moves the target and the motion stays continuous.
 *
 * Two parameters, both designer-facing:
 *   damping  1.0 = critically damped, no overshoot. Below 1 it overshoots.
 *   response seconds to reach the target. NOT a duration - a spring has none.
 *
 * House default is damping 1.0. Bounce is earned only by a gesture that
 * carried momentum: overshoot on a flicked card feels right, overshoot on a
 * panel that merely faded in feels wrong.
 */

export const reduceMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/**
 * A single scalar spring. Interruptible by construction: retarget() keeps the
 * current position AND velocity, so a reversal blends instead of hitting a
 * brick wall.
 */
export class Spring {
  constructor(value, { damping = 1, response = 0.4, onFrame } = {}) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.damping = damping;
    this.response = response;
    this.onFrame = onFrame;
    this.running = false;
    this._raf = 0;
    this._last = 0;
  }

  retarget(target, { velocity, damping, response } = {}) {
    this.target = target;
    if (velocity !== undefined) this.velocity = velocity;
    if (damping !== undefined) this.damping = damping;
    if (response !== undefined) this.response = response;
    this.start();
  }

  /** Jump without animating - used for 1:1 drag tracking. */
  set(value) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.onFrame?.(this.value, this);
  }

  start() {
    if (this.running) return;
    if (reduceMotion()) {
      this.set(this.target);
      return;
    }
    this.running = true;
    this._last = performance.now();
    const tick = (now) => {
      // Clamp dt so a backgrounded tab does not produce one enormous step.
      const dt = Math.min((now - this._last) / 1000, 1 / 30);
      this._last = now;

      // Standard spring from damping ratio + response time.
      const omega = (2 * Math.PI) / this.response;
      const zeta = this.damping;
      const x = this.value - this.target;
      const accel = -omega * omega * x - 2 * zeta * omega * this.velocity;
      this.velocity += accel * dt;
      this.value += this.velocity * dt;

      const settled = Math.abs(this.value - this.target) < 0.0015 && Math.abs(this.velocity) < 0.0015;
      if (settled) {
        this.value = this.target;
        this.velocity = 0;
        this.running = false;
        this.onFrame?.(this.value, this);
        return;
      }
      this.onFrame?.(this.value, this);
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this._raf);
    this.running = false;
  }
}

/**
 * Apple's momentum projection - where a flick would come to rest. This is the
 * exponential-decay form they actually ship, not the v^2/(2a) from a physics
 * textbook, which lands noticeably short.
 */
export function project(velocity, decelerationRate = 0.998) {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Progressive resistance past a boundary. A hard stop reads as frozen. */
export function rubberband(overshoot, dimension, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/**
 * 1:1 drag that respects where the element was grabbed, keeps tracking when
 * the pointer leaves the element, and hands release velocity to a spring.
 */
export function draggable(el, { axis = "y", onMove, onRelease, bounds } = {}) {
  let grabOffset = 0;
  let history = [];

  const pos = (e) => (axis === "y" ? e.clientY : e.clientX);

  const down = (e) => {
    el.setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    grabOffset = pos(e) - (axis === "y" ? rect.top : rect.left);
    history = [{ p: pos(e), t: performance.now() }];
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const move = (e) => {
    const p = pos(e);
    history.push({ p, t: performance.now() });
    if (history.length > 6) history.shift();
    let next = p - grabOffset;
    if (bounds) {
      const { min, max, dimension } = bounds();
      if (next < min) next = min - rubberband(min - next, dimension);
      if (next > max) next = max + rubberband(next - max, dimension);
    }
    onMove?.(next, e);
  };

  const up = (e) => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
    // Velocity from a short history, not from the last two events, which is
    // noisy enough to flip the sign of a slow drag.
    const recent = history.slice(-4);
    let v = 0;
    if (recent.length >= 2) {
      const a = recent[0];
      const b = recent[recent.length - 1];
      const dt = (b.t - a.t) / 1000;
      if (dt > 0) v = (b.p - a.p) / dt;
    }
    onRelease?.(v, e);
  };

  el.addEventListener("pointerdown", down);
  return () => el.removeEventListener("pointerdown", down);
}

/** Tween a displayed integer so a changing figure does not just snap. */
export function tweenNumber(el, to, { duration = 420, format = (n) => String(Math.round(n)) } = {}) {
  const from = Number(el.dataset.n ?? 0);
  el.dataset.n = String(to);
  if (reduceMotion() || from === to) {
    el.textContent = format(to);
    return;
  }
  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min((now - t0) / duration, 1);
    // Decelerate - UI settling.
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = format(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** The stamp landing. One entrance, driven by a spring with a little bounce,
 *  because a stamp hitting paper genuinely does rebound. */
export function stampIn(el, { damping = 0.72, response = 0.34 } = {}) {
  if (reduceMotion()) {
    el.style.opacity = "1";
    el.style.transform = "rotate(-2.4deg)";
    return;
  }
  const s = new Spring(0, {
    damping,
    response,
    onFrame: (v) => {
      const scale = 1 + (1 - v) * 0.5;
      el.style.opacity = String(Math.min(1, v * 1.6));
      el.style.transform = `rotate(-2.4deg) scale(${scale})`;
    },
  });
  el.style.opacity = "0";
  s.retarget(1);
  return s;
}
