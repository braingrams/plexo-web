"use client";

export type SoundChoice = "chime" | "pop" | "ding" | "bell" | "subtle";

export const SOUND_OPTIONS: { id: SoundChoice; label: string; desc: string }[] = [
  { id: "chime", label: "Chime", desc: "Warm harmonic two-tone chime" },
  { id: "pop", label: "Pop", desc: "Crisp modern bubbly pop" },
  { id: "ding", label: "Ding", desc: "Bright crystal glass ping" },
  { id: "bell", label: "Bell", desc: "Classic resonant desk bell" },
  { id: "subtle", label: "Subtle", desc: "Soft low-profile whisper blip" },
];

let cachedContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!cachedContext || cachedContext.state === "closed") {
    cachedContext = new AudioCtx();
  }
  if (cachedContext.state === "suspended") {
    void cachedContext.resume();
  }
  return cachedContext;
}

/**
 * Synthesizes a clean, high-quality modern notification sound in real time using the Web Audio API.
 * Guaranteed to work on all modern browsers without external audio assets or latency.
 */
export function playNotificationSound(sound: SoundChoice | string = "chime"): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    switch (sound) {
      case "pop": {
        // Modern bubbly pop: quick upward sweep then short decay
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(380, now);
        osc.frequency.exponentialRampToValueAtTime(760, now + 0.04);
        osc.frequency.exponentialRampToValueAtTime(180, now + 0.12);

        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.15);
        break;
      }

      case "ding": {
        // Bright crystal ding: high C6 fundamental + overtone
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.type = "sine";
        osc1.frequency.setValueAtTime(1046.5, now); // C6
        osc2.type = "sine";
        osc2.frequency.setValueAtTime(2093.0, now); // C7 overtone

        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.52);
        osc2.stop(now + 0.52);
        break;
      }

      case "bell": {
        // Classic resonant desk bell: 587Hz (D5) with rich decay
        const osc = ctx.createOscillator();
        const overtone = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "sine";
        osc.frequency.setValueAtTime(587.33, now);
        overtone.type = "triangle";
        overtone.frequency.setValueAtTime(1174.66, now);

        gain.gain.setValueAtTime(0.28, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);

        osc.connect(gain);
        overtone.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        overtone.start(now);
        osc.stop(now + 0.7);
        overtone.stop(now + 0.7);
        break;
      }

      case "subtle": {
        // Gentle whisper blip: soft sine swell
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(520, now + 0.08);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.15, now + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.25);
        break;
      }

      case "chime":
      default: {
        // Elegant two-tone melodic chime: C5 (523Hz) then G5 (784Hz)
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        const gain2 = ctx.createGain();

        osc1.type = "sine";
        osc1.frequency.setValueAtTime(523.25, now);
        gain1.gain.setValueAtTime(0.25, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);

        osc2.type = "sine";
        osc2.frequency.setValueAtTime(783.99, now + 0.09);
        gain2.gain.setValueAtTime(0.001, now);
        gain2.gain.setValueAtTime(0.25, now + 0.09);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);

        osc1.start(now);
        osc1.stop(now + 0.38);
        osc2.start(now + 0.09);
        osc2.stop(now + 0.58);
        break;
      }
    }
  } catch {
    // Audio autoplay restrictions or unsupported audio context: silently ignore
  }
}
