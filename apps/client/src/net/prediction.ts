import type { InputMessage, KartInput, KartState, SimEnvironment } from '@kart/shared';
import { resolveKartCollisions, SIM_DT, step } from '@kart/shared';

/** Acima disto o erro não é suavizado: o kart foi reposicionado pelo servidor. */
const SNAP_DISTANCE = 3;
/** Erros menores que isto são ruído numérico, não correção. */
const CORRECTION_THRESHOLD = 0.05;
const MAX_PENDING = 180;

const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

/**
 * Predição local do kart do jogador com reconciliação suave.
 *
 * A cada tick o cliente aplica a própria entrada na hora (sem esperar a rede)
 * e guarda essa entrada. Quando chega um snapshot, parte do estado oficial do
 * servidor e reaplica as entradas que ele ainda não processou. Se o resultado
 * diferir do que estava na tela, a diferença vira um deslocamento visual que
 * some em uma fração de segundo, em vez de um salto.
 */
export class LocalPredictor {
  /** Estado previsto (o "agora" do jogador). */
  state: KartState;
  /** Deslocamento visual ainda não absorvido: desenhe em `state` + isto. */
  readonly offset = { x: 0, z: 0, heading: 0 };
  /** Quantas vezes o servidor discordou da predição de forma perceptível. */
  corrections = 0;
  /** Tamanho da última correção, em metros. */
  lastError = 0;

  private pending: InputMessage[] = [];
  private seq = 0;

  constructor(
    initial: KartState,
    private readonly environment: SimEnvironment,
  ) {
    this.state = initial;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  /**
   * Registra a entrada deste tick e devolve a mensagem para enviar ao servidor.
   * @param predict falso enquanto o kart não pode andar (luzes da largada)
   * @param others karts vizinhos (posições interpoladas), para prever o contato
   */
  advance(input: KartInput, predict: boolean, others: readonly KartState[] = []): InputMessage {
    const message: InputMessage = { seq: this.seq++, ...input };
    this.pending.push(message);
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    if (predict) this.state = this.simulate(this.state, input, others);
    return message;
  }

  private simulate(state: KartState, input: KartInput, others: readonly KartState[]): KartState {
    const next = step(state, input, SIM_DT, this.environment);
    if (others.length === 0) return next;
    // O servidor resolve as batidas de verdade; aqui só evitamos atravessar o vizinho até ele confirmar.
    return resolveKartCollisions([next, ...others])[0] as KartState;
  }

  /**
   * Aplica um snapshot: `server` é o estado oficial depois da entrada `ack`.
   * @param replay falso enquanto o kart não pode andar
   */
  reconcile(
    server: KartState,
    ack: number,
    replay: boolean,
    others: readonly KartState[] = [],
  ): void {
    const shownX = this.state.x + this.offset.x;
    const shownZ = this.state.z + this.offset.z;
    const shownHeading = this.state.heading + this.offset.heading;
    const predictedX = this.state.x;
    const predictedZ = this.state.z;

    this.pending = this.pending.filter((message) => message.seq > ack);
    let state = server;
    if (replay) for (const message of this.pending) state = this.simulate(state, message, others);
    this.state = state;

    const errorX = shownX - state.x;
    const errorZ = shownZ - state.z;
    const distance = Math.hypot(errorX, errorZ);
    if (distance > SNAP_DISTANCE) {
      this.offset.x = this.offset.z = this.offset.heading = 0;
    } else {
      this.offset.x = errorX;
      this.offset.z = errorZ;
      this.offset.heading = wrapAngle(shownHeading - state.heading);
    }
    // Correção de verdade = o servidor discordou da predição (o deslocamento visual
    // que ainda está sendo absorvido não conta de novo).
    const disagreement = Math.hypot(predictedX - state.x, predictedZ - state.z);
    if (disagreement > CORRECTION_THRESHOLD) {
      this.corrections++;
      this.lastError = disagreement;
    }
  }

  /** Absorve o deslocamento visual aos poucos; chame a cada quadro. */
  smooth(deltaSeconds: number): void {
    const keep = Math.exp(-12 * deltaSeconds);
    this.offset.x *= keep;
    this.offset.z *= keep;
    this.offset.heading *= keep;
  }

  reset(state: KartState): void {
    this.state = state;
    this.pending = [];
    this.offset.x = this.offset.z = this.offset.heading = 0;
  }
}
