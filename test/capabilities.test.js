// Scene actions, manifest actions and dashboard widgets, against a manager
// fed with real-life payloads.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { ACTIONS } from '../src/actions.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import {
  createWidgets,
  DEVICE_WIDGET,
  ENERGY_WIDGET,
  OVERVIEW_WIDGET,
  refreshWidgets,
} from '../src/widgets.js';
import { connectionStatusOf } from '../src/status-message.js';
import { LANGUAGES } from '../src/i18n.js';
import { bulbStatus, createManager, discoverOverMqtt, PLUG_MAC, plugStatus } from './helpers.js';

const timers = { apis: ['setTimeout', 'Date'] };

async function setup(t, options) {
  t.mock.timers.enable(timers);
  const context = await createManager(options);
  await discoverOverMqtt(t, context.manager, context.mqtt, 'plug', plugStatus());
  await discoverOverMqtt(t, context.manager, context.mqtt, 'bulb', bulbStatus());
  t.after(() => context.manager.stop());
  return { ...context, plug: context.manager.ids(PLUG_MAC).device };
}

function assertMultiLanguage(message) {
  for (const lang of LANGUAGES) {
    assert.equal(typeof message[lang], 'string', `missing ${lang}`);
  }
}

test('scene actions return their declared outputs', async (t) => {
  const { manager, mqtt, plug } = await setup(t);
  const pending = SCENE_ACTIONS.send_command(manager, {
    fields: { device: plug, command: 'Power', payload: 'OFF' },
  });
  await mqtt.receive(manager, 'stat/plug/RESULT', { POWER: 'OFF' });
  assert.deepEqual(await pending, { answered: true, response: '{"POWER":"OFF"}' });
  assert.deepEqual(await SCENE_ACTIONS.restart_device(manager, { fields: { device: plug } }), {
    restarted: true,
  });
  assert.deepEqual(mqtt.published.at(-1), { topic: 'cmnd/plug/Restart', payload: '1' });
  assert.deepEqual(await SCENE_ACTIONS.identify_device(manager, { fields: { device: plug } }), {
    signalled: false,
  });
  assert.deepEqual(
    await SCENE_ACTIONS.pulse_relay(manager, { fields: { device: plug, relay: 1, duration: 3 } }),
    { started: true },
  );
});

test('manifest actions answer in four languages', async (t) => {
  const { manager, gladys, plug } = await setup(t, {
    httpAnswers: { '192.168.1.50': plugStatus({ Status: { DeviceName: 'Garage plug' } }) },
  });
  assertMultiLanguage(await ACTIONS.test_connection(manager, { fields: {}, gladys }));
  assertMultiLanguage(await ACTIONS.broker_info(manager, { fields: {}, gladys }));
  assertMultiLanguage(await ACTIONS.restart(manager, { fields: { device: plug }, gladys }));
  assertMultiLanguage(await ACTIONS.identify(manager, { fields: { device: plug }, gladys }));
  const added = await ACTIONS.add_http_device(manager, {
    fields: { address: '192.168.1.50' },
    gladys,
  });
  assert.match(added.en, /Garage plug/);
  await assert.rejects(
    ACTIONS.add_http_device(manager, { fields: { address: 'http://x' }, gladys }),
    /Invalid address/,
  );
  const scan = await ACTIONS.scan_http(manager, { fields: { range: '192.168.1.50-51' }, gladys });
  assert.match(scan.fr, /1 appareil/);
});

test('configure_mqtt points a device at the broker', async (t) => {
  const { manager, mqtt, gladys, plug } = await setup(t, {
    config: { mqtt_username: 'gladys', mqtt_password: 'pw' },
  });
  const message = await ACTIONS.configure_mqtt(manager, {
    fields: { device: plug, host: '192.168.1.10' },
    gladys,
  });
  assertMultiLanguage(message);
  assert.deepEqual(mqtt.published.at(-1), {
    topic: 'cmnd/plug/Backlog',
    payload: 'MqttHost 192.168.1.10; MqttPort 1883; MqttUser gladys; MqttPassword pw',
  });
});

