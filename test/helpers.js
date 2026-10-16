// Shared fixtures of the tests: real-life Tasmota payloads, a fake MQTT
// transport and a manager wired to the SDK's fake Gladys. No network.

import { EventEmitter } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { TasmotaManager } from '../src/manager.js';

export const PLUG_MAC = '84f3eb12abcd';
export const BULB_MAC = 'a4cf12000001';
export const SHUTTER_MAC = 'c45bbe000002';

/** Status 0 of a Sonoff POW-like plug with an AM2301 sensor. */
export function plugStatus(overrides = {}) {
  return {
    Status: {
      Module: 6,
      DeviceName: 'Kitchen plug',
      FriendlyName: ['Kitchen plug'],
      Topic: 'plug',
      ...overrides.Status,
    },
    StatusFWR: { Version: '14.2.0(release-tasmota)', Hardware: 'ESP8266EX' },
    StatusNET: { Hostname: 'plug-2765', IPAddress: '192.168.1.20', Mac: '84:F3:EB:12:AB:CD' },
    StatusSNS: {
      Time: '2026-10-16T10:00:00',
      ENERGY: {
        TotalStartTime: '2026-01-01T00:00:00',
        Total: 12.345,
        Yesterday: 0.5,
        Today: 0.25,
        Power: 42,
        ApparentPower: 50,
        ReactivePower: 10,
        Factor: 0.84,
        Voltage: 231,
        Current: 0.21,
      },
      AM2301: { Temperature: 21.5, Humidity: 45.2, DewPoint: 9.1 },
      TempUnit: 'C',
    },
    StatusSTS: {
      Time: '2026-10-16T10:00:00',
      Uptime: '0T01:00:00',
      UptimeSec: 3600,
      POWER: 'ON',
      Wifi: { RSSI: 80, Signal: -60 },
    },
  };
}

/** Status 0 of an RGBCCT bulb. */
export function bulbStatus() {
  return {
    Status: { Module: 18, DeviceName: 'Living room bulb', FriendlyName: ['Bulb'], Topic: 'bulb' },
    StatusFWR: { Version: '14.2.0', Hardware: 'ESP8285' },
    StatusNET: { Hostname: 'bulb', IPAddress: '192.168.1.21', Mac: 'A4:CF:12:00:00:01' },
    StatusSNS: { Time: '2026-10-16T10:00:00' },
    StatusSTS: {
      POWER: 'OFF',
      Dimmer: 60,
      Color: 'FF800000FF',
      HSBColor: '30,100,60',
      CT: 250,
      Scheme: 0,
      Speed: 1,
      Wifi: { RSSI: 70 },
    },
  };
}

/** Status 0 of a two-relay shutter controller. */
export function shutterStatus() {
  return {
    Status: {
      Module: 0,
      DeviceName: 'Bedroom shutter',
      FriendlyName: ['Shutter'],
      Topic: 'shutter',
    },
    StatusFWR: { Version: '14.2.0', Hardware: 'ESP8266EX' },
    StatusNET: { Hostname: 'shutter', IPAddress: '192.168.1.22', Mac: 'C4:5B:BE:00:00:02' },
    StatusSNS: { Shutter1: { Position: 40, Direction: 0, Target: 40, Tilt: 0 } },
    StatusSTS: { POWER1: 'OFF', POWER2: 'OFF' },
  };
}

/** In-memory stand-in of MqttTransport: records publications, plays messages. */
export class FakeMqtt extends EventEmitter {
  constructor() {
    super();
    this.connected = false;
    this.client = null;
    this.published = [];
    this.lastError = null;
    this.starts = [];
  }

  start(options) {
    this.starts.push(options);
    this.client = {};
    this.connected = true;
    this.emit('connected');
  }

  publish(topic, payload = '') {
    if (!this.connected) {
      throw new Error('The MQTT broker is not connected');
    }
    this.published.push({ topic, payload });
  }

  stop() {
    this.client = null;
    if (this.connected) {
      this.connected = false;
      this.emit('disconnected');
    }
  }

  /** Play a message as the broker would deliver it, and wait for its handling. */
  async receive(manager, topic, payload) {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    await manager.handleMqttMessage(topic, text);
  }
}

/**
 * A manager on a fake Gladys, a fake MQTT transport and a fake HTTP client.
 * `httpAnswers` maps "address command" (e.g. "192.168.1.20 Status 0") to a
 * JSON answer, or to an Error to throw.
 */
export async function createManager({ config = {}, httpAnswers = {}, devices = [] } = {}) {
  const gladys = createFakeGladys({ devices });
  await gladys.connect();
  const mqtt = new FakeMqtt();
  const httpCalls = [];
  const http = async (address, cmnd, credentials) => {
    httpCalls.push({ address, cmnd, credentials });
    const answer = httpAnswers[`${address} ${cmnd}`] ?? httpAnswers[address];
    if (answer instanceof Error) {
      throw answer;
    }
    if (answer === undefined) {
      throw new Error(`connect ECONNREFUSED ${address}`);
    }
    return typeof answer === 'function' ? answer(cmnd) : structuredClone(answer);
  };
  const brokerCalls = [];
  const manager = new TasmotaManager({
    gladys,
    dataDir: await mkdtemp(join(tmpdir(), 'tasmota-test-')),
    mqtt,
    http,
    startBroker: async (_gladys, options) => {
      brokerCalls.push(options);
      return {
        url: 'mqtt://mosquitto:1883',
        username: 'gladys',
        password: 'x',
        devicePassword: 'devpw',
      };
    },
    stopEmbeddedBroker: async () => {},
  });
  await manager.applyConfig({ mqtt_url: 'mqtt://broker:1883', ...config });
  return { gladys, manager, mqtt, httpCalls, brokerCalls };
}

/** Feed a full MQTT Status 0 (one STATUS0 message) and let it settle. */
export async function discoverOverMqtt(t, manager, mqtt, topic, status) {
  await mqtt.receive(manager, `stat/${topic}/STATUS0`, status);
  t.mock.timers.tick(1000);
  await flush();
}

export const flush = () => new Promise((resolve) => setImmediate(resolve));
