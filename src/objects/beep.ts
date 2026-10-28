/** Three short beeps (a countdown ran out). Silently does nothing where audio is unavailable. */
export function beep(): void {
  try {
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    const t0 = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const start = t0 + i * 0.3;
      const osc = ctx.createOscillator();
      osc.frequency.value = 880;
      osc.connect(gain);
      gain.gain.setValueAtTime(0.18, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.2);
      osc.start(start);
      osc.stop(start + 0.2);
      if (i === 2) osc.onended = () => void ctx.close();
    }
  } catch {
    // No audio: the flashing timer is enough.
  }
}
