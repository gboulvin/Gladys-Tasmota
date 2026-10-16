// -----------------------------------------------------------------------------
// Tasmota JSON -> Gladys features.
//
// Tasmota describes a device with two JSON objects, the same whatever the
// transport (MQTT or HTTP):
//   - the STATE (`StatusSTS`, `tele/<topic>/STATE`, `stat/<topic>/RESULT`):
//     relays (POWERn), light (Dimmer, Color, CT, Scheme, Speed), fan
//     (FanSpeed), Wi-Fi signal, uptime...;
//   - the SENSORS (`StatusSNS`, `tele/<topic>/SENSOR`): energy metering
//     (ENERGY), climate sensors (AM2301, BME280, DS18B20...), shutters,
//     counters, analog inputs, switch inputs...
//
// This module is PURE (no I/O): `extractReadings` turns one of those objects
// into readings `{ key, spec, value }`, where `key` is the stable feature key
// (the suffix of the feature external_id — forever: never rename one), `spec`
// the Gladys feature definition and `value` the number to publish.
// `buildCommand` goes the other way: a Gladys value -> a Tasmota command.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';

// Values Gladys uses for a shutter state (COVER_STATE in the Gladys core).
export const COVER_STATE = { STOP: 0, OPEN: 1, CLOSE: -1 };

// Relay types of the Tasmota native discovery (`rl` array).
export const RELAY_TYPES = { NONE: 0, RELAY: 1, LIGHT: 2, SHUTTER: 3 };

// Keys of a sensor payload that carry no measurement.
const IGNORED_SENSOR_KEYS = new Set(['Time', 'TempUnit', 'PressureUnit', 'SpeedUnit']);

/** Lowercase, dash-separated slug, safe inside an external id. */
export function slug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function feature(name, category, type, extra = {}) {
  return {
    name,
    category,
    type,
    read_only: true,
    has_feedback: false,
    keep_history: true,
    min: 0,
    max: 100,
    ...extra,
  };
}

function command(name, category, type, extra = {}) {
  return feature(name, category, type, { read_only: false, has_feedback: true, ...extra });
}

function toNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return null;
}

/** "ON" / "OFF" (or 1 / 0) -> 1 / 0, anything else -> null. */
export function readOnOff(value) {
  if (value === 1 || value === 0) {
    return value;
  }
  const text = String(value).toUpperCase();
  if (text === 'ON' || text === '1') {
    return 1;
  }
  if (text === 'OFF' || text === '0') {
    return 0;
  }
  return null;
}

/**
 * Tasmota color -> Gladys integer color (0xRRGGBB).
 * Accepts the hex form ("FF8000", "FF8000FF" with white channels) and the
 * decimal form ("255,128,0", SetOption17 1).
 */
export function readColor(value) {
  if (typeof value !== 'string') {
    return null;
  }
  let rgb;
  if (value.includes(',')) {
    rgb = value.split(',').map(Number);
  } else if (/^#?[0-9a-f]{6,}$/i.test(value)) {
    const hex = value.replace('#', '');
    rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  } else {
    return null;
  }
  if (rgb.length < 3 || rgb.slice(0, 3).some((c) => !Number.isFinite(c))) {
    return null;
  }
  const [r, g, b] = rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))));
  return (r << 16) + (g << 8) + b;
}

/** Gladys integer color -> "r,g,b" for the Tasmota `Color2` command. */
export function writeColor(value) {
  const int = Math.max(0, Math.min(0xffffff, Math.round(Number(value))));
  return `${(int >> 16) & 0xff},${(int >> 8) & 0xff},${int & 0xff}`;
}

/** Does this Tasmota color carry at least 3 channels (an RGB light)? */
function isRgbColor(value) {
  if (typeof value !== 'string') {
    return false;
  }
  return value.includes(',') ? value.split(',').length >= 3 : value.replace('#', '').length >= 6;
}

/** POWER -> '', POWER2 -> '2'. Returns null for a non-power key. */
export function powerIndex(key) {
  const match = /^POWER(\d*)$/i.exec(key);
  return match ? match[1] : null;
}

/**
 * What the device is, deduced from its state (and the native discovery when
 * known): a light? which relay drives it? which relays belong to shutters?
 * @param {object} state StatusSTS-like object
 * @param {object} [discovery] Tasmota native discovery config (`rl`, `lt_st`)
 */
