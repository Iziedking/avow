// The intro's sci-fi sound bed, built from oscillators so no audio file is needed. A low
// evolving drone (ship systems humming), sparse telemetry blips, and one clean confirmation
// tone. Drop a real track in later by setting TRACK_URL.

export const TRACK_URL: string | null = null;

export class IntroAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private droneGain: GainNode | null = null;
  private voices: OscillatorNode[] = [];
  private lfo: OscillatorNode | null = null;
  private muted = false;

  async start(): Promise<void> {
    if (this.ctx) return;
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    await ctx.resume();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.5;
    master.connect(ctx.destination);
    this.master = master;

    // Drone: two detuned low oscillators through a lowpass whose cutoff drifts slowly.
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 340;
    filter.Q.value = 6;
    droneGain.connect(filter);
    filter.connect(master);
    this.droneGain = droneGain;

    for (const [freq, detune, type] of [
      [58, -6, "sawtooth"],
      [58, 7, "sine"],
      [87, 0, "sine"],
    ] as [number, number, OscillatorType][]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      osc.detune.value = detune;
      osc.connect(droneGain);
      osc.start();
      this.voices.push(osc);
    }

    // Slow filter sweep so the drone evolves.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();
    this.lfo = lfo;

    // Power-on swell.
    const now = ctx.currentTime;
    droneGain.gain.linearRampToValueAtTime(0.18, now + 2.2);
  }

  // A short, low telemetry blip. Slightly randomized so it reads like data, not a beep.
  blip(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 520 + Math.random() * 680;
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.06, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.14);
  }

  // A single clean ascending two-note tone. Resolved and authoritative, not cheerful.
  confirmTone(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    [
      [528, 0],
      [792, 0.16],
    ].forEach(([freq, delay]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = ctx.currentTime + delay;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.16, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      osc.connect(gain);
      gain.connect(this.master!);
      osc.start(t);
      osc.stop(t + 0.75);
    });
  }

  // Settle the drone into a sustained pad, then fade out.
  resolve(): void {
    if (!this.ctx || !this.droneGain || !this.master) return;
    const now = this.ctx.currentTime;
    this.droneGain.gain.linearRampToValueAtTime(0.12, now + 0.6);
    this.master.gain.linearRampToValueAtTime(this.muted ? 0 : 0.5, now + 0.6);
    this.master.gain.linearRampToValueAtTime(0.0001, now + 3.2);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.linearRampToValueAtTime(m ? 0 : 0.5, this.ctx.currentTime + 0.1);
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  stop(): void {
    if (!this.ctx) return;
    try {
      this.voices.forEach((o) => o.stop());
      this.lfo?.stop();
    } catch {
      // already stopped
    }
    this.ctx.close();
    this.ctx = null;
    this.voices = [];
  }
}
