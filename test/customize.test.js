// Feature customization: rename a feature, make a relay a switch or a light
// (the feature editing of the native Tasmota integration).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  validateWidgetContent,
} from '@gladysassistant/integration-sdk';
import {
  applyOverrides,
  isRelayKey,
  lightRelayKeys,
  nextOverride,
  resolveFeatureKey,
} from '../src/tasmota/customize.js';
import { ACTIONS, customizeMessage } from '../src/actions.js';
import { createWidgets, DEVICE_WIDGET } from '../src/widgets.js';
import { LANGUAGES } from '../src/i18n.js';
import { createManager, discoverOverMqtt, PLUG_MAC, plugStatus } from './helpers.js';

const timers = { apis: ['setTimeout', 'Date'] };

const switchSpec = (name) => ({
  name,
  category: C.SWITCH,
  type: T.SWITCH.BINARY,
  read_only: false,
  min: 0,
  max: 1,
});
const FEATURES = {
  power1: switchSpec('Switch 1'),
  power2: switchSpec('Switch 2'),
  'energy-power': { name: 'Power', category: C.ENERGY_SENSOR, type: T.ENERGY_SENSOR.POWER },
};

/** A two-relay device (Sonoff Dual style). */
function dualStatus() {
  const status = plugStatus();
  status.StatusSTS = { POWER1: 'ON', POWER2: 'OFF', Wifi: { RSSI: 70 } };
  return status;
}

test('without override the features are published as extracted', () => {
  assert.deepEqual(applyOverrides(FEATURES), FEATURES);
  assert.deepEqual(applyOverrides(FEATURES, undefined, { so: { 30: 0 } }), FEATURES);
});

test('a relay made a light becomes a light binary feature, with a light name', () => {
  const effective = applyOverrides(FEATURES, { power2: { category: 'light' } });
  assert.equal(effective.power2.category, C.LIGHT);
  assert.equal(effective.power2.type, T.LIGHT.BINARY);
  assert.equal(effective.power2.name, 'Light 2');
  assert.equal(effective.power1.category, C.SWITCH, 'the other relay is untouched');
  assert.equal(FEATURES.power2.category, C.SWITCH, 'the extracted specs are never modified');
});

test('a light relay can be made a switch back, and a name wins over the default', () => {
  const lightFeatures = {
    power: { ...switchSpec('Light'), category: C.LIGHT, type: T.LIGHT.BINARY },
  };
  const effective = applyOverrides(lightFeatures, {
    power: { category: 'switch', name: 'Heater' },
  });
  assert.equal(effective.power.category, C.SWITCH);
  assert.equal(effective.power.type, T.SWITCH.BINARY);
  assert.equal(effective.power.name, 'Heater');
});

test('SetOption30 1 publishes every relay as a light, unless the user decided otherwise', () => {
  const effective = applyOverrides(FEATURES, { power1: { category: 'switch' } }, { so: { 30: 1 } });
  assert.equal(effective.power1.category, C.SWITCH);
  assert.equal(effective.power2.category, C.LIGHT);
  assert.deepEqual(lightRelayKeys(effective), ['power2']);
});

test('any feature can be renamed, only a relay can change type', () => {
  const effective = applyOverrides(FEATURES, { 'energy-power': { name: 'Washing machine' } });
  assert.equal(effective['energy-power'].name, 'Washing machine');
  assert.equal(effective['energy-power'].category, C.ENERGY_SENSOR);
  assert.equal(isRelayKey('power'), true);
  assert.equal(isRelayKey('power12'), true);
  assert.equal(isRelayKey('energy-power'), false);
});

test('the feature is found by key, name (any case) or relay number', () => {
  assert.equal(resolveFeatureKey(FEATURES, 'power2'), 'power2');
  assert.equal(resolveFeatureKey(FEATURES, 'switch 2'), 'power2');
  assert.equal(resolveFeatureKey(FEATURES, ' 2 '), 'power2');
  assert.equal(resolveFeatureKey({ power: switchSpec('Switch') }, '1'), 'power');
  assert.equal(resolveFeatureKey(FEATURES, 'Power'), 'energy-power');
  assert.equal(resolveFeatureKey(FEATURES, '9'), undefined);
  assert.equal(resolveFeatureKey(FEATURES, ''), undefined);
  const twins = { a: switchSpec('Same'), b: switchSpec('Same') };
  assert.equal(resolveFeatureKey(twins, 'Same'), undefined, 'an ambiguous name matches nothing');
});

