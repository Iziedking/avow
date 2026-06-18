import { useCallback, useEffect, useRef, useState } from "react";
import { IntroAudio } from "./audio";
import "./intro.css";

type Phase = "gate" | "power" | "init" | "anchor" | "verify" | "confirm" | "resolve";

const STEPS: { phase: Phase; at: number }[] = [
  { phase: "power", at: 0 },
  { phase: "init", at: 1800 },
  { phase: "anchor", at: 5000 },
  { phase: "verify", at: 9000 },
  { phase: "confirm", at: 13000 },
  { phase: "resolve", at: 16000 },
];

const HEX = "0123456789abcdef";
function randHex(len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += HEX[Math.floor(Math.random() * 16)];
  return s;
}

const STATUS: Record<Phase, string> = {
  gate: "standby",
  power: "online",
  init: "link",
  anchor: "anchor",
  verify: "verify",
  confirm: "ok",
  resolve: "ok",
};

function Globe() {
  return (
    <div className="globe">
      <svg viewBox="0 0 200 200" fill="none">
        <circle cx="100" cy="100" r="80" stroke="#1f6f47" strokeWidth="1" />
        <ellipse cx="100" cy="100" rx="80" ry="30" stroke="#1f6f47" strokeWidth="1" />
        <ellipse cx="100" cy="100" rx="80" ry="55" stroke="#163f2c" strokeWidth="1" />
        <ellipse cx="100" cy="100" rx="30" ry="80" stroke="#1f6f47" strokeWidth="1" />
        <ellipse cx="100" cy="100" rx="55" ry="80" stroke="#163f2c" strokeWidth="1" />
        <circle className="node" cx="150" cy="70" r="3" fill="#5fd08a" />
        <circle className="node" cx="62" cy="132" r="3" fill="#5fd08a" />
      </svg>
    </div>
  );
}

export function Intro({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<Phase>("gate");
  const [leaving, setLeaving] = useState(false);
  const [muted, setMuted] = useState(false);
  const [hex, setHex] = useState<string[]>([]);
  const [ticks, setTicks] = useState(0);
  const audioRef = useRef<IntroAudio | null>(null);
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  };

  // Respect reduced motion: skip straight to the product.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) onDone();
    return () => {
      clearTimers();
      audioRef.current?.stop();
    };
  }, [onDone]);

  const finish = useCallback(() => {
    setLeaving(true);
    timers.current.push(window.setTimeout(onDone, 850));
  }, [onDone]);

  const skip = useCallback(() => {
    audioRef.current?.resolve();
    finish();
  }, [finish]);

  const begin = useCallback(async () => {
    const audio = new IntroAudio();
    audio.setMuted(muted);
    audioRef.current = audio;
    try {
      await audio.start();
    } catch {
      // audio unavailable; the visuals still run
    }

    setPhase("power");
    for (const s of STEPS) {
      timers.current.push(
        window.setTimeout(() => {
          setPhase(s.phase);
          if (s.phase === "confirm") audio.confirmTone();
          if (s.phase === "resolve") audio.resolve();
        }, s.at),
      );
    }
    // No auto-dismiss: the boot lands on a "Launch app" button the user clicks to enter.

    const blip = window.setInterval(() => audio.blip(), 720);
    const hexInt = window.setInterval(() => setHex((h) => [...h.slice(-7), randHex(48)]), 110);
    const tickInt = window.setInterval(() => setTicks((n) => (n + 1) % 13), 280);
    timers.current.push(blip, hexInt, tickInt);
    timers.current.push(
      window.setTimeout(() => {
        clearInterval(blip);
        clearInterval(hexInt);
        clearInterval(tickInt);
      }, 13100),
    );
  }, [muted, finish]);

  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    audioRef.current?.setMuted(m);
  };

  return (
    <div className={`intro${leaving ? " is-leaving" : ""}`}>
      <div className="crt">
        <div className="crt-bar">
          <span>AVOW · trust layer</span>
          <span>{STATUS[phase]}</span>
        </div>

        <div className="crt-body">
          {phase === "gate" && (
            <div className="gate">
              <div className="headline glow aberrate">AVOW</div>
              <button className="gate-btn" onClick={begin}>
                ▶ Initialize
              </button>
              <div className="gate-sub">sui · walrus · seal</div>
            </div>
          )}

          {phase === "power" && (
            <div className="headline glow aberrate cursor">AVOW // TRUST LAYER ONLINE</div>
          )}

          {phase === "init" && (
            <>
              <Globe />
              <div className="sys-line glow">INITIALIZING</div>
              <div className="sys-line">
                CONNECTING TO <span className="dim">WALRUS · SUI</span>
                <span className="cursor" />
              </div>
            </>
          )}

          {phase === "anchor" && (
            <>
              <div className="sys-line glow">ANCHORING EVIDENCE</div>
              <div className="hexstream">
                {hex.map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
              </div>
              <div className="sys-line dim">SEAL ENCRYPT · WALRUS STORE · ON-CHAIN ANCHOR</div>
            </>
          )}

          {phase === "verify" && (
            <>
              <div className="sys-line glow">VERIFYING RECORD…</div>
              <div className="ticks">
                {Array.from({ length: 13 }).map((_, i) => (
                  <span key={i} className={i < ticks ? "on" : ""} />
                ))}
              </div>
              <div className="sys-line dim">RECOMPUTING SHA-256 · COMPARING TO ANCHOR</div>
            </>
          )}

          {(phase === "confirm" || phase === "resolve") && (
            <div className="confirm glow">HASH MATCHES THE ANCHOR ✓</div>
          )}

          {phase === "resolve" && (
            <button className="gate-btn launch-btn" onClick={finish}>
              Launch app ▸
            </button>
          )}
        </div>

        <div className="intro-controls">
          <button onClick={toggleMute}>{muted ? "unmute" : "mute"}</button>
          {phase !== "gate" && <button onClick={skip}>skip</button>}
        </div>
      </div>
    </div>
  );
}
