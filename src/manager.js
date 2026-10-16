// -----------------------------------------------------------------------------
// TasmotaManager: the device registry and the protocol logic.
//
// One record per physical device, keyed by its MAC address — the only
// identifier a Tasmota device keeps across a rename, a new topic, a new IP or
// a switch from HTTP to MQTT. External ids are built from it:
//   device  ext:<selector>:tasmota:<mac>
//   feature ext:<selector>:tasmota:<mac>:<feature key>
//
// Sources of truth:
//   - MQTT (preferred): LWT, `tele/STATE`, `tele/SENSOR`, `stat/RESULT`,
//     `stat/STATUSn` and the native discovery `tasmota/discovery/<MAC>/config`;
//   - HTTP: `Status 0` on the addresses of the config or of a scan, polled.
// The records are kept in /data/devices.json (the only writable volume), so
// the integration knows its devices before they speak again after a restart.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createLogger,
  DEVICE_POLL_FREQUENCIES,
  DEVICE_TRANSPORTS,
} from '@gladysassistant/integration-sdk';
import {
  analyzeCapabilities,
  buildCommand,
  extractReadings,
  readOnOff,
} from './tasmota/features.js';
import { extractEvents, TRIGGERS } from './tasmota/events.js';
import { formatMac, isStatusComplete, normalizeMac, parseStatus } from './tasmota/status.js';
import {
  DISCOVERY_TOPIC,
  MqttTransport,
  parseDiscoveryTopic,
  topicLayout,
} from './transports/mqtt.js';
import { expandAddresses, httpCommand, HttpAuthError, mapLimit } from './transports/http.js';
import { httpCredentials, MQTT_MODES, normalizeConfig } from './config.js';
import { ensureBroker, stopBroker } from './broker.js';
import { t } from './i18n.js';

const logger = createLogger({ name: 'manager' });

export const DEVICE_TYPE = 'tasmota';
export const PROTOCOLS = { MQTT: 'mqtt', HTTP: 'http' };
export const PARAMS = {
  IP: 'IP',
  PROTOCOL: 'PROTOCOL',
  TOPIC: 'TOPIC',
  MAC: 'MAC',
  FIRMWARE: 'FIRMWARE',
};

