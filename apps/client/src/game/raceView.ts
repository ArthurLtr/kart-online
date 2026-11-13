import type { Group, Mesh, Object3D } from 'three';
import { PerspectiveCamera, Scene, Vector3 } from 'three';
import type { KartState, SimEnvironment, Track } from '@kart/shared';
import { createTrackEnvironment, getCircuitoDaOrla, speedOf } from '@kart/shared';
import { KartAudio } from '../audio/kartAudio';
import type { Loadout } from '../cosmetics/catalog';
import { findDesign } from '../cosmetics/catalog';
import { loadPaint } from '../cosmetics/paint';
import { EffectsPool, KartEffects } from '../fx/kartEffects';
import { Trail } from '../fx/trail';
import type { Driver } from '../models/driver';
import { createDriver } from '../models/driver';
import { ChaseCamera } from '../render/chaseCamera';
import { disposeTree } from '../render/dispose';
import type { Lighting } from '../render/lighting';
import { setupLighting, SUN_DIRECTION } from '../render/lighting';
import type { Sky } from '../render/sky';
import { createSky } from '../render/sky';
import type { AppContext } from '../screens/types';
import { getSettings, quality } from '../settings';
import type { TrackScene } from '../track';
import { createTrackScene } from '../track';
import { createPodium, PODIUM_POSITION, PODIUM_STEPS } from './podium';

/** Como desenhar um kart neste quadro: posição já interpolada + estado da simulação. */
export interface KartFrame {
  state: KartState;
  x: number;
  y: number;
  z: number;
  heading: number;
  throttle: number;
}

interface Entry {
  driver: Driver;
  effects: KartEffects;
  /** Cosmético de trilha, se o jogador tiver um equipado. */
  trail: Trail | null;
}

/**
 * Peças pequenas dos karts adversários (parafusos, pedais, alavancas) deixam de
 * projetar sombra: ninguém nota e cada uma custava um draw call na passada de sombra.
 */
function trimShadows(kart: Object3D, minRadius: number): void {
  kart.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh || !mesh.castShadow) return;
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    const scale = mesh.getWorldScale(SCALE).x;
    if ((mesh.geometry.boundingSphere?.radius ?? 0) * scale < minRadius) mesh.castShadow = false;
  });
}
const SCALE = new Vector3();

/**
 * Tudo o que aparece numa corrida: pista, karts com piloto, efeitos, câmera de
 * perseguição, áudio e pódio. Não sabe de onde vêm os estados: o Treino usa a
 * simulação local e a corrida online usa predição + interpolação.
 */
