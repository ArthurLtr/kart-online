import { Client } from 'colyseus.js';
import type { Room } from 'colyseus.js';
import type {
  InputMessage,
  JoinOptions,
  PingMessage,
  RoomMessage,
  SnapshotMessage,
} from '@kart/shared';
import { MESSAGES, ROOM_NAME, SERVER_DEFAULT_PORT } from '@kart/shared';

/** Condições de rede simuladas no cliente, para testar o netcode (painel F3). */
export interface NetConditions {
  /** Atraso somado em cada sentido, ms. */
  delayMs: number;
  /** Fração de pacotes de jogo (entradas e snapshots) descartados, 0 a 1. */
  loss: number;
}

export interface ConnectionHandlers {
  onRoom(message: RoomMessage): void;
  onSnapshot(message: SnapshotMessage): void;
  /** A conexão caiu; `willRetry` indica que a reconexão automática está em andamento. */
  onDisconnect(willRetry: boolean): void;
  onReconnect(): void;
}

function serverUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (configured) return configured;
  const secure = window.location.protocol === 'https:';
  return `${secure ? 'wss' : 'ws'}://${window.location.hostname}:${SERVER_DEFAULT_PORT}`;
}

const RECONNECT_ATTEMPTS = 8;
const RECONNECT_INTERVAL_MS = 3000;

/** Conexão com a sala de corrida: mensagens tipadas, ping e reconexão em até 30 s. */
export class Connection {
  readonly conditions: NetConditions = { delayMs: 0, loss: 0 };
  /** Ida e volta até o servidor, ms (inclui o atraso simulado). */
  ping = 0;

  private readonly client = new Client(serverUrl());
  private room: Room | undefined;
  private pingTimer = 0;
  private closed = false;

  constructor(private readonly handlers: ConnectionHandlers) {}

  /** Entra numa sala: por matchmaking (Casual), criando uma privada, ou pelo código de convite. */
  async join(options: JoinOptions, code?: string): Promise<void> {
    if (code) this.attach(await this.client.joinById(code.trim(), options));
    else if (options.mode === 'private') this.attach(await this.client.create(ROOM_NAME, options));
    else this.attach(await this.client.joinOrCreate(ROOM_NAME, options));
  }

  /** Entra na partida ranqueada que a fila formou (reserva de vaga do servidor). */
  async joinReservation(reservation: unknown): Promise<void> {
    this.attach(await this.client.consumeSeatReservation(reservation as never));
  }

  /** Entrega com o atraso e a perda simulados. Mensagens de sala nunca são perdidas. */
  private deliver(action: () => void, droppable: boolean): void {
    if (droppable && Math.random() < this.conditions.loss) return;
    if (this.conditions.delayMs > 0) window.setTimeout(action, this.conditions.delayMs);
    else action();
  }

  private attach(room: Room): void {
    this.room = room;
    room.onMessage(MESSAGES.room, (message: RoomMessage) => {
      this.deliver(() => this.handlers.onRoom(message), false);
    });
    room.onMessage(MESSAGES.snapshot, (message: SnapshotMessage) => {
      this.deliver(() => this.handlers.onSnapshot(message), true);
    });
    room.onMessage(MESSAGES.pong, (message: PingMessage) => {
      this.deliver(() => {
        this.ping = Math.round(performance.now() - message.t);
      }, false);
    });
    room.onLeave((code) => {
      window.clearInterval(this.pingTimer);
      // 1000 = saída normal; 4000+ = o servidor recusou ou expulsou.
      if (this.closed || code === 1000 || code >= 4000) {
        this.handlers.onDisconnect(false);
        return;
      }
      this.handlers.onDisconnect(true);
      void this.reconnect(room.reconnectionToken);
    });
    window.clearInterval(this.pingTimer);
    this.pingTimer = window.setInterval(() => {
      const message: PingMessage = { t: performance.now() };
      this.deliver(() => room.send(MESSAGES.ping, message), false);
    }, 1000);
  }

  /** A vaga fica guardada por 30 s no servidor; tenta voltar nesse intervalo. */
  private async reconnect(token: string): Promise<void> {
    for (let attempt = 0; attempt < RECONNECT_ATTEMPTS && !this.closed; attempt++) {
      try {
        this.attach(await this.client.reconnect(token));
        this.handlers.onReconnect();
        return;
      } catch {
        await new Promise((resolve) => window.setTimeout(resolve, RECONNECT_INTERVAL_MS));
      }
    }
    if (!this.closed) this.handlers.onDisconnect(false);
  }

  sendInput(message: InputMessage): void {
    const room = this.room;
    if (room) this.deliver(() => room.send(MESSAGES.input, message), true);
  }

  sendReady(ready: boolean): void {
    this.room?.send(MESSAGES.ready, { ready });
  }

  close(): void {
    this.closed = true;
    window.clearInterval(this.pingTimer);
    void this.room?.leave(true);
    this.room = undefined;
  }
}