const STORE_VERSION = 1;
// Time left to the STATUSn messages of one `Status 0` to arrive together.
const STATUS_SETTLE_MS = 1000;
// A topic that speaks without being known is asked its status at most this often.
const STATUS_REQUEST_COOLDOWN_MS = 60_000;
const COMMAND_ANSWER_TIMEOUT_MS = 5000;
const STATE_HEARTBEAT_MS = 30 * 60 * 1000;
const PUBLISH_DEBOUNCE_MS = 1500;
const SAVE_DEBOUNCE_MS = 1000;
// An HTTP device is offline after this many failed reads in a row.
const HTTP_OFFLINE_AFTER_FAILURES = 2;
const HTTP_SCAN_CONCURRENCY = 16;
const POLL_TOLERANCE_MS = 5000;
// Backlog `Delay` is in tenths of second, 3600 at most.
export const MAX_PULSE_SECONDS = 360;

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export class TasmotaManager {
  /**
   * @param {object} options
   * @param {import('@gladysassistant/integration-sdk').GladysIntegration} options.gladys
   * @param {string} [options.dataDir] writable directory (/data in the container)
   * @param {MqttTransport} [options.mqtt] injectable for the tests
   * @param {typeof httpCommand} [options.http] injectable for the tests
   * @param {typeof ensureBroker} [options.startBroker] injectable for the tests
   */
  constructor({
    gladys,
    dataDir = process.env.DATA_DIR || '/data',
    mqtt = new MqttTransport(),
    http = httpCommand,
    startBroker = ensureBroker,
    stopEmbeddedBroker = stopBroker,
  }) {
    this.gladys = gladys;
    this.dataDir = dataDir;
    this.mqtt = mqtt;
    this.http = http;
    this.startBroker = startBroker;
    this.stopEmbeddedBroker = stopEmbeddedBroker;
    this.config = normalizeConfig();
    this.layout = topicLayout(this.config.full_topic);
    /** @type {Map<string, object>} mac -> record */
    this.records = new Map();
    this.pendingStatus = new Map();
    this.statusRequests = new Map();
    this.discoveryConfigs = new Map();
    this.answerWaiters = new Map();
    this.httpFailures = new Map();
    this.authRequired = new Set();
    this.lastPolls = new Map();
    this.brokerError = null;
    this.timers = new Set();
    this.publishTimer = null;
    this.saveTimer = null;
    this.mqttSettings = null;

    this.mqtt.on('message', (topic, payload) => {
      this.handleMqttMessage(topic, payload).catch((err) =>
        logger.error(`MQTT message on ${topic} failed`, err),
      );
    });
    this.mqtt.on('connected', () => this.onBrokerConnected());
    this.mqtt.on('disconnected', () => this.onBrokerDisconnected());
  }

  // --- Ids ----------------------------------------------------------------------

  ids(mac) {
    return this.gladys.externalIds(DEVICE_TYPE, mac);
  }

  /** Device or feature external id -> MAC of the record (undefined if foreign). */
  macOf(externalId) {
    const prefix = this.gladys.externalId(`${DEVICE_TYPE}:`);
    if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
      return undefined;
    }
    return externalId.slice(prefix.length).split(':')[0];
  }

  /** Feature external id -> feature key. */
  featureKeyOf(featureExternalId) {
    const mac = this.macOf(featureExternalId);
    return mac ? featureExternalId.slice(this.ids(mac).device.length + 1) : undefined;
  }

  recordOf(externalId) {
    const mac = this.macOf(externalId);
    return mac ? this.records.get(mac) : undefined;
  }

  recordByTopic(topic) {
    for (const record of this.records.values()) {
      if (record.topic === topic) {
        return record;
      }
    }
    return undefined;
  }

  // --- Lifecycle ----------------------------------------------------------------

  /** Load the records of /data, then complete them with the devices of Gladys. */
  async load() {
    try {
      const store = JSON.parse(await readFile(join(this.dataDir, 'devices.json'), 'utf8'));
      for (const record of store.devices ?? []) {
        if (normalizeMac(record.mac)) {
          this.records.set(record.mac, { ...record, online: null });
        }
      }
      logger.info(`${this.records.size} known device(s) loaded`);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn(`Cannot read the device store: ${err.message}`);
      }
    }
  }

  /**
   * The devices the user created in Gladys carry their transport params:
   * enough to rebuild a record lost with /data (a reinstall).
   */
  adoptGladysDevices(devices = this.gladys.devices ?? []) {
    for (const device of devices) {
      const mac = this.macOf(device.external_id);
      if (!mac || this.records.has(mac)) {
        continue;
      }
      const param = (name) => device.params?.find((p) => p.name === name)?.value;
      const features = {};
      for (const f of device.features ?? []) {
        const key = this.featureKeyOf(f.external_id);
        if (key) {
          features[key] = {
            name: f.name,
            category: f.category,
            type: f.type,
            unit: f.unit ?? undefined,
            min: f.min,
            max: f.max,
            read_only: f.read_only,
            has_feedback: f.has_feedback,
            keep_history: f.keep_history,
          };
        }
      }
      this.records.set(mac, {
        mac,
        name: device.name,
        topic: param(PARAMS.TOPIC) || undefined,
        ip: param(PARAMS.IP) || undefined,
        protocol: param(PARAMS.PROTOCOL) === PROTOCOLS.HTTP ? PROTOCOLS.HTTP : PROTOCOLS.MQTT,
        firmware: param(PARAMS.FIRMWARE) || undefined,
        model: device.model ?? undefined,
        features,
        ctx: { isLight: false, lightPowerKey: null, shutterRelays: [], schemeMax: 4 },
        online: null,
      });
    }
  }

  /** Apply a (new) configuration: (re)connect MQTT, probe the HTTP addresses. */
  async applyConfig(rawConfig) {
    this.config = normalizeConfig(rawConfig);
    this.layout = topicLayout(this.config.full_topic);
    await this.startMqtt();
    this.probeConfiguredAddresses();
  }

  async startMqtt() {
    const { mqtt_mode: mode } = this.config;
    let settings = null;
    this.brokerError = null;
    try {
      if (mode === MQTT_MODES.EMBEDDED) {
        const broker = await this.startBroker(this.gladys, {
          dataDir: this.dataDir,
          devicePassword: this.config.broker_password,
        });
        this.brokerDevicePassword = broker.devicePassword;
        settings = { url: broker.url, username: broker.username, password: broker.password };
      } else {
        await this.stopEmbeddedBroker(this.gladys).catch(() => {});
        if (mode === MQTT_MODES.EXTERNAL && this.config.mqtt_url) {
          settings = {
            url: this.config.mqtt_url,
            username: this.config.mqtt_username,
            password: this.config.mqtt_password,
          };
        }
      }
    } catch (err) {
      this.brokerError = err.message;
      logger.error('Embedded MQTT broker failed to start', err);
    }

    const key = settings ? JSON.stringify([settings, this.config.full_topic]) : null;
    if (key === this.mqttSettings && (settings === null || this.mqtt.client)) {
      return;
    }
    this.mqttSettings = key;
    if (!settings) {
      this.mqtt.stop();
      return;
    }
    this.mqtt.start({
      ...settings,
      subscriptions: [...this.layout.subscriptions, DISCOVERY_TOPIC],
    });
  }

  stop() {
    this.mqtt.stop();
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    clearTimeout(this.publishTimer);
    clearTimeout(this.saveTimer);
    for (const pending of this.pendingStatus.values()) {
      clearTimeout(pending.timer);
    }
    this.pendingStatus.clear();
  }

  later(ms, fn) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, ms);
    this.timers.add(timer);
    return timer;
  }

  async onBrokerConnected() {
    // Ask every known MQTT device for a fresh status (retained LWTs bring the
    // others in on their own).
    for (const record of this.records.values()) {
      if (record.topic) {
        this.requestStatus(record.topic, { force: true });
      }
    }
    await this.publishTransportsSafe();
    this.onChange?.();
  }

  async onBrokerDisconnected() {
    await this.publishTransportsSafe();
    this.onChange?.();
  }

  // --- Discovery payload ------------------------------------------------------

  buildDevice(record) {
    const ids = this.ids(record.mac);
    const params = [
      { name: PARAMS.MAC, value: formatMac(record.mac) },
      { name: PARAMS.PROTOCOL, value: record.protocol },
    ];
    if (record.ip) {
      params.push({ name: PARAMS.IP, value: record.ip });
    }
    if (record.topic) {
      params.push({ name: PARAMS.TOPIC, value: record.topic });
    }
    if (record.firmware) {
      params.push({ name: PARAMS.FIRMWARE, value: record.firmware });
    }
    const device = {
      name: record.name,
      external_id: ids.device,
      model: record.model || 'Tasmota',
      params,
      features: Object.entries(record.features).map(([key, spec]) => ({
        ...spec,
        external_id: ids.feature(key),
      })),
    };
    if (record.protocol === PROTOCOLS.HTTP) {
      // Gladys polls at a fixed pace (read once at creation); the interval of
      // the configuration is applied by skipping polls (see pollDevice).
      device.should_poll = true;
      device.poll_frequency = DEVICE_POLL_FREQUENCIES.EVERY_10_SECONDS;
    }
    return device;
  }

  buildDiscoveredDevices() {
    return [...this.records.values()]
      .filter((record) => Object.keys(record.features).length > 0)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((record) => this.buildDevice(record));
  }

  async publishDevices() {
    clearTimeout(this.publishTimer);
    this.publishTimer = null;
    await this.gladys.publishDiscoveredDevices(this.buildDiscoveredDevices());
  }

  /** Coalesce the publications of a discovery burst (many devices at once). */
  schedulePublish() {
    if (this.publishTimer) {
      return;
    }
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null;
      this.publishDevices().catch((err) => logger.error('Device publication failed', err));
      this.publishTransportsSafe();
      this.onChange?.();
    }, PUBLISH_DEBOUNCE_MS);
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.save().catch((err) => logger.error('Device store write failed', err));
    }, SAVE_DEBOUNCE_MS);
  }

  /** Persist the records; saves run one after the other. */
  save() {
    this.saving = (this.saving ?? Promise.resolve()).catch(() => {}).then(() => this.writeStore());
    return this.saving;
  }

  async writeStore() {
    const devices = [...this.records.values()].map((record) => {
      const { online: _online, ...persisted } = record;
      return persisted;
    });
    await mkdir(this.dataDir, { recursive: true });
    const file = join(this.dataDir, 'devices.json');
    // Write then rename: a crash mid-write never leaves a truncated store.
    await writeFile(`${file}.tmp`, JSON.stringify({ version: STORE_VERSION, devices }), {
      mode: 0o600,
    });
    await rename(`${file}.tmp`, file);
  }

  // --- Records ----------------------------------------------------------------

  /**
   * Create or refresh a record from a complete `Status 0`, publish its states.
   * @param {object} status merged Status 0 blocks
   * @param {{ protocol: string, http?: object }} source
   */
  async upsertFromStatus(status, { protocol, http, address } = {}) {
    const info = parseStatus(status);
    if (!info.mac) {
      return null;
    }
    const existing = this.records.get(info.mac);
    const discovery = this.discoveryConfigs.get(info.mac) ?? existing?.discovery;
    const ctx = analyzeCapabilities(info.state, discovery);
    const readings = [
      ...extractReadings('state', info.state, ctx),
      ...extractReadings('sensors', info.sensors, ctx),
    ];
    const features = { ...(existing?.features ?? {}) };
    for (const { key, spec } of readings) {
      features[key] = spec;
    }
    // MQTT wins once seen: it pushes, HTTP is polled.
    const finalProtocol =
      protocol === PROTOCOLS.MQTT || existing?.protocol === PROTOCOLS.MQTT
        ? PROTOCOLS.MQTT
        : PROTOCOLS.HTTP;
    const record = {
      ...existing,
      mac: info.mac,
      name: info.name,
      topic: info.topic ?? existing?.topic,
      ip: info.ip ?? address ?? existing?.ip,
      protocol: finalProtocol,
      firmware: info.firmware ?? existing?.firmware,
      hardware: info.hardware ?? existing?.hardware,
      hostname: info.hostname ?? existing?.hostname,
      model:
        discovery?.md ||
        existing?.model ||
        (info.hardware ? `Tasmota ${info.hardware}` : 'Tasmota'),
      discovery,
      ctx,
      features,
      http: http ?? existing?.http,
      rssi: info.state?.Wifi?.RSSI ?? existing?.rssi,
      uptime: info.state?.Uptime ?? existing?.uptime,
      online: existing?.online ?? null,
    };
    const structureChanged =
      !existing ||
      JSON.stringify(existing.features) !== JSON.stringify(record.features) ||
      existing.name !== record.name ||
      existing.ip !== record.ip ||
      existing.topic !== record.topic ||
      existing.protocol !== record.protocol ||
      existing.firmware !== record.firmware;
    this.records.set(info.mac, record);
    if (!existing) {
      logger.info(`New Tasmota device: ${record.name} (${formatMac(record.mac)}, ${protocol})`);
    }
    if (structureChanged) {
      this.scheduleSave();
      this.schedulePublish();
    }
    await this.setOnline(record, true);
    await this.publishReadings(record, readings);
    return record;
  }

  async publishReadings(record, readings) {
    const ids = this.ids(record.mac);
    const states = readings
      .filter(({ key }) => record.features[key])
      .map(({ key, value }) => ({ device_feature_external_id: ids.feature(key), state: value }));
    if (states.length > 0) {
      await this.gladys.publishChangedStates(states, { heartbeat: STATE_HEARTBEAT_MS });
    }
  }

  /**
   * Apply a STATE / SENSOR / RESULT object to a known record: publish the
   * states, add the features a complete telemetry reveals (a sensor plugged
   * later), fire the scene events.
   */
  async applyPayload(record, kind, payload, { fireEvents = true, learn = false } = {}) {
    const readings = extractReadings(kind, payload, record.ctx ?? undefined);
    if (learn) {
      let added = false;
      for (const { key, spec } of readings) {
        if (!record.features[key]) {
          record.features[key] = spec;
          added = true;
        }
      }
      if (added) {
        this.scheduleSave();
        this.schedulePublish();
      }
    }
    if (kind !== 'sensors') {
      if (payload?.Wifi?.RSSI !== undefined) {
        record.rssi = payload.Wifi.RSSI;
      }
      if (payload?.Uptime !== undefined) {
        record.uptime = payload.Uptime;
      }
    }
    await this.publishReadings(record, readings);
    if (fireEvents) {
      for (const { key, data } of extractEvents(payload)) {
        await this.fireEvent(key, { device: this.ids(record.mac).device, ...data });
      }
    }
  }

  async fireEvent(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.warn(`Scene event ${key} refused: ${err.message}`);
    }
  }

  /** Online/offline transition: transport badge + `availability_changed`. */
  async setOnline(record, online) {
    const previous = record.online;
    record.online = online;
    if (previous === online) {
      return;
    }
    await this.publishTransportsSafe();
    this.onChange?.();
    // No event for the first status after a start: nothing changed, we learnt.
    if (previous === true || previous === false) {
      logger.info(`${record.name} is now ${online ? 'online' : 'offline'}`);
      await this.fireEvent(TRIGGERS.AVAILABILITY, {
        device: this.ids(record.mac).device,
        status: online ? 'online' : 'offline',
      });
    }
  }

  // --- Transport badge ----------------------------------------------------------

  transportOf(record) {
    if (record.protocol === PROTOCOLS.MQTT && !this.mqtt.connected) {
      if (record.ip) {
        return {
          transport: DEVICE_TRANSPORTS.LOCAL,
          degraded: true,
          message: t(
            'MQTT broker unreachable: commands go through HTTP.',
            'Broker MQTT injoignable : les commandes passent par HTTP.',
            'MQTT-Broker nicht erreichbar: Befehle laufen über HTTP.',
            'Broker MQTT inaccesible: los comandos pasan por HTTP.',
          ),
        };
      }
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE };
    }
    if (record.online === false) {
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE };
    }
    return { transport: DEVICE_TRANSPORTS.LOCAL };
  }

  buildTransportEntries() {
    const created = new Set((this.gladys.devices ?? []).map((device) => device.external_id));
    return [...this.records.values()]
      .filter((record) => created.has(this.ids(record.mac).device))
      .map((record) => ({ external_id: this.ids(record.mac).device, ...this.transportOf(record) }));
  }

  async publishTransportsSafe() {
    const entries = this.buildTransportEntries();
    if (entries.length === 0 || !this.gladys.connected) {
      return;
    }
    try {
      for (let i = 0; i < entries.length; i += 100) {
        await this.gladys.publishTransports(entries.slice(i, i + 100));
      }
    } catch (err) {
      logger.warn(`Transport badge publication failed: ${err.message}`);
    }
  }

  // --- MQTT ---------------------------------------------------------------------

  requestStatus(topic, { force = false } = {}) {
    if (!this.mqtt.connected) {
      return;
    }
    const last = this.statusRequests.get(topic);
    if (!force && last && Date.now() - last < STATUS_REQUEST_COOLDOWN_MS) {
      return;
    }
    this.statusRequests.set(topic, Date.now());
    try {
      this.mqtt.publish(this.layout.command(topic, 'STATUS'), '0');
    } catch (err) {
      logger.debug(`Status request to ${topic} failed: ${err.message}`);
    }
  }

  /** Collect the STATUSn pieces of one `Status 0`, build the device once settled. */
  collectStatus(topic, payload) {
    const pending = this.pendingStatus.get(topic) ?? { status: {}, timer: null };
    Object.assign(pending.status, payload);
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      this.pendingStatus.delete(topic);
      if (!isStatusComplete(pending.status)) {
        logger.debug(`Incomplete status from ${topic}, ignored`);
        return;
      }
      this.upsertFromStatus(pending.status, { protocol: PROTOCOLS.MQTT }).catch((err) =>
        logger.error(`Device ${topic} could not be built`, err),
      );
    }, STATUS_SETTLE_MS);
    this.pendingStatus.set(topic, pending);
  }

  async handleMqttMessage(topic, raw) {
    const discoveryTopic = parseDiscoveryTopic(topic);
    if (discoveryTopic) {
      return this.handleDiscoveryMessage(discoveryTopic, raw);
    }
    const parsed = this.layout.parse(topic);
    if (!parsed) {
      return;
    }
    const { prefix, deviceTopic, suffix } = parsed;
    const record = this.recordByTopic(deviceTopic);

    if (prefix === 'stat') {
      this.resolveAnswer(deviceTopic, raw);
    }

    if (suffix === 'LWT') {
      const online = raw.trim().toLowerCase() === 'online';
      if (record) {
        await this.setOnline(record, online);
      }
      if (online) {
        this.requestStatus(deviceTopic);
      }
      return;
    }

    if (prefix === 'stat' && /^STATUS\d*$/.test(suffix)) {
      const payload = safeParse(raw);
      if (payload && typeof payload === 'object') {
        this.collectStatus(deviceTopic, payload);
      }
      return;
    }

    if (!record) {
      // A device we do not know yet speaks: ask who it is.
      if (prefix === 'tele' && (suffix === 'STATE' || suffix === 'SENSOR')) {
        this.requestStatus(deviceTopic);
      }
      return;
    }
    if (record.online !== true) {
      await this.setOnline(record, true);
    }

    // `stat/<topic>/POWER2` = "ON": the plain-text echo of a relay.
    if (prefix === 'stat' && /^POWER\d*$/.test(suffix)) {
      const value = readOnOff(raw.trim());
      if (value !== null) {
        await this.applyPayload(record, 'state', { [suffix]: raw.trim() }, { fireEvents: false });
      }
      return;
    }

    const payload = safeParse(raw);
    if (!payload || typeof payload !== 'object') {
      return;
    }
    if (prefix === 'tele' && suffix === 'STATE') {
      await this.applyPayload(record, 'state', payload, { fireEvents: false, learn: true });
    } else if (prefix === 'tele' && suffix === 'SENSOR') {
      await this.applyPayload(record, 'sensors', payload, { learn: true });
    } else if (suffix === 'RESULT') {
      await this.applyPayload(record, 'any', payload);
    }
  }

  handleDiscoveryMessage({ mac, kind }, raw) {
    const payload = safeParse(raw);
    if (!payload || kind !== 'config') {
      return;
    }
    this.discoveryConfigs.set(mac, payload);
    const record = this.records.get(mac);
    if (record) {
      record.discovery = payload;
    }
    if (typeof payload.t === 'string' && payload.t) {
      this.requestStatus(payload.t);
    }
  }

  /** Resolve the pending `send_command` waiting for an answer of this topic. */
  resolveAnswer(deviceTopic, raw) {
    const waiter = this.answerWaiters.get(deviceTopic);
    if (waiter) {
      this.answerWaiters.delete(deviceTopic);
      clearTimeout(waiter.timer);
      waiter.resolve(raw);
    }
  }

  waitForAnswer(deviceTopic) {
    return new Promise((resolve) => {
      const previous = this.answerWaiters.get(deviceTopic);
      if (previous) {
        clearTimeout(previous.timer);
        previous.resolve(null);
      }
      const timer = setTimeout(() => {
        this.answerWaiters.delete(deviceTopic);
        resolve(null);
      }, COMMAND_ANSWER_TIMEOUT_MS);
      this.answerWaiters.set(deviceTopic, { resolve, timer });
    });
  }

  // --- HTTP ---------------------------------------------------------------------

  credentialsOf(record) {
    return record?.http ?? httpCredentials(this.config);
  }

  /**
   * Probe one address over HTTP and add the device it answers for.
   * @returns {Promise<object>} the record
   * @throws {HttpAuthError} when the device needs other credentials
   */
  async probeHttp(address, credentials = httpCredentials(this.config)) {
    let status;
    try {
      status = await this.http(address, 'Status 0', credentials);
    } catch (err) {
      if (err instanceof HttpAuthError) {
        this.authRequired.add(address);
      }
      throw err;
    }
    this.authRequired.delete(address);
    if (!isStatusComplete(status)) {
      throw new Error(`${address} does not look like a Tasmota device`);
    }
    // Only remember credentials that differ from the configuration ones.
    const defaults = httpCredentials(this.config);
    const http =
      credentials.username !== defaults.username || credentials.password !== defaults.password
        ? { username: credentials.username || '', password: credentials.password || '' }
        : undefined;
    return this.upsertFromStatus(status, { protocol: PROTOCOLS.HTTP, http, address });
  }

  /**
   * Probe many addresses.
   * @returns {Promise<{ found: object[], authRequired: string[] }>}
   */
  async scanHttp(addresses, credentials) {
    const results = await mapLimit(addresses, HTTP_SCAN_CONCURRENCY, (address) =>
      this.probeHttp(address, credentials),
    );
    const found = [];
    const authRequired = [];
    results.forEach((result, i) => {
      if (result.status === 'fulfilled' && result.value) {
        found.push(result.value);
      } else if (result.reason instanceof HttpAuthError) {
        authRequired.push(addresses[i]);
      }
    });
    return { found, authRequired };
  }

  /** Probe the addresses of the configuration in the background. */
  probeConfiguredAddresses() {
    let addresses;
    try {
      addresses = expandAddresses(this.config.http_addresses);
    } catch (err) {
      logger.warn(`HTTP addresses of the configuration: ${err.message}`);
      return Promise.resolve({ found: [], authRequired: [] });
    }
    if (addresses.length === 0) {
      return Promise.resolve({ found: [], authRequired: [] });
    }
    return this.scanHttp(addresses).catch((err) => {
      logger.error('HTTP scan failed', err);
      return { found: [], authRequired: [] };
    });
  }

  /**
   * `onPoll` of an HTTP device, at the interval of the config. Resolves
   * `true` when the device was read.
   */
  async pollDevice(device) {
    const record = this.recordOf(device.external_id);
    if (!record || !record.ip) {
      return false;
    }
    // A device that moved to MQTT pushes its states: nothing to poll, unless
    // the broker is down.
    if (record.protocol === PROTOCOLS.MQTT && this.mqtt.connected) {
      return false;
    }
    const now = Date.now();
    const last = this.lastPolls.get(record.mac);
    if (last !== undefined && now - last < this.config.poll_frequency * 1000 - POLL_TOLERANCE_MS) {
      return false;
    }
    this.lastPolls.set(record.mac, now);
    try {
      const status = await this.http(record.ip, 'Status 0', this.credentialsOf(record));
      this.httpFailures.delete(record.mac);
      const info = parseStatus(status);
      await this.setOnline(record, true);
      if (info.mac && info.mac !== record.mac) {
        // The DHCP lease moved to another device: let the next scan sort it out.
        logger.warn(`${record.ip} now answers for another device (${formatMac(info.mac)})`);
        return true;
      }
      await this.applyPayload(record, 'state', info.state, { fireEvents: false, learn: true });
      await this.applyPayload(record, 'sensors', info.sensors, { learn: true });
      return true;
    } catch (err) {
      const failures = (this.httpFailures.get(record.mac) ?? 0) + 1;
      this.httpFailures.set(record.mac, failures);
      if (failures >= HTTP_OFFLINE_AFTER_FAILURES) {
        await this.setOnline(record, false);
      }
      throw err;
    }
  }

  // --- Commands -------------------------------------------------------------------

  /**
   * Send a command to a device, through MQTT when possible, HTTP otherwise.
   * @param {object} record
   * @param {string} cmnd command name, e.g. "POWER1"
   * @param {string} [payload] command argument, e.g. "ON"
   * @param {{ awaitAnswer?: boolean }} [options]
   * @returns {Promise<string|null>} the raw answer (HTTP, or MQTT with awaitAnswer)
   */
  async command(record, cmnd, payload = '', { awaitAnswer = false } = {}) {
    if (record.topic && this.mqtt.connected && record.protocol === PROTOCOLS.MQTT) {
      const answer = awaitAnswer ? this.waitForAnswer(record.topic) : null;
      this.mqtt.publish(this.layout.command(record.topic, cmnd), String(payload));
      return answer;
    }
    if (record.ip) {
      const full = payload === '' ? cmnd : `${cmnd} ${payload}`;
      const answer = await this.http(record.ip, full, this.credentialsOf(record));
      // The HTTP answer is the RESULT an MQTT device would publish.
      await this.applyPayload(record, 'any', answer, { fireEvents: false });
      return JSON.stringify(answer);
    }
    throw new Error(`${record.name} is unreachable: no MQTT broker and no IP address`);
  }

  requireRecord(externalId) {
    const record = this.recordOf(externalId);
    if (!record) {
      throw new Error(`Unknown Tasmota device: ${externalId}`);
    }
    return record;
  }

  /** `onSetValue`: a Gladys value on a feature -> the Tasmota command. */
  async setValue(device, feature, value) {
    const record = this.requireRecord(device.external_id);
    const key = this.featureKeyOf(feature.external_id);
    const built = key ? buildCommand(key, value) : null;
    if (!built) {
      throw new Error(`Feature ${feature.external_id} cannot be controlled`);
    }
    await this.command(record, built.command, built.payload);
  }

  /** Free command (`send_command` action and scene action). */
  async sendCommand(externalId, cmnd, payload = '') {
    const record = this.requireRecord(externalId);
    const name = String(cmnd ?? '').trim();
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)) {
      throw new Error(`Invalid Tasmota command: ${cmnd}`);
    }
    return this.command(record, name, String(payload ?? '').trim(), { awaitAnswer: true });
  }

  async restart(externalId) {
    const record = this.requireRecord(externalId);
    await this.command(record, 'Restart', '1');
  }

  /**
   * Make a light blink twice (four toggles: it ends as it started).
   * A relay that drives a heater must never blink: only lights signal.
   * @returns {Promise<boolean>} whether the device could signal itself
   */
  async identify(externalId) {
    const record = this.requireRecord(externalId);
    const powerKey = record.ctx?.lightPowerKey;
    if (!record.ctx?.isLight || !powerKey) {
      return false;
    }
    const power = powerKey.replace(/^POWER/i, 'Power');
    const toggle = `${power} TOGGLE`;
    await this.command(
      record,
      'Backlog',
      [toggle, 'Delay 5', toggle, 'Delay 5', toggle, 'Delay 5', toggle].join('; '),
    );
    return true;
  }

  /** Turn a relay on for `seconds`, then off (Backlog + Delay, on the device). */
  async pulse(externalId, relay = 1, seconds = 5) {
    const record = this.requireRecord(externalId);
    const index = Math.max(1, Math.min(32, Math.round(Number(relay) || 1)));
    const duration = Math.max(1, Math.min(MAX_PULSE_SECONDS, Math.round(Number(seconds) || 1)));
    await this.command(
      record,
      'Backlog',
      `Power${index} ON; Delay ${duration * 10}; Power${index} OFF`,
    );
  }

  /** Point a device at a broker (it restarts to apply it). */
  async configureMqtt(externalId, { host, port, username, password, topic }) {
    const record = this.requireRecord(externalId);
    const commands = [`MqttHost ${host}`, `MqttPort ${port}`];
    if (username) {
      commands.push(`MqttUser ${username}`);
    }
    if (password) {
      commands.push(`MqttPassword ${password}`);
    }
    if (topic) {
      commands.push(`Topic ${topic}`);
    }
    await this.command(record, 'Backlog', commands.join('; '));
  }

  // --- Summary (widgets, actions) -------------------------------------------------

  summary() {
    const records = [...this.records.values()];
    return {
      mode: this.config.mqtt_mode,
      mqttUrlMissing: this.config.mqtt_mode === MQTT_MODES.EXTERNAL && !this.config.mqtt_url,
      brokerConnected: this.mqtt.connected,
      brokerError: this.brokerError ?? this.mqtt.lastError?.message ?? null,
      total: records.length,
      online: records.filter((r) => r.online === true).length,
      offline: records.filter((r) => r.online === false).length,
      authRequired: [...this.authRequired],
      records: records.sort((a, b) => a.name.localeCompare(b.name)),
    };
  }
}