export function analyzeCapabilities(state = {}, discovery = undefined) {
  const powerKeys = Object.keys(state)
    .filter((key) => powerIndex(key) !== null)
    .sort((a, b) => Number(powerIndex(a) || 1) - Number(powerIndex(b) || 1));
  const relayTypes = Array.isArray(discovery?.rl) ? discovery.rl : [];
  const isLight =
    state.Dimmer !== undefined ||
    state.CT !== undefined ||
    isRgbColor(state.Color) ||
    relayTypes.includes(RELAY_TYPES.LIGHT) ||
    Number(discovery?.lt_st) > 0;

  // Which POWER drives the light: the native discovery says it, otherwise
  // Tasmota gives the light the relay index after the plain relays.
  let lightPowerKey = null;
  if (isLight && powerKeys.length > 0) {
    const lightIndex = relayTypes.indexOf(RELAY_TYPES.LIGHT);
    lightPowerKey =
      lightIndex >= 0
        ? (powerKeys.find((key) => Number(powerIndex(key) || 1) === lightIndex + 1) ??
          powerKeys.at(-1))
        : powerKeys.at(-1);
  }

  // Relays driven by a shutter are not exposed as switches.
  const shutterRelays = relayTypes
    .map((type, i) => (type === RELAY_TYPES.SHUTTER ? i + 1 : null))
    .filter((index) => index !== null);

  return {
    isLight,
    lightPowerKey,
    shutterRelays,
    // Addressable LED strips (WS2812) offer more schemes than the 0-4 of the others.
    schemeMax: state.Width1 !== undefined ? 12 : 4,
  };
}

function numbered(name, index) {
  return index ? `${name} ${index}` : name;
}

// --- STATE --------------------------------------------------------------------

function stateReadings(state, ctx) {
  const readings = [];
  for (const [key, raw] of Object.entries(state)) {
    const index = powerIndex(key);
    if (index !== null) {
      if (ctx.shutterRelays.includes(Number(index || 1))) {
        continue;
      }
      const value = readOnOff(raw);
      if (value === null) {
        continue;
      }
      const isLightPower = ctx.isLight && key === ctx.lightPowerKey;
      readings.push({
        key: `power${index}`,
        spec: isLightPower
          ? command('Light', C.LIGHT, T.LIGHT.BINARY, { max: 1 })
          : command(numbered('Switch', index), C.SWITCH, T.SWITCH.BINARY, { max: 1 }),
        value,
      });
    }
  }

  const dimmer = toNumber(state.Dimmer);
  if (dimmer !== null) {
    readings.push({
      key: 'dimmer',
      spec: command('Brightness', C.LIGHT, T.LIGHT.BRIGHTNESS, { unit: U.PERCENT }),
      value: dimmer,
    });
  }
  if (isRgbColor(state.Color)) {
    const color = readColor(state.Color);
    if (color !== null) {
      readings.push({
        key: 'color',
        spec: command('Color', C.LIGHT, T.LIGHT.COLOR, { max: 0xffffff }),
        value: color,
      });
    }
  }
  const ct = toNumber(state.CT);
  if (ct !== null) {
    readings.push({
      key: 'ct',
      spec: command('Color temperature', C.LIGHT, T.LIGHT.TEMPERATURE, { min: 153, max: 500 }),
      value: ct,
    });
  }
  const scheme = toNumber(state.Scheme);
  if (scheme !== null && ctx.isLight) {
    readings.push({
      key: 'scheme',
      spec: command('Effect', C.LIGHT, T.LIGHT.EFFECT_MODE, { max: ctx.schemeMax }),
      value: scheme,
    });
  }
  const speed = toNumber(state.Speed);
  if (speed !== null && ctx.isLight) {
    readings.push({
      key: 'speed',
      spec: command('Effect speed', C.LIGHT, T.LIGHT.EFFECT_SPEED, { min: 1, max: 40 }),
      value: speed,
    });
  }
  const fanSpeed = toNumber(state.FanSpeed);
  if (fanSpeed !== null) {
    // Tasmota FanSpeed 0-3 matches the Gladys FAN_MODE (off, low, medium, high).
    readings.push({
      key: 'fanspeed',
      spec: command('Fan speed', C.FAN, T.FAN.MODE, { max: 3 }),
      value: fanSpeed,
    });
  }
  const rssi = toNumber(state.Wifi?.RSSI);
  if (rssi !== null) {
    readings.push({
      key: 'rssi',
      spec: feature('Wi-Fi signal', C.SIGNAL, T.SIGNAL.QUALITY, {
        unit: U.PERCENT,
        keep_history: false,
      }),
      value: rssi,
    });
  }
  const uptime = toNumber(state.UptimeSec);
  if (uptime !== null) {
    readings.push({
      key: 'uptime',
      spec: feature('Uptime', C.DURATION, T.DURATION.INTEGER, {
        unit: U.SECONDS,
        max: 1e10,
        keep_history: false,
      }),
      value: uptime,
    });
  }
  return readings;
}

