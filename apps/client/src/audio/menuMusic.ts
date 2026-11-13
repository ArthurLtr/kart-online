import { getSettings, onSettingsChange } from '../settings';

/** Acordes (em semitons a partir do lá 110 Hz), um por compasso. */
const CHORDS = [
  [0, 7, 12, 16, 19], // Lá maior
  [-3, 4, 9, 12, 16], // Fá# menor
  [-7, 0, 5, 9, 12], // Ré maior
  [-5, 2, 7, 11, 14], // Mi maior
] as const;
const STEP_SECONDS = 0.21;
const STEPS_PER_BAR = 8;
const PATTERN = [0, 2, 3, 4, 3, 2, 4, 1] as const;

const hertz = (semitones: number): number => 110 * 2 ** (semitones / 12);

/**
 * Música de menu por síntese WebAudio (não há arquivo de som): arpejo suave
 * sobre quatro acordes, com um baixo marcando o compasso.
 */
export class MenuMusic {
  private context: AudioContext | undefined;
  private master: GainNode | undefined;
  private timer = 0;
  private step = 0;
  private nextTime = 0;
  private readonly unsubscribe = onSettingsChange(() => this.applyVolume());

  /** Chame num clique ou tecla (o navegador só libera áudio depois de um gesto). */
  start(): void {
    if (this.context) {
      void this.context.resume();
      return;
    }
    const context = new AudioContext();
    this.context = context;
    const master = context.createGain();
    const tone = context.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2200;
    master.connect(tone).connect(context.destination);
    this.master = master;
    master.gain.value = 0;
    this.applyVolume();
    this.nextTime = context.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 60);
  }

  private applyVolume(): void {
    if (!this.master || !this.context) return;
    const { music, volume } = getSettings();
    this.master.gain.setTargetAtTime(music ? 0.16 * volume : 0, this.context.currentTime, 0.3);
  }

  private note(frequency: number, at: number, length: number, level: number, type: OscillatorType) {
    const { context, master } = this;
    if (!context || !master) return;
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(level, at + 0.015);
    envelope.gain.exponentialRampToValueAtTime(0.001, at + length);
    oscillator.connect(envelope).connect(master);
    oscillator.start(at);
    oscillator.stop(at + length + 0.05);
  }

  /** Agenda as notas dos próximos 200 ms (o relógio do áudio é mais preciso que o setInterval). */
  private schedule(): void {
    const context = this.context;
    if (!context) return;
    while (this.nextTime < context.currentTime + 0.2) {
      const bar = Math.floor(this.step / STEPS_PER_BAR) % CHORDS.length;
      const beat = this.step % STEPS_PER_BAR;
      const chord = CHORDS[bar] as readonly number[];
      const degree = PATTERN[beat] as number;
      this.note(hertz((chord[degree] as number) + 12), this.nextTime, 0.5, 0.5, 'triangle');
      if (beat === 0 || beat === 5) {
        this.note(hertz((chord[0] as number) - 12), this.nextTime, 0.9, 0.8, 'sine');
      }
      if (beat === 4) this.note(hertz((chord[4] as number) + 24), this.nextTime, 0.8, 0.12, 'sine');
      this.step++;
      this.nextTime += STEP_SECONDS;
    }
  }

  dispose(): void {
    window.clearInterval(this.timer);
    this.unsubscribe();
    void this.context?.close();
    this.context = undefined;
  }
}
