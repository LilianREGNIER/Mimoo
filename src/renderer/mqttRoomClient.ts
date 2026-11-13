/**
 * Client MQTT 3.1.1 léger sur WebSocket (`wss://.../mqtt`) sans dépendance externe.
 * Permet aux joueurs sur des PC et réseaux différents de se rejoindre en temps réel
 * dans un même salon en utilisant uniquement son code de salon.
 */

const DEFAULT_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
];

export type RoomTransportStatus = 'idle' | 'connecting' | 'connected' | 'error';

export interface MqttRoomClientOptions {
  clientId: string;
  topic: string;
  onMessage: (payloadText: string) => void;
  onStatusChange?: (status: RoomTransportStatus) => void;
  brokers?: string[];
}

function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function encodeMqttString(text: string): Uint8Array {
  const utf8 = encodeUtf8(text);
  const out = new Uint8Array(2 + utf8.length);
  out[0] = (utf8.length >> 8) & 0xff;
  out[1] = utf8.length & 0xff;
  out.set(utf8, 2);
  return out;
}

function encodeRemainingLength(length: number): Uint8Array {
  const bytes: number[] = [];
  let x = length;
  do {
    let encodedByte = x % 128;
    x = Math.floor(x / 128);
    if (x > 0) {
      encodedByte |= 128;
    }
    bytes.push(encodedByte);
  } while (x > 0);
  return new Uint8Array(bytes);
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function buildConnectPacket(clientId: string, keepAliveSeconds = 25): Uint8Array {
  const protocolName = encodeMqttString('MQTT');
  const protocolLevel = new Uint8Array([0x04]); // MQTT 3.1.1
  const connectFlags = new Uint8Array([0x02]); // Clean session
  const keepAlive = new Uint8Array([
    (keepAliveSeconds >> 8) & 0xff,
    keepAliveSeconds & 0xff,
  ]);
  const clientIdBytes = encodeMqttString(clientId);

  const variableHeader = concatBytes(protocolName, protocolLevel, connectFlags, keepAlive);
  const remainingLength = encodeRemainingLength(variableHeader.length + clientIdBytes.length);
  return concatBytes(new Uint8Array([0x10]), remainingLength, variableHeader, clientIdBytes);
}

function buildSubscribePacket(packetId: number, topic: string): Uint8Array {
  const idBytes = new Uint8Array([(packetId >> 8) & 0xff, packetId & 0xff]);
  const topicFilter = encodeMqttString(topic);
  const qos = new Uint8Array([0x00]);
  const payload = concatBytes(idBytes, topicFilter, qos);
  const remainingLength = encodeRemainingLength(payload.length);
  return concatBytes(new Uint8Array([0x82]), remainingLength, payload);
}

function buildPublishPacket(topic: string, message: string): Uint8Array {
  const topicBytes = encodeMqttString(topic);
  const payloadBytes = encodeUtf8(message);
  const body = concatBytes(topicBytes, payloadBytes);
  const remainingLength = encodeRemainingLength(body.length);
  return concatBytes(new Uint8Array([0x30]), remainingLength, body);
}

function buildPingReqPacket(): Uint8Array {
  return new Uint8Array([0xc0, 0x00]);
}

function buildDisconnectPacket(): Uint8Array {
  return new Uint8Array([0xe0, 0x00]);
}

export class MqttRoomClient {
  private readonly clientId: string;
  private readonly topic: string;
  private readonly onMessage: (payloadText: string) => void;
  private readonly onStatusChange?: (status: RoomTransportStatus) => void;
  private readonly brokers: string[];

  private ws: WebSocket | null = null;
  private buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  private brokerIndex = 0;
  private closedManually = false;
  private isConnected = false;
  private nextPacketId = 1;
  private connectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private keepAliveIntervalId: ReturnType<typeof setInterval> | null = null;
  private reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(options: MqttRoomClientOptions) {
    this.clientId = options.clientId;
    this.topic = options.topic;
    this.onMessage = options.onMessage;
    this.onStatusChange = options.onStatusChange;
    this.brokers = options.brokers && options.brokers.length > 0 ? options.brokers : DEFAULT_BROKERS;
  }

  public connect(): void {
    this.closedManually = false;
    this.brokerIndex = 0;
    this.openSocket();
  }

  public getIsConnected(): boolean {
    return this.isConnected;
  }

  public publish(payloadText: string): boolean {
    if (!this.ws || !this.isConnected || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      this.ws.send(buildPublishPacket(this.topic, payloadText));
      return true;
    } catch {
      return false;
    }
  }

  public disconnect(): void {
    this.closedManually = true;
    this.isConnected = false;
    this.clearTimers();

    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(buildDisconnectPacket());
        }
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.onStatusChange?.('idle');
  }

  private openSocket(): void {
    if (this.closedManually || typeof WebSocket === 'undefined') {
      return;
    }

    this.clearTimers();
    this.isConnected = false;
    this.buffer = new Uint8Array(0);
    this.onStatusChange?.('connecting');

    const url = this.brokers[this.brokerIndex % this.brokers.length];
    let socket: WebSocket;
    try {
      socket = new WebSocket(url, 'mqtt');
      socket.binaryType = 'arraybuffer';
    } catch {
      this.scheduleFallbackReconnect();
      return;
    }

    this.ws = socket;

    this.connectTimeoutId = setTimeout(() => {
      if (!this.isConnected && !this.closedManually) {
        try {
          socket.close();
        } catch {
          // ignore
        }
      }
    }, 5000);

    socket.onopen = () => {
      if (this.ws !== socket || this.closedManually) return;
      try {
        socket.send(buildConnectPacket(this.clientId, 25));
      } catch {
        this.scheduleFallbackReconnect();
      }
    };

    socket.onmessage = async (event) => {
      if (this.ws !== socket || this.closedManually) return;
      let chunk: Uint8Array;
      if (event.data instanceof ArrayBuffer) {
        chunk = new Uint8Array(event.data);
      } else if (typeof Blob !== 'undefined' && event.data instanceof Blob) {
        chunk = new Uint8Array(await event.data.arrayBuffer());
      } else {
        return;
      }
      this.appendAndParsePackets(chunk);
    };

    socket.onerror = () => {
      // onclose gère le fallback et la reconnexion
    };

    socket.onclose = () => {
      if (this.ws !== socket) return;
      this.ws = null;
      this.isConnected = false;
      this.clearTimers();
      if (!this.closedManually) {
        this.scheduleFallbackReconnect();
      }
    };
  }

  private scheduleFallbackReconnect(): void {
    if (this.closedManually) return;
    this.brokerIndex = (this.brokerIndex + 1) % this.brokers.length;
    this.onStatusChange?.(this.brokerIndex === 0 ? 'error' : 'connecting');
    this.reconnectTimeoutId = setTimeout(() => {
      this.openSocket();
    }, 2000);
  }

  private clearTimers(): void {
    if (this.connectTimeoutId !== null) {
      clearTimeout(this.connectTimeoutId);
      this.connectTimeoutId = null;
    }
    if (this.keepAliveIntervalId !== null) {
      clearInterval(this.keepAliveIntervalId);
      this.keepAliveIntervalId = null;
    }
    if (this.reconnectTimeoutId !== null) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
  }

  private appendAndParsePackets(chunk: Uint8Array): void {
    this.buffer = concatBytes(this.buffer, chunk);

    while (this.buffer.length >= 2) {
      const headerByte = this.buffer[0];
      const packetType = (headerByte >> 4) & 0x0f;

      let multiplier = 1;
      let remainingLength = 0;
      let pos = 1;
      let completeVarInt = false;

      while (pos < this.buffer.length && pos <= 4) {
        const encodedByte = this.buffer[pos];
        remainingLength += (encodedByte & 0x7f) * multiplier;
        pos++;
        if ((encodedByte & 0x80) === 0) {
          completeVarInt = true;
          break;
        }
        multiplier *= 128;
      }

      if (!completeVarInt) {
        return;
      }

      const totalPacketLength = pos + remainingLength;
      if (this.buffer.length < totalPacketLength) {
        return;
      }

      const body = this.buffer.slice(pos, totalPacketLength);
      this.buffer = this.buffer.slice(totalPacketLength);

      this.handlePacket(packetType, headerByte, body);
    }
  }

  private handlePacket(packetType: number, headerByte: number, body: Uint8Array): void {
    if (packetType === 2) {
      // CONNACK
      const returnCode = body.length >= 2 ? body[1] : 1;
      if (returnCode === 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
        if (this.connectTimeoutId !== null) {
          clearTimeout(this.connectTimeoutId);
          this.connectTimeoutId = null;
        }
        const packetId = this.nextPacketId++;
        this.ws.send(buildSubscribePacket(packetId, this.topic));
        this.keepAliveIntervalId = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(buildPingReqPacket());
          }
        }, 20_000);
      } else {
        this.ws?.close();
      }
      return;
    }

    if (packetType === 9) {
      // SUBACK : prêt à émettre et recevoir
      this.isConnected = true;
      this.onStatusChange?.('connected');
      return;
    }

    if (packetType === 3) {
      // PUBLISH
      if (body.length < 2) return;
      const topicLen = (body[0] << 8) | body[1];
      let offset = 2 + topicLen;
      const qos = (headerByte >> 1) & 0x03;
      if (qos > 0) {
        offset += 2; // Packet Identifier
      }
      if (offset <= body.length) {
        const payload = decodeUtf8(body.slice(offset));
        this.onMessage(payload);
      }
    }
  }
}
