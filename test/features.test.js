import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
} from '@gladysassistant/integration-sdk';
import {
  analyzeCapabilities,
  buildCommand,
  COVER_STATE,
  extractReadings,
  readColor,
  writeColor,
} from '../src/tasmota/features.js';
import { extractEvents, TRIGGERS } from '../src/tasmota/events.js';
import { isStatusComplete, normalizeMac, parseStatus } from '../src/tasmota/status.js';
import { bulbStatus, plugStatus, shutterStatus } from './helpers.js';

const byKey = (readings) => Object.fromEntries(readings.map((r) => [r.key, r]));

test('a plug exposes its relay as a switch, with energy and climate sensors', () => {
  const status = plugStatus();
  const ctx = analyzeCapabilities(status.StatusSTS);
  const readings = byKey([
    ...extractReadings('state', status.StatusSTS, ctx),
    ...extractReadings('sensors', status.StatusSNS, ctx),
  ]);
  assert.equal(readings.power.spec.category, C.SWITCH);
  assert.equal(readings.power.value, 1);
  assert.equal(readings['energy-power'].value, 42);
  assert.equal(readings['energy-power'].spec.unit, 'watt');
  assert.equal(readings['energy-total'].spec.type, T.ENERGY_SENSOR.INDEX);
  assert.equal(readings['energy-today'].spec.type, T.ENERGY_SENSOR.INDEX_TODAY);
  assert.equal(readings['energy-voltage'].value, 231);
  assert.equal(readings['energy-apparentpower'].spec.unit, 'volt-ampere');
  assert.equal(readings['am2301-temperature'].value, 21.5);
  assert.equal(readings['am2301-temperature'].spec.unit, 'celsius');
  assert.equal(readings['am2301-humidity'].spec.category, C.HUMIDITY_SENSOR);
  assert.equal(readings['am2301-dewpoint'], undefined, 'the dew point is not a room temperature');
  assert.equal(readings.rssi.value, 80);
  assert.equal(readings.uptime.value, 3600);
});

test('a bulb is a light: power, brightness, color, temperature, effects', () => {
  const { StatusSTS } = bulbStatus();
  const ctx = analyzeCapabilities(StatusSTS);
  assert.equal(ctx.isLight, true);
  assert.equal(ctx.lightPowerKey, 'POWER');
  const readings = byKey(extractReadings('state', StatusSTS, ctx));
  assert.equal(readings.power.spec.category, C.LIGHT);
  assert.equal(readings.power.spec.type, T.LIGHT.BINARY);
  assert.equal(readings.dimmer.spec.type, T.LIGHT.BRIGHTNESS);
  assert.equal(readings.color.value, 0xff8000);
  assert.equal(readings.ct.value, 250);
  assert.equal(readings.scheme.spec.type, T.LIGHT.EFFECT_MODE);
  assert.equal(readings.speed.spec.type, T.LIGHT.EFFECT_SPEED);
});

test('with relays and a light, the light takes the last relay', () => {
  const ctx = analyzeCapabilities({ POWER1: 'ON', POWER2: 'OFF', Dimmer: 10 });
  assert.equal(ctx.lightPowerKey, 'POWER2');
  const readings = byKey(extractReadings('state', { POWER1: 'ON', POWER2: 'OFF' }, ctx));
  assert.equal(readings.power1.spec.category, C.SWITCH);
  assert.equal(readings.power2.spec.category, C.LIGHT);
});

test('the native discovery says which relay drives the light and which ones a shutter', () => {
  const ctx = analyzeCapabilities(
    { POWER1: 'ON', POWER2: 'OFF', POWER3: 'OFF', Dimmer: 5 },
    {
      rl: [2, 3, 3],
    },
  );
  assert.equal(ctx.lightPowerKey, 'POWER1');
  assert.deepEqual(ctx.shutterRelays, [2, 3]);
  const keys = extractReadings('state', { POWER1: 'ON', POWER2: 'OFF', POWER3: 'OFF' }, ctx).map(
    (r) => r.key,
  );
  assert.deepEqual(keys, ['power1'], 'the shutter relays are not switches');
});

test('a shutter exposes its position and its state', () => {
  const { StatusSNS } = shutterStatus();
  const readings = byKey(extractReadings('sensors', StatusSNS));
  assert.equal(readings['shutter1-position'].value, 40);
  assert.equal(readings['shutter1-position'].spec.read_only, false);
  assert.equal(readings['shutter1-state'].value, COVER_STATE.STOP);
  const opening = byKey(extractReadings('sensors', { Shutter1: { Position: 50, Direction: 1 } }));
  assert.equal(opening['shutter1-state'].value, COVER_STATE.OPEN);
});

test('multi-channel energy meters get one feature per channel', () => {
  const readings = byKey(extractReadings('sensors', { ENERGY: { Power: [10, 20], Voltage: 230 } }));
  assert.equal(readings['energy-power-1'].value, 10);
  assert.equal(readings['energy-power-2'].value, 20);
  assert.equal(readings['energy-power-2'].spec.name, 'Power 2');
  assert.equal(readings['energy-voltage'].value, 230);
});