// --- SENSORS ------------------------------------------------------------------

// Energy metering: `ENERGY.<field>`, a number or an array (one per channel).
const ENERGY_FIELDS = {
  Power: (n) => feature(n('Power'), C.ENERGY_SENSOR, T.ENERGY_SENSOR.POWER, { unit: U.WATT }),
  ApparentPower: (n) =>
    feature(n('Apparent power'), C.ENERGY_SENSOR, T.ENERGY_SENSOR.POWER, { unit: U.VOLT_AMPERE }),
  ReactivePower: (n) =>
    feature(n('Reactive power'), C.ENERGY_SENSOR, T.ENERGY_SENSOR.POWER, {
      unit: U.VOLT_AMPERE_REACTIVE,
    }),
  Voltage: (n) =>
    feature(n('Voltage'), C.ENERGY_SENSOR, T.ENERGY_SENSOR.VOLTAGE, { unit: U.VOLT, max: 500 }),
  Current: (n) =>
    feature(n('Current'), C.ENERGY_SENSOR, T.ENERGY_SENSOR.CURRENT, { unit: U.AMPERE }),
  Today: (n) =>
    feature(n('Energy today'), C.ENERGY_SENSOR, T.ENERGY_SENSOR.INDEX_TODAY, {
      unit: U.KILOWATT_HOUR,
    }),
  Yesterday: (n) =>
    feature(n('Energy yesterday'), C.ENERGY_SENSOR, T.ENERGY_SENSOR.INDEX_YESTERDAY, {
      unit: U.KILOWATT_HOUR,
      keep_history: false,
    }),
  // The Total counter is a cumulative index: what the Gladys energy
  // monitoring derives the consumption from.
  Total: (n) =>
    feature(n('Energy total'), C.ENERGY_SENSOR, T.ENERGY_SENSOR.INDEX, { unit: U.KILOWATT_HOUR }),
};

const ENERGY_MAX = {
  Power: 100000,
  ApparentPower: 100000,
  ReactivePower: 100000,
  Current: 1000,
  Today: 1e6,
  Yesterday: 1e6,
  Total: 1e9,
};

function energyReadings(energy) {
  const readings = [];
  for (const [field, build] of Object.entries(ENERGY_FIELDS)) {
    const raw = energy[field];
    if (raw === undefined || raw === null) {
      continue;
    }
    const values = Array.isArray(raw) ? raw : [raw];
    values.forEach((rawValue, i) => {
      const value = toNumber(rawValue);
      if (value === null) {
        return;
      }
      const channel = Array.isArray(raw) && raw.length > 1 ? i + 1 : 0;
      const spec = build((name) => numbered(name, channel));
      if (ENERGY_MAX[field]) {
        spec.max = ENERGY_MAX[field];
      }
      readings.push({
        key: `energy-${slug(field)}${channel ? `-${channel}` : ''}`,
        spec,
        value,
      });
    });
  }
  return readings;
}

