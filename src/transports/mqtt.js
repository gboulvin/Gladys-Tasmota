// -----------------------------------------------------------------------------
// MQTT transport: the native Tasmota channel.
//
// Tasmota publishes on `<prefix>/<topic>/<suffix>` (default FullTopic
// `%prefix%/%topic%/`) or `<topic>/<prefix>/<suffix>` (`%topic%/%prefix%/`),
// with the prefixes `cmnd` (commands), `stat` (answers) and `tele`
// (telemetry, LWT). The native discovery (SetOption19 0, default since
// Tasmota 9.1) publishes retained configs on `tasmota/discovery/<MAC>/config`.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import mqtt from 'mqtt';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'mqtt' });

export const FULL_TOPIC = {
  PREFIX_FIRST: 'prefix_topic', // %prefix%/%topic%/ (Tasmota default)
  TOPIC_FIRST: 'topic_prefix', // %topic%/%prefix%/
};

export const DISCOVERY_TOPIC = 'tasmota/discovery/#';

/**
 * Topic grammar for a FullTopic layout.
 * @param {string} mode one of FULL_TOPIC
 */
export function topicLayout(mode) {
  const topicFirst = mode === FULL_TOPIC.TOPIC_FIRST;
  return {
    subscriptions: topicFirst ? ['+/stat/+', '+/tele/+'] : ['stat/+/+', 'tele/+/+'],
    /** Topic of a command. */
    command(deviceTopic, cmnd) {
      return topicFirst ? `${deviceTopic}/cmnd/${cmnd}` : `cmnd/${deviceTopic}/${cmnd}`;
    },
    /** `stat/plug/RESULT` -> { prefix: 'stat', deviceTopic: 'plug', suffix: 'RESULT' }. */
    parse(topic) {
      const parts = topic.split('/');
      if (parts.length !== 3) {
        return null;
      }
      const [prefix, deviceTopic] = topicFirst ? [parts[1], parts[0]] : [parts[0], parts[1]];
      if (prefix !== 'stat' && prefix !== 'tele') {
        return null;
      }
      return { prefix, deviceTopic, suffix: parts[2] };
    },
  };
}

/** `tasmota/discovery/84F3EB12ABCD/config` -> { mac, kind: 'config' }. */
export function parseDiscoveryTopic(topic) {
  const match = /^tasmota\/discovery\/([0-9A-Fa-f]{12})\/(config|sensors)$/.exec(topic);
  return match ? { mac: match[1].toLowerCase(), kind: match[2] } : null;
}

/** Hide the password of a broker URL before logging it. */
export function redactUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '***';
    }
    return parsed.href;
  } catch {
    return '<invalid url>';
  }
}

/**
 * Thin wrapper over the `mqtt` client: connection lifecycle as events
 * ('connected', 'disconnected', 'message'), a `connected` flag for the
 * routing decisions, and an injectable `connect` for the tests.
 */
export class MqttTransport extends EventEmitter {
  constructor({ connect = mqtt.connect } = {}) {
    super();
    this.connectFn = connect;
    this.client = null;
    this.connected = false;
    this.lastError = null;
  }

  /**
   * @param {{ url: string, username?: string, password?: string, subscriptions: string[] }} options
   */
  start({ url, username, password, subscriptions }) {
    this.stop();
    logger.info(`Connecting to the MQTT broker ${redactUrl(url)}`);
    const client = this.connectFn(url, {
      username: username || undefined,
      password: password || undefined,
      clientId: `gladys-tasmota-${Math.random().toString(16).slice(2, 10)}`,
      reconnectPeriod: 5000,
      connectTimeout: 10_000,
      clean: true,
    });
    this.client = client;
    client.on('connect', () => {
      this.connected = true;
      this.lastError = null;
      logger.info('Connected to the MQTT broker');
      client.subscribe(subscriptions, { qos: 0 }, (err) => {
        if (err) {
          logger.error('MQTT subscription failed', err);
        }
      });
      this.emit('connected');
    });
    client.on('close', () => {
      if (this.connected) {
        logger.warn('Disconnected from the MQTT broker');
        this.connected = false;
        this.emit('disconnected');
      }
    });
    client.on('error', (err) => {
      this.lastError = err;
      logger.warn(`MQTT error: ${err.message}`);
    });
    client.on('message', (topic, payload) => {
      this.emit('message', topic, payload.toString());
    });
  }

  publish(topic, payload = '') {
    if (!this.client || !this.connected) {
      throw new Error('The MQTT broker is not connected');
    }
    logger.debug(`MQTT ${topic} <- ${payload}`);
    this.client.publish(topic, payload);
  }

  stop() {
    if (this.client) {
      const client = this.client;
      this.client = null;
      client.removeAllListeners();
      // A late socket error must not crash the process once we stopped listening.
      client.on('error', () => {});
      client.end(true);
    }
    if (this.connected) {
      this.connected = false;
      this.emit('disconnected');
    }
  }
}
