import type { KartState } from '@kart/shared';
import { speedOf, TUNING } from '@kart/shared';

/** Ruído branco em loop, base do pneu cantando, do vento e do piso solto. */
function noiseBuffer(context: AudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/**
 * Áudio do kart sintetizado com WebAudio (sem arquivos de som): motor com o
 * tom seguindo a rotação, pneu cantando na derrapagem, vento, piso solto,
 * pancadas e os bipes do semáforo. Só começa depois de um gesto do jogador,
 * como os navegadores exigem.
 */
export class KartAudio {
  private context: AudioContext | undefined;
  private master: GainNode | undefined;
  private engine:
    { oscillators: OscillatorNode[]; gain: GainNode; filter: BiquadFilterNode } | undefined;
  private squeal: { gain: GainNode; filter: BiquadFilterNode } | undefined;
  private wind: GainNode | undefined;
  private rumble: GainNode | undefined;
  private noise: AudioBuffer | undefined;
  private muted = false;

  /** Chame num evento de teclado ou clique. Idempotente. */
  unlock(): void {
    if (this.context) {
      void this.context.resume();
      return;
    }
    const context = new AudioContext();
    this.context = context;
    this.noise = noiseBuffer(context);
    const master = context.createGain();
    master.gain.value = this.muted ? 0 : 0.5;
    master.connect(context.destination);
    this.master = master;

    // Motor: dente de serra na frequência de explosão + harmônicos, por um passa-baixa.
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 1.2;
    const gain = context.createGain();
    gain.gain.value = 0;
    const oscillators = (
      [
        ['sawtooth', 1, 0.5],
        ['square', 0.5, 0.3],
        ['sawtooth', 2.01, 0.18],
      ] as const
    ).map(([type, , level]) => {
      const oscillator = context.createOscillator();
      oscillator.type = type;
      const voice = context.createGain();
      voice.gain.value = level;
      oscillator.connect(voice).connect(filter);
      oscillator.start();
      return oscillator;
    });
    filter.connect(gain).connect(master);
    this.engine = { oscillators, gain, filter };

    const loop = (type: BiquadFilterType, frequency: number, q: number) => {
      const source = context.createBufferSource();
      source.buffer = this.noise ?? null;
      source.loop = true;
      const band = context.createBiquadFilter();
      band.type = type;
      band.frequency.value = frequency;
      band.Q.value = q;
      const level = context.createGain();
      level.gain.value = 0;
      source.connect(band).connect(level).connect(master);
      source.start();
      return { gain: level, filter: band };
    };
    this.squeal = loop('bandpass', 1900, 7);
    this.wind = loop('highpass', 900, 0.5).gain;
    this.rumble = loop('lowpass', 260, 0.7).gain;
  }

  /** Atualiza os sons contínuos a partir do estado da simulação. */
  update(state: KartState, throttle: number): void {
    const { context, engine, squeal, wind, rumble } = this;
    if (!context || !engine || !squeal || !wind || !rumble) return;
    const now = context.currentTime;
    const smooth = 0.04;

    // Dois tempos, um cilindro: uma explosão por volta do virabrequim.
    const firing = state.rpm / 60;
    const ratios = [1, 0.5, 2.01];
    engine.oscillators.forEach((oscillator, i) => {
      oscillator.frequency.setTargetAtTime(firing * (ratios[i] as number), now, smooth);
    });
    const load = 0.35 + throttle * 0.65;
    engine.filter.frequency.setTargetAtTime(500 + state.rpm * 0.22 * load, now, smooth);
    engine.gain.gain.setTargetAtTime(0.16 + 0.2 * load, now, smooth);

    const speed = speedOf(state);
    const onTarmac = state.surface === 'asphalt' || state.surface === 'curb';
    const slide = Math.min(1, Math.max(state.rearSlide * 0.7, state.wheelSlip * 0.9));
    squeal.gain.gain.setTargetAtTime(onTarmac && speed > 3 ? slide * 0.28 : 0, now, 0.06);
    squeal.filter.frequency.setTargetAtTime(1500 + speed * 28, now, 0.1);
    wind.gain.setTargetAtTime(Math.min(0.2, (speed / 31) ** 2 * 0.2), now, 0.1);
    const loose = onTarmac ? (state.surface === 'curb' ? 0.25 : 0) : 0.5;
    rumble.gain.setTargetAtTime(loose * Math.min(1, speed / 12), now, 0.05);
  }

  /** Pancada (parede ou outro kart): estouro curto de ruído grave. */
  impact(strength: number): void {
    const { context, master, noise } = this;
    if (!context || !master || !noise) return;
    const source = context.createBufferSource();
    source.buffer = noise;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    const gain = context.createGain();
    const now = context.currentTime;
    gain.gain.setValueAtTime(Math.min(0.9, 0.15 + strength * 0.06), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    source.connect(filter).connect(gain).connect(master);
    source.start(now);
    source.stop(now + 0.3);
  }

  /** Bipe do semáforo: grave a cada luz, agudo e longo quando apagam. */
  beep(go: boolean): void {
    const { context, master } = this;
    if (!context || !master) return;
    const oscillator = context.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = go ? 880 : 440;
    const gain = context.createGain();
    const now = context.currentTime;
    const length = go ? 0.6 : 0.18;
    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + length);
    oscillator.connect(gain).connect(master);
    oscillator.start(now);
    oscillator.stop(now + length + 0.05);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.context.currentTime, 0.02);
    }
    return this.muted;
  }

  /** Motor em marcha lenta e o resto em silêncio (pausa, fim do treino). */
  idle(): void {
    this.update(
      {
        rpm: TUNING.idleRpm,
        vx: 0,
        vy: 0,
        rearSlide: 0,
        wheelSlip: 0,
        surface: 'asphalt',
      } as KartState,
      0,
    );
  }

  dispose(): void {
    void this.context?.close();
    this.context = undefined;
  }
}