// Measurements a climate / environment sensor object can carry.
function measurementSpec(sensor, field, value, ctx) {
  const label = (name) => `${name} (${sensor})`;
  switch (field) {
    case 'Temperature':
      if (sensor === 'ESP32' || sensor === 'ESP8266') {
        return feature('Device temperature', C.DEVICE_TEMPERATURE_SENSOR, T.SENSOR.DECIMAL, {
          unit: U.CELSIUS,
          min: -40,
          max: 150,
        });
      }
      return feature(label('Temperature'), C.TEMPERATURE_SENSOR, T.SENSOR.DECIMAL, {
        unit: ctx.tempUnit === 'F' ? U.FAHRENHEIT : U.CELSIUS,
        min: -55,
        max: 150,
      });
    case 'Humidity':
      return feature(label('Humidity'), C.HUMIDITY_SENSOR, T.SENSOR.DECIMAL, { unit: U.PERCENT });
    case 'Pressure':
      // Only hPa maps to a Gladys unit (PressureUnit can also be mmHg / inHg).
      return ctx.pressureUnit === undefined || ctx.pressureUnit === 'hPa'
        ? feature(label('Pressure'), C.PRESSURE_SENSOR, T.SENSOR.DECIMAL, {
            unit: U.HECTO_PASCAL,
            min: 300,
            max: 1200,
          })
        : null;
    case 'Illuminance':
      return feature(label('Illuminance'), C.LIGHT_SENSOR, T.SENSOR.DECIMAL, {
        unit: U.LUX,
        max: 200000,
      });
    case 'CarbonDioxide':
    case 'eCO2':
      return feature(label('CO2'), C.CO2_SENSOR, T.SENSOR.INTEGER, { unit: U.PPM, max: 10000 });
    case 'TVOC':
      return feature(label('VOC'), C.VOC_SENSOR, T.VOC_SENSOR.DECIMAL, { unit: U.PPB, max: 60000 });
    case 'PM2.5':
      return feature(label('PM2.5'), C.PM25_SENSOR, T.SENSOR.INTEGER, {
        unit: U.MICROGRAM_PER_CUBIC_METER,
        max: 1000,
      });
    case 'PM10':
      return feature(label('PM10'), C.PM10_SENSOR, T.SENSOR.INTEGER, {
        unit: U.MICROGRAM_PER_CUBIC_METER,
        max: 1000,
      });
    case 'Distance':
      return feature(label('Distance'), C.DISTANCE_SENSOR, T.SENSOR.DECIMAL, {
        unit: sensor.startsWith('VL53') ? U.MM : U.CM,
        max: 10000,
      });
    case 'UvIndex':
      return feature(label('UV index'), C.UV_SENSOR, T.UV_SENSOR.INTEGER, {
        unit: U.UV_INDEX,
        max: 20,
      });
    case 'Moisture':
      return feature(label('Soil moisture'), C.SOIL_MOISTURE_SENSOR, T.SENSOR.DECIMAL, {
        unit: U.PERCENT,
      });
    default:
      // Analog inputs (ANALOG.A0) and pulse counters (COUNTER.C1).
      if (sensor === 'ANALOG' && /^A\d+$/.test(field)) {
        return feature(`Analog ${field}`, C.UNKNOWN, T.UNKNOWN.UNKNOWN, { max: 65535 });
      }
      if (sensor === 'COUNTER' && /^C\d+$/.test(field) && Number.isInteger(value)) {
        return feature(`Counter ${field.slice(1)}`, C.COUNTER_SENSOR, T.SENSOR.INTEGER, {
          max: 1e9,
        });
      }
      return null;
  }
}

function shutterReadings(name, shutter) {
  const index = name.replace(/^Shutter/, '');
  const readings = [];
  const position = toNumber(shutter.Position);
  if (position !== null) {
    readings.push({
      key: `shutter${index}-position`,
      spec: command(numbered('Shutter position', index), C.SHUTTER, T.SHUTTER.POSITION, {
        unit: U.PERCENT,
      }),
      value: position,
    });
  }
  const direction = toNumber(shutter.Direction);
  if (direction !== null) {
    readings.push({
      key: `shutter${index}-state`,
      spec: command(numbered('Shutter', index), C.SHUTTER, T.SHUTTER.STATE, { min: -1, max: 1 }),
      value: Math.sign(direction),
    });
  }
  return readings;
}

