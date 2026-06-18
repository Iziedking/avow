// A tiny electronic blip, one short square-wave tone, used to "read out" the steps as they
// drop in. Its own AudioContext so it outlives the intro's. Browsers keep audio suspended
// until a user gesture, so we resume on the first interaction as well.

let ctx: AudioContext | null = null;
let muted = false;

export function setBeepMuted(m: boolean): void {
  muted = m;
}

function ensure(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

if (typeof window !== "undefined") {
  const unlock = () => ensure();
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}

// One short electronic blip. Frequency rises per step so it reads like a line being spoken.
export function beep(freq = 880): void {
  if (muted) return;
  const c = ensure();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  const t = c.currentTime;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.05, t + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(t);
  osc.stop(t + 0.13);
}