test('environment sensors map to their Gladys categories', () => {
  const readings = byKey(
    extractReadings('sensors', {
      BME280: { Temperature: 70.1, Humidity: 40, Pressure: 1013.2 },
      BH1750: { Illuminance: 320 },
      SCD30: { CarbonDioxide: 650 },
      SDS0X1: { 'PM2.5': 12, PM10: 20 },
      SR04: { Distance: 12.5 },
      ESP32: { Temperature: 45 },
      ANALOG: { A0: 512 },
      COUNTER: { C1: 1234 },
      Switch1: 'ON',
      TempUnit: 'F',
    }),
  );
  assert.equal(readings['bme280-temperature'].spec.unit, 'fahrenheit');
  assert.equal(readings['bme280-pressure'].spec.unit, 'hPa');
  assert.equal(readings['bh1750-illuminance'].spec.category, C.LIGHT_SENSOR);
  assert.equal(readings['scd30-carbondioxide'].spec.category, C.CO2_SENSOR);
  assert.equal(readings['sds0x1-pm2-5'].spec.category, C.PM25_SENSOR);
  assert.equal(readings['sds0x1-pm10'].spec.category, C.PM10_SENSOR);
  assert.equal(readings['sr04-distance'].spec.unit, 'cm');
  assert.equal(readings['device-temperature'].spec.category, C.DEVICE_TEMPERATURE_SENSOR);
  assert.equal(readings['analog-a0'].value, 512);
  assert.equal(readings['counter-c1'].spec.category, C.COUNTER_SENSOR);
  assert.equal(readings.input1.value, 1);
});

test('a pressure in mmHg is ignored rather than published in the wrong unit', () => {
  const readings = extractReadings('sensors', { BMP280: { Pressure: 760 }, PressureUnit: 'mmHg' });
  assert.deepEqual(readings, []);
});

test('feature keys never depend on what the device is', () => {
  // A partial RESULT ({"POWER":"ON"}) must land on the same key as the full status.
  const full = extractReadings('state', bulbStatus().StatusSTS).find((r) => r.key === 'power');
  const partial = extractReadings('any', { POWER: 'ON' }).find((r) => r.key === 'power');
  assert.ok(full && partial);
});

test('colors convert both ways', () => {
  assert.equal(readColor('FF8000'), 0xff8000);
  assert.equal(readColor('255,128,0'), 0xff8000);
  assert.equal(readColor('#00FF00FF'), 0x00ff00);
  assert.equal(readColor('zz'), null);
  assert.equal(writeColor(0xff8000), '255,128,0');
});

test('buildCommand translates every controllable feature', () => {
  assert.deepEqual(buildCommand('power', 1), { command: 'POWER', payload: 'ON' });
  assert.deepEqual(buildCommand('power2', 0), { command: 'POWER2', payload: 'OFF' });
  assert.deepEqual(buildCommand('dimmer', 140), { command: 'Dimmer', payload: '100' });
  assert.deepEqual(buildCommand('color', 0xff0000), { command: 'Color2', payload: '255,0,0' });
  assert.deepEqual(buildCommand('ct', 100), { command: 'CT', payload: '153' });
  assert.deepEqual(buildCommand('fanspeed', 2), { command: 'FanSpeed', payload: '2' });
  assert.deepEqual(buildCommand('shutter1-position', 30), {
    command: 'ShutterPosition1',
    payload: '30',
  });
  assert.equal(buildCommand('shutter1-state', COVER_STATE.OPEN).command, 'ShutterOpen1');
  assert.equal(buildCommand('shutter1-state', COVER_STATE.CLOSE).command, 'ShutterClose1');
  assert.equal(buildCommand('shutter1-state', COVER_STATE.STOP).command, 'ShutterStop1');
  assert.equal(buildCommand('energy-power', 1), null, 'a sensor is not controllable');
});

test('events: buttons, switches, RF and IR codes', () => {
  assert.deepEqual(extractEvents({ Button2: { Action: 'DOUBLE' } }), [
    { key: TRIGGERS.BUTTON, data: { button: 2, action: 'DOUBLE' } },
  ]);
  assert.deepEqual(extractEvents({ Switch1: { Action: 'TOGGLE' } }), [
    { key: TRIGGERS.SWITCH, data: { switch: 1, action: 'TOGGLE' } },
  ]);
  assert.deepEqual(extractEvents({ RfReceived: { Sync: 9000, Data: 'E5CD7E', RfKey: 'None' } }), [
    { key: TRIGGERS.RF, data: { code: 'E5CD7E', rf_key: 'None' } },
  ]);
  assert.deepEqual(
    extractEvents({ IrReceived: { Protocol: 'NEC', Bits: 32, Data: '0x00FF30CF' } }),
    [{ key: TRIGGERS.IR, data: { code: '0x00FF30CF', protocol: 'NEC' } }],
  );
  assert.deepEqual(extractEvents({ POWER: 'ON' }), [], 'a state is not an event');
});

test('parseStatus reads the identity of a device', () => {
  const info = parseStatus(plugStatus());
  assert.equal(info.mac, '84f3eb12abcd');
  assert.equal(info.name, 'Kitchen plug');
  assert.equal(info.topic, 'plug');
  assert.equal(info.ip, '192.168.1.20');
  assert.equal(info.firmware, '14.2.0(release-tasmota)');
  assert.equal(isStatusComplete(plugStatus()), true);
  assert.equal(isStatusComplete({ Status: {} }), false);
  assert.equal(normalizeMac('84-F3-EB-12-AB-CD'), '84f3eb12abcd');
  assert.equal(normalizeMac('nope'), null);
});