function sensorReadings(sensors, ctx) {
  const readings = [];
  const sensorCtx = {
    ...ctx,
    tempUnit: sensors.TempUnit ?? ctx.tempUnit,
    pressureUnit: sensors.PressureUnit ?? ctx.pressureUnit,
  };
  for (const [name, content] of Object.entries(sensors)) {
    if (IGNORED_SENSOR_KEYS.has(name)) {
      continue;
    }
    if (name === 'ENERGY' && content && typeof content === 'object') {
      readings.push(...energyReadings(content));
      continue;
    }
    if (/^Shutter\d+$/.test(name) && content && typeof content === 'object') {
      readings.push(...shutterReadings(name, content));
      continue;
    }
    // Switch inputs reported in the sensors (SwitchMode + SwitchTopic 0).
    if (/^Switch\d+$/.test(name) && typeof content === 'string') {
      const value = readOnOff(content);
      if (value !== null) {
        readings.push({
          key: `input${name.slice(6)}`,
          spec: feature(`Input ${name.slice(6)}`, C.INPUT, T.INPUT.BINARY, { max: 1 }),
          value,
        });
      }
      continue;
    }
    if (!content || typeof content !== 'object' || Array.isArray(content)) {
      continue;
    }
    for (const [field, raw] of Object.entries(content)) {
      const value = toNumber(raw);
      if (value === null) {
        continue;
      }
      const spec = measurementSpec(name, field, value, sensorCtx);
      if (!spec) {
        continue;
      }
      const key =
        spec.category === C.DEVICE_TEMPERATURE_SENSOR
          ? 'device-temperature'
          : `${slug(name)}-${slug(field)}`;
      readings.push({ key, spec, value });
    }
  }
  return readings;
}

/**
 * Readings of a Tasmota object. `kind` says which object it is:
 * 'state' (StatusSTS, STATE, RESULT) or 'sensors' (StatusSNS, SENSOR).
 * A RESULT can carry both (a shutter answers with its sensor-like object):
 * pass 'any' to try both grammars.
 * @returns {{ key: string, spec: object, value: number }[]}
 */
export function extractReadings(kind, payload, ctx = analyzeCapabilities(payload)) {
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  const fullCtx = { shutterRelays: [], schemeMax: 4, ...ctx };
  const readings = [];
  if (kind === 'state' || kind === 'any') {
    readings.push(...stateReadings(payload, fullCtx));
  }
  if (kind === 'sensors' || kind === 'any') {
    readings.push(...sensorReadings(payload, fullCtx));
  }
  // One reading per key (the first wins): a feature external id is unique.
  const seen = new Set();
  return readings.filter(({ key }) => (seen.has(key) ? false : seen.add(key)));
}

// --- Commands -----------------------------------------------------------------

/**
 * Gladys value on a feature -> Tasmota command.
 * @param {string} key feature key (suffix of the feature external_id)
 * @param {number} value Gladys value
 * @returns {{ command: string, payload: string } | null}
 */
export function buildCommand(key, value) {
  const number = Number(value);
  let match = /^power(\d*)$/.exec(key);
  if (match) {
    return { command: `POWER${match[1]}`, payload: number ? 'ON' : 'OFF' };
  }
  match = /^shutter(\d+)-position$/.exec(key);
  if (match) {
    return { command: `ShutterPosition${match[1]}`, payload: String(clamp(number, 0, 100)) };
  }
  match = /^shutter(\d+)-state$/.exec(key);
  if (match) {
    const verb =
      number === COVER_STATE.OPEN
        ? 'ShutterOpen'
        : number === COVER_STATE.CLOSE
          ? 'ShutterClose'
          : 'ShutterStop';
    return { command: `${verb}${match[1]}`, payload: '' };
  }
  switch (key) {
    case 'dimmer':
      return { command: 'Dimmer', payload: String(clamp(number, 0, 100)) };
    case 'color':
      // Color2 keeps the current brightness, as a Gladys color picker expects.
      return { command: 'Color2', payload: writeColor(number) };
    case 'ct':
      return { command: 'CT', payload: String(clamp(number, 153, 500)) };
    case 'scheme':
      return { command: 'Scheme', payload: String(clamp(number, 0, 12)) };
    case 'speed':
      return { command: 'Speed', payload: String(clamp(number, 1, 40)) };
    case 'fanspeed':
      return { command: 'FanSpeed', payload: String(clamp(number, 0, 3)) };
    default:
      return null;
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}
