// -----------------------------------------------------------------------------
// Integration configuration: defaults (they MUST match the `default` values of
// the manifest `config_schema`, see test/manifest.test.js) and normalization,
// so the rest of the code never deals with `undefined` or with numbers typed
// as strings by a form.
// -----------------------------------------------------------------------------

import { FULL_TOPIC } from './transports/mqtt.js';

export const MQTT_MODES = {
  EXTERNAL: 'external', // the user's broker (Gladys' own Mosquitto, Home Assistant's...)
  EMBEDDED: 'embedded', // the Mosquitto sub-container of the integration
  DISABLED: 'disabled', // HTTP only
};

export const DEFAULT_CONFIG = {
  mqtt_mode: MQTT_MODES.EXTERNAL,
  mqtt_url: '',
  mqtt_username: '',
  mqtt_password: '',
  full_topic: FULL_TOPIC.PREFIX_FIRST,
  broker_password: '',
  http_addresses: '',
  http_username: '',
  http_password: '',
  // Seconds between two reads of an HTTP device (MQTT devices push their
  // changes and need no polling).
  poll_frequency: 30,
};

const MIN_POLL_SECONDS = 10;
const MAX_POLL_SECONDS = 3600;

const asString = (value) => (value === undefined || value === null ? '' : String(value).trim());

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const pollFrequency = Number(raw.poll_frequency ?? DEFAULT_CONFIG.poll_frequency);
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    mqtt_mode: Object.values(MQTT_MODES).includes(raw.mqtt_mode)
      ? raw.mqtt_mode
      : DEFAULT_CONFIG.mqtt_mode,
    mqtt_url: normalizeBrokerUrl(asString(raw.mqtt_url)),
    mqtt_username: asString(raw.mqtt_username),
    mqtt_password: raw.mqtt_password ? String(raw.mqtt_password) : '',
    full_topic: Object.values(FULL_TOPIC).includes(raw.full_topic)
      ? raw.full_topic
      : DEFAULT_CONFIG.full_topic,
    broker_password: raw.broker_password ? String(raw.broker_password) : '',
    http_addresses: asString(raw.http_addresses),
    http_username: asString(raw.http_username),
    http_password: raw.http_password ? String(raw.http_password) : '',
    poll_frequency: Number.isFinite(pollFrequency)
      ? Math.min(MAX_POLL_SECONDS, Math.max(MIN_POLL_SECONDS, pollFrequency))
      : DEFAULT_CONFIG.poll_frequency,
  };
}

/**
 * "192.168.1.10" -> "mqtt://192.168.1.10:1883"; a full URL is kept as is.
 * Accepted schemes: mqtt, mqtts, ws, wss.
 */
export function normalizeBrokerUrl(url) {
  if (!url) {
    return '';
  }
  const withScheme = /^[a-z]+:\/\//i.test(url) ? url : `mqtt://${url}`;
  try {
    const parsed = new URL(withScheme);
    if (!['mqtt:', 'mqtts:', 'ws:', 'wss:'].includes(parsed.protocol)) {
      return '';
    }
    if (!parsed.port && parsed.protocol === 'mqtt:') {
      parsed.port = '1883';
    }
    return parsed.href.replace(/\/$/, '');
  } catch {
    return '';
  }
}

/** HTTP credentials of the configuration (the default of every HTTP device). */
export function httpCredentials(config) {
  return { username: config.http_username, password: config.http_password };
}