export class RaceView {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 1, 0.3, 4000);
  readonly track: Track = getCircuitoDaOrla();
  readonly environment: SimEnvironment = createTrackEnvironment(this.track);
  readonly audio = new KartAudio();
  /** Borrão de velocidade pedido neste quadro (0 a 1). */
  motionBlur = 0;
  blurEnabled = getSettings().motionBlur;

  private readonly lighting: Lighting;
  private readonly sky: Sky;
  private readonly trackScene: TrackScene;
  private readonly chase: ChaseCamera;
  private readonly pool = new EffectsPool();
  private readonly position = new Vector3();
  private entries: (Entry | undefined)[] = [];
  private rosterVersion = 0;
  private podium: Group | undefined;
  private podiumTime = 0;
  private disposed = false;

  constructor(private readonly context: AppContext) {
    const preset = quality();
    this.lighting = setupLighting(this.scene, context.renderer, preset.shadowMap);
    this.sky = createSky(SUN_DIRECTION);
    this.trackScene = createTrackScene(this.track, SUN_DIRECTION, preset.scenery);
    this.chase = new ChaseCamera(this.camera);
    this.scene.add(this.sky.mesh, this.trackScene.group, this.pool.group);
  }

  /**
   * Monta os karts da corrida, um por vaga, com os cosméticos de cada um.
   * `focus` é o kart do jogador (o único com marcas de derrapagem).
   */
  async setRoster(loadouts: readonly Loadout[], focus: number): Promise<void> {
    this.clearRoster();
    const version = this.rosterVersion;
    const drivers = await Promise.all(
      // A pintura livre ainda é local: só o kart do jogador a recebe.
      loadouts.map((loadout, index) =>
        createDriver(this.context.models, loadout, index === focus ? loadPaint() : null),
      ),
    );
    if (this.disposed || version !== this.rosterVersion) {
      for (const driver of drivers) disposeTree(driver.kart);
      return;
    }
    this.entries = drivers.map((driver, i) => {
      if (i !== focus) trimShadows(driver.kart, quality().shadowMinRadius);
      const effects = new KartEffects(driver.kart, this.pool, i === focus);
      const slot = this.track.grid[i];
      if (slot) {
        driver.kart.position.set(slot.x, slot.y, slot.z);
        driver.kart.rotation.y = slot.heading;
      }
      this.scene.add(driver.kart, effects.group);
      const trailColor = findDesign('trail', loadouts[i]?.trail ?? '').color;
      const trail = trailColor ? new Trail(trailColor) : null;
      if (trail) this.scene.add(trail.mesh);
      return { driver, effects, trail };
    });
  }

  clearRoster(): void {
    this.rosterVersion++;
    this.hidePodium();
    for (const entry of this.entries) {
      if (!entry) continue;
      this.scene.remove(entry.driver.kart, entry.effects.group);
      disposeTree(entry.driver.kart);
      disposeTree(entry.effects.group);
      if (entry.trail) {
        this.scene.remove(entry.trail.mesh);
        entry.trail.dispose();
      }
    }
    this.entries = [];
    this.pool.clear();
    this.chase.reset();
  }

  setLights(count: number): void {
    this.trackScene.setStartLights(count);
  }

  /** A câmera volta a colar no kart (depois de reposicionar ou reiniciar). */
  resetCamera(): void {
    this.chase.reset();
    for (const entry of this.entries) {
      entry?.effects.clear();
      entry?.trail?.clear();
    }
  }

  private placeKart(entry: Entry, frame: KartFrame, delta: number, moving: boolean): void {
    const node = entry.driver.kart;
    const { state, heading } = frame;
    node.position.set(frame.x, frame.y, frame.z);
    // Acompanha o relevo: mede a altura do chão à frente e dos lados.
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const at = (forward: number, left: number): number =>
      this.environment.sample(
        frame.x + fx * forward + fz * left,
        frame.z + fz * forward - fx * left,
        state.trackIndex,
      ).height;
    const pitch = Math.atan2(at(1.1, 0) - at(0, 0), 1.1);
    const roll = Math.atan2(at(0.55, 0.5) - at(0.55, -0.5), 1);
    node.rotation.set(-pitch, heading, roll, 'YXZ');
    const distance = moving ? state.vx * delta * (1 + Math.min(1, state.wheelSlip) * 0.8) : 0;
    entry.driver.update(delta, distance, state.steerAngle);
    node.updateMatrixWorld(true);
  }

  /**
   * Desenha um quadro de corrida.
   * @param frames um por vaga, na ordem do roster
   * @param focus vaga do jogador (câmera e som seguem este kart)
   * @param moving falso durante as luzes da largada (rodas paradas)
   */
  render(
    delta: number,
    time: number,
    frames: readonly KartFrame[],
    focus: number,
    lookBack: boolean,
    moving: boolean,
  ): void {
    frames.forEach((frame, i) => {
      const entry = this.entries[i];
      if (!entry) return;
      this.placeKart(entry, frame, delta, moving);
      entry.effects.update(
        delta,
        time,
        { ...frame.state, x: frame.x, y: frame.y, z: frame.z },
        frame.throttle,
      );
      entry.trail?.update(
        frame.x,
        frame.y,
        frame.z,
        frame.heading,
        moving ? speedOf(frame.state) : 0,
      );
    });
    this.pool.update(delta);

    const own = frames[focus];
    if (own) {
      const speed = speedOf(own.state);
      this.position.set(own.x, own.y, own.z);
      this.chase.update(delta, this.position, own.heading, speed, lookBack);
      this.lighting.follow(this.position, 45);
      this.audio.update(own.state, moving ? own.throttle : 0);
      this.motionBlur = this.blurEnabled ? Math.max(0, (speed - 12) / 19) : 0;
    }
    this.sky.update(time);
    this.trackScene.update(time);
  }

  /** Câmera passeando pela largada enquanto não há corrida (lobby). */
  renderIdle(delta: number, time: number): void {
    const start = this.track.grid[4] ?? this.track.grid[0];
    if (!start) return;
    const angle = time * 0.12;
    this.position.set(start.x + 6, 0.8, start.z);
    this.camera.position.set(
      this.position.x + Math.sin(angle) * 20,
      7 + Math.sin(angle * 0.7) * 2,
      this.position.z - 11 + Math.cos(angle) * 6,
    );
    this.camera.lookAt(this.position);
    this.entries.forEach((entry) => entry?.driver.update(delta, 0, 0));
    this.pool.update(delta);
    this.lighting.follow(this.position, 60);
    this.audio.idle();
    this.motionBlur = 0;
    this.sky.update(time);
    this.trackScene.update(time);
  }

  /** Leva os três primeiros ao pódio: pilotos comemorando e os karts estacionados na frente. */
  showPodium(order: readonly number[]): void {
    this.hidePodium();
    const podium = createPodium();
    this.podium = podium;
    this.podiumTime = 0;
    this.scene.add(podium);
    this.entries.forEach((entry, slot) => {
      if (!entry) return;
      const step = PODIUM_STEPS.find((candidate) => order[candidate.place - 1] === slot);
      const kart = entry.driver.kart;
      if (!step) {
        kart.visible = false; // quem ficou fora do pódio sai de cena
        return;
      }
      const pilot = entry.driver.pilot;
      podium.add(pilot.root);
      pilot.root.position.set(step.x, step.height, 0);
      pilot.root.rotation.set(0, 0, 0);
      pilot.setPose('celebrate');
      // Kart estacionado na frente do degrau, de lado para a câmera.
      kart.position.set(PODIUM_POSITION.x + step.x * 2.1 - 0.7, 0, PODIUM_POSITION.z + 3.4);
      kart.rotation.set(0, Math.PI / 2 - 0.35, 0, 'YXZ');
      entry.driver.kartRig.update(0, 0);
    });
  }

  hidePodium(): void {
    if (!this.podium) return;
    this.scene.remove(this.podium);
    disposeTree(this.podium);
    this.podium = undefined;
  }

  renderPodium(delta: number, time: number): void {
    if (!this.podium) return;
    this.podiumTime += delta;
    this.entries.forEach((entry) => {
      if (entry?.driver.pilot.pose === 'celebrate') entry.driver.pilot.update(delta, 0);
    });
    if (Math.floor(this.podiumTime * 8) !== Math.floor((this.podiumTime - delta) * 8)) {
      this.pool.confetti(PODIUM_POSITION.x, 0, PODIUM_POSITION.z + 0.5, 14);
    }
    this.pool.update(delta);
    // Câmera vinda da pista, com a arquibancada ao fundo, balançando devagar.
    const sway = Math.sin(this.podiumTime * 0.5) * 2.2;
    this.position.set(PODIUM_POSITION.x, 1.35, PODIUM_POSITION.z);
    this.camera.position.set(PODIUM_POSITION.x + sway, 2.1, PODIUM_POSITION.z + 9.5);
    this.camera.lookAt(this.position);
    if (this.camera.fov !== 42) {
      this.camera.fov = 42;
      this.camera.updateProjectionMatrix();
    }
    this.lighting.follow(this.position, 30);
    this.audio.idle();
    this.motionBlur = 0;
    this.sky.update(time);
    this.trackScene.update(time);
  }

  dispose(): void {
    this.disposed = true;
    this.clearRoster();
    this.audio.dispose();
    disposeTree(this.scene);
    this.lighting.dispose();
  }
}