test('nextOverride sets, keeps and resets the name and the type', () => {
  assert.deepEqual(nextOverride('power2', undefined, { type: 'light' }).override, {
    category: 'light',
  });
  assert.deepEqual(
    nextOverride('power2', { category: 'light' }, { name: '  Lamp  ', type: 'unchanged' }).override,
    { category: 'light', name: 'Lamp' },
  );
  assert.deepEqual(
    nextOverride('power2', { category: 'light', name: 'Lamp' }, { name: '-' }).override,
    {
      category: 'light',
    },
  );
  assert.equal(nextOverride('power2', { category: 'light' }, { type: 'auto' }).override, undefined);
  assert.equal(
    nextOverride('power2', undefined, { name: 'x'.repeat(300) }).override.name.length,
    100,
  );
  assert.equal(nextOverride('energy-power', undefined, { type: 'light' }).error, 'type-not-relay');
  assert.equal(nextOverride('power2', undefined, { type: 'heater' }).error, 'type-invalid');
});

test('customizing publishes the new definition and keeps it in /data', async (t) => {
  t.mock.timers.enable(timers);
  const { gladys, manager, mqtt } = await createManager();
  t.after(() => manager.stop());
  await discoverOverMqtt(t, manager, mqtt, 'plug', dualStatus());
  const device = manager.ids(PLUG_MAC).device;

  const result = await manager.customizeFeature(device, {
    feature: '2',
    name: 'Living room lamp',
    type: 'light',
  });
  assert.equal(result.key, 'power2');
  assert.equal(result.before.category, C.SWITCH);
  assert.equal(result.after.category, C.LIGHT);
  assert.equal(result.created, false);

  const published = gladys.fake.discoveredDevices[0].features.find((f) =>
    f.external_id.endsWith(':power2'),
  );
  assert.equal(published.category, C.LIGHT);
  assert.equal(published.name, 'Living room lamp');
  assert.equal(published.external_id, manager.ids(PLUG_MAC).feature('power2'), 'same feature');

  const store = JSON.parse(await readFile(join(manager.dataDir, 'devices.json'), 'utf8'));
  assert.deepEqual(store.devices[0].overrides, {
    power2: { category: 'light', name: 'Living room lamp' },
  });

  // A fresh status (the device restarts) keeps the customization.
  await discoverOverMqtt(t, manager, mqtt, 'plug', dualStatus());
  assert.equal(manager.effectiveFeatures(manager.records.get(PLUG_MAC)).power2.category, C.LIGHT);
});

test('identify blinks a relay the user made a light, and the widget offers it', async (t) => {
  t.mock.timers.enable(timers);
  const { manager, mqtt } = await createManager();
  t.after(() => manager.stop());
  await discoverOverMqtt(t, manager, mqtt, 'plug', dualStatus());
  const device = manager.ids(PLUG_MAC).device;
  assert.equal(await manager.identify(device), false, 'two plain relays never blink');

  await manager.customizeFeature(device, { feature: 'Switch 2', type: 'light' });
  assert.equal(await manager.identify(device), true);
  assert.match(mqtt.published.at(-1).payload, /^Power2 TOGGLE/);

  const content = await createWidgets(manager)[DEVICE_WIDGET].get({ settings: { device } });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.ok(content.components.some((c) => c.type === 'button' && c.action?.key === 'identify'));
  assert.ok(
    content.components.some((c) => c.type === 'value' && c.label === 'Light 2'),
    'the widget shows the published name',
  );
});

test('the customize_feature action explains what changed and what to do next', async (t) => {
  t.mock.timers.enable(timers);
  const { gladys, manager, mqtt } = await createManager();
  t.after(() => manager.stop());
  await discoverOverMqtt(t, manager, mqtt, 'plug', dualStatus());
  const device = manager.ids(PLUG_MAC).device;

  const notCreated = await ACTIONS.customize_feature(manager, {
    fields: { device, feature: '1', type: 'light' },
    gladys,
  });
  assert.match(notCreated.en, /"Switch 1" is now "Light 1" \(light\)\. It applies when you add/);

  const unknown = await ACTIONS.customize_feature(manager, {
    fields: { device, feature: 'Nope', name: 'x' },
    gladys,
  });
  assert.match(unknown.fr, /Aucune fonctionnalité « Nope ».*Switch 2/);

  const notRelay = await ACTIONS.customize_feature(manager, {
    fields: { device, feature: 'Power', type: 'switch' },
    gladys,
  });
  assert.match(notRelay.en, /Only a relay/);

  for (const message of [notCreated, unknown, notRelay]) {
    for (const lang of LANGUAGES) {
      assert.equal(typeof message[lang], 'string', `missing ${lang}`);
    }
  }
  await assert.rejects(
    ACTIONS.customize_feature(manager, { fields: { device: 'ext:nope', feature: '1' }, gladys }),
    /Unknown Tasmota device/,
  );
});

test('the message tells to click Update for a type change, and warns for a name alone', () => {
  const sw = switchSpec('Switch 2');
  const light = { ...sw, name: 'Light 2', category: C.LIGHT };
  assert.match(customizeMessage({ before: sw, after: light, created: true }).en, /click Update/);
  const renamed = customizeMessage({ before: sw, after: { ...sw, name: 'Pump' }, created: true });
  assert.match(renamed.en, /only offers Update for a type change/);
  assert.match(customizeMessage({ before: sw, after: sw, created: true }).de, /Nichts geändert/);
});