test('broker_info gives the console command of the embedded broker', async (t) => {
  t.mock.timers.enable(timers);
  const { manager, gladys } = await createManager({ config: { mqtt_mode: 'embedded' } });
  t.after(() => manager.stop());
  gladys.fake.containers = [
    {
      name: 'mosquitto',
      status: 'running',
      ports: [{ container_port: 1883, name: 'mqtt', host_port: 41883 }],
    },
  ];
  const message = await ACTIONS.broker_info(manager, {
    fields: { gladys_host: '10.0.0.2' },
    gladys,
  });
  assert.match(
    message.en,
    /MqttHost 10\.0\.0\.2; MqttPort 41883; MqttUser tasmota; MqttPassword devpw/,
  );
});

test('every widget content is rendered exactly as sent', async (t) => {
  const { manager, plug } = await setup(t);
  const widgets = createWidgets(manager);
  const bulb = [...manager.records.values()].find((r) => r.topic === 'bulb');
  const contents = [
    await widgets[OVERVIEW_WIDGET].get({ settings: {} }),
    await widgets[DEVICE_WIDGET].get({ settings: { device: plug } }),
    await widgets[DEVICE_WIDGET].get({ settings: { device: manager.ids(bulb.mac).device } }),
    await widgets[DEVICE_WIDGET].get({ settings: {} }),
    await widgets[ENERGY_WIDGET].get({ settings: { device: plug } }),
    await widgets[ENERGY_WIDGET].get({ settings: { device: manager.ids(bulb.mac).device } }),
  ];
  for (const content of contents) {
    assert.deepEqual(validateWidgetContent(content), []);
  }
});

test('the live tiles of the widgets reference published features', async (t) => {
  const { manager, plug } = await setup(t);
  const widgets = createWidgets(manager);
  const featureIds = new Set(
    manager.buildDiscoveredDevices().flatMap((d) => d.features.map((f) => f.external_id)),
  );
  for (const content of [
    await widgets[DEVICE_WIDGET].get({ settings: { device: plug } }),
    await widgets[ENERGY_WIDGET].get({ settings: { device: plug } }),
  ]) {
    const bound = content.components.flatMap((c) => c.device_features ?? [c.device_feature]);
    for (const id of bound.filter(Boolean)) {
      assert.ok(featureIds.has(id), `unknown feature ${id}`);
    }
  }
});

test('every widget button is handled', async (t) => {
  const { manager, mqtt } = await setup(t);
  const widgets = createWidgets(manager);
  const bulb = [...manager.records.values()].find((r) => r.topic === 'bulb');
  for (const [key, settings] of [
    [OVERVIEW_WIDGET, {}],
    [DEVICE_WIDGET, { device: manager.ids(bulb.mac).device }],
  ]) {
    const content = await widgets[key].get({ settings });
    for (const { action } of content.components.filter((c) => c.type === 'button' && c.action)) {
      const pending = widgets[key].action(action.key, action.params ?? {}, { settings });
      await mqtt.receive(manager, 'stat/bulb/RESULT', { POWER: 'ON' });
      const message = await pending;
      assertMultiLanguage(message);
      assert.ok(message.en.length <= 200);
    }
  }
  await assert.rejects(widgets[DEVICE_WIDGET].action('nope', {}, {}), /Unknown widget action/);
});

test('refreshWidgets nudges every widget', async (t) => {
  const { manager, gladys } = await setup(t);
  const widgets = createWidgets(manager);
  refreshWidgets(gladys, widgets);
  assert.deepEqual(gladys.fake.widgetRefreshes.slice(-3), Object.keys(widgets));
});

test('the connection status tells what to do', () => {
  assert.equal(connectionStatusOf({ mode: 'disabled' }).connected, true);
  assert.match(connectionStatusOf({ mode: 'external', mqttUrlMissing: true }).message.en, /URL/);
  assert.equal(connectionStatusOf({ mode: 'external', brokerConnected: true }).connected, true);
  const down = connectionStatusOf({
    mode: 'embedded',
    brokerConnected: false,
    brokerError: 'boom',
  });
  assert.equal(down.connected, false);
  assert.match(down.message.de, /boom/);
});
