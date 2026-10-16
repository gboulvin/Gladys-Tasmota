import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { TasmotaManager } from '../src/manager.js';
import { HttpAuthError } from '../src/transports/http.js';
import {
  bulbStatus,
  createManager,
  discoverOverMqtt,
  FakeMqtt,
  flush,
  PLUG_MAC,
  plugStatus,
  shutterStatus,
} from './helpers.js';

const timers = { apis: ['setTimeout', 'Date'] };

test('a device announcing itself over MQTT is asked its status, then published', async (t) => {
  t.mock.timers.enable(timers);
  const { gladys, manager, mqtt } = await createManager();
  await mqtt.receive(manager, 'tele/plug/LWT', 'Online');
  assert.deepEqual(mqtt.published.at(-1), { topic: 'cmnd/plug/STATUS', payload: '0' });

  await discoverOverMqtt(t, manager, mqtt, 'plug', plugStatus());
  t.mock.timers.tick(1500);
  await flush();

  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.external_id, `ext:test-integration:tasmota:${PLUG_MAC}`);
  assert.equal(device.name, 'Kitchen plug');
  assert.equal(device.should_poll, undefined, 'an MQTT device pushes, it is not polled');
  assert.deepEqual(
    device.params.find((p) => p.name === 'MAC'),
    { name: 'MAC', value: '84:F3:EB:12:AB:CD' },
  );
  const keys = device.features.map((f) => f.external_id.split(':').at(-1));
  assert.ok(keys.includes('power'));
  assert.ok(keys.includes('energy-power'));
  assert.ok(keys.includes('am2301-temperature'));
  assert.equal(gladys.fake.lastState(`${device.external_id}:energy-power`), 42);
  manager.stop();
});

test('the STATUSn pieces of an older firmware are merged into one device', async (t) => {
  t.mock.timers.enable(timers);
  const { gladys, manager, mqtt } = await createManager();
  const status = plugStatus();
  await mqtt.receive(manager, 'stat/plug/STATUS', { Status: status.Status });
  await mqtt.receive(manager, 'stat/plug/STATUS2', { StatusFWR: status.StatusFWR });
  await mqtt.receive(manager, 'stat/plug/STATUS5', { StatusNET: status.StatusNET });
  await mqtt.receive(manager, 'stat/plug/STATUS10', { StatusSNS: status.StatusSNS });
  await mqtt.receive(manager, 'stat/plug/STATUS11', { StatusSTS: status.StatusSTS });
  t.mock.timers.tick(1000);
  await flush();
  t.mock.timers.tick(1500);
  await flush();
  assert.equal(gladys.fake.discoveredDevices.length, 1);
  assert.equal(manager.records.get(PLUG_MAC).firmware, '14.2.0(release-tasmota)');
  manager.stop();
});

test('telemetry and results publish the states of a known device', async (t) => {
  t.mock.timers.enable(timers);
  const { gladys, manager, mqtt } = await createManager();
  await discoverOverMqtt(t, manager, mqtt, 'plug', plugStatus());
  const ids = manager.ids(PLUG_MAC);

  await mqtt.receive(manager, 'stat/plug/RESULT', { POWER: 'OFF' });
  assert.equal(gladys.fake.lastState(ids.feature('power')), 0);
  await mqtt.receive(manager, 'stat/plug/POWER', 'ON');
  assert.equal(gladys.fake.lastState(ids.feature('power')), 1);
  await mqtt.receive(manager, 'tele/plug/SENSOR', { ENERGY: { Power: 1500 } });
  assert.equal(gladys.fake.lastState(ids.feature('energy-power')), 1500);
  manager.stop();
});

test('a sensor plugged later adds its feature on the next telemetry', async (t) => {
  t.mock.timers.enable(timers);
  const { gladys, manager, mqtt } = await createManager();
  await discoverOverMqtt(t, manager, mqtt, 'plug', plugStatus());
  t.mock.timers.tick(1500);
  await flush();
  await mqtt.receive(manager, 'tele/plug/SENSOR', { DS18B20: { Temperature: 4.5 } });
  t.mock.timers.tick(1500);
  await flush();
  const [device] = gladys.fake.discoveredDevices;
  assert.ok(device.features.some((f) => f.external_id.endsWith(':ds18b20-temperature')));
  manager.stop();
});

test('a command goes out on the cmnd topic', async (t) => {
  t.mock.timers.enable(timers);
  const { manager, mqtt } = await createManager();
  await discoverOverMqtt(t, manager, mqtt, 'bulb', bulbStatus());
  const record = [...manager.records.values()][0];
  const ids = manager.ids(record.mac);
  await manager.setValue({ external_id: ids.device }, { external_id: ids.feature('dimmer') }, 35);
  assert.deepEqual(mqtt.published.at(-1), { topic: 'cmnd/bulb/Dimmer', payload: '35' });
  await manager.setValue(
    { external_id: ids.device },
    { external_id: ids.feature('color') },
    0x00ff00,
  );
  assert.deepEqual(mqtt.published.at(-1), { topic: 'cmnd/bulb/Color2', payload: '0,255,0' });
  await assert.rejects(
    manager.setValue({ external_id: ids.device }, { external_id: ids.feature('rssi') }, 1),
    /cannot be controlled/,
  );
  manager.stop();
});

test('the %topic%/%prefix%/ layout is supported', async (t) => {
  t.mock.timers.enable(timers);
  const { manager, mqtt } = await createManager({ config: { full_topic: 'topic_prefix' } });
  assert.ok(mqtt.starts.at(-1).subscriptions.includes('+/stat/+'));
  await mqtt.receive(manager, 'plug/stat/STATUS0', plugStatus());
  t.mock.timers.tick(1000);
  await flush();
  const ids = manager.ids(PLUG_MAC);
  await manager.setValue({ external_id: ids.device }, { external_id: ids.feature('power') }, 0);
  assert.deepEqual(mqtt.published.at(-1), { topic: 'plug/cmnd/POWER', payload: 'OFF' });
  manager.stop();
});

test('buttons, RF codes and availability fire scene events', async (t) => {
  t.mock.timers.enable(timers);
  const { gladys, manager, mqtt } = await createManager();
  await discoverOverMqtt(t, manager, mqtt, 'plug', plugStatus());
  const device = manager.ids(PLUG_MAC).device;

  await mqtt.receive(manager, 'stat/plug/RESULT', { Button1: { Action: 'TRIPLE' } });
  await mqtt.receive(manager, 'tele/plug/RESULT', {
    RfReceived: { Data: 'ABC123', RfKey: 'None' },
  });
  await mqtt.receive(manager, 'tele/plug/LWT', 'Offline');
  await mqtt.receive(manager, 'tele/plug/LWT', 'Online');

  assert.deepEqual(
    gladys.fake.sceneEvents.map(({ key, data }) => [key, data]),
    [
      ['button_pressed', { device, button: 1, action: 'TRIPLE' }],
      ['rf_code_received', { device, code: 'ABC123', rf_key: 'None' }],
      ['availability_changed', { device, status: 'offline' }],
      ['availability_changed', { device, status: 'online' }],
    ],
  );
  manager.stop();
});

test('send_command waits for the answer of the device', async (t) => {
  t.mock.timers.enable(timers);
  const { manager, mqtt } = await createManager();
  await discoverOverMqtt(t, manager, mqtt, 'plug', plugStatus());
  const device = manager.ids(PLUG_MAC).device;
  const pending = manager.sendCommand(device, 'Power1', 'TOGGLE');
  await flush();
  assert.deepEqual(mqtt.published.at(-1), { topic: 'cmnd/plug/Power1', payload: 'TOGGLE' });
  await mqtt.receive(manager, 'stat/plug/RESULT', { POWER1: 'OFF' });
  assert.equal(await pending, '{"POWER1":"OFF"}');

  const silent = manager.sendCommand(device, 'Power1', 'ON');
  t.mock.timers.tick(5000);
  assert.equal(await silent, null, 'no answer within 5 s');
  await assert.rejects(manager.sendCommand(device, 'Power1; Restart', ''), /Invalid/);
  manager.stop();
});

test('identify blinks lights only, and restores their state', async (t) => {
  t.mock.timers.enable(timers);
  const { manager, mqtt } = await createManager();
  await discoverOverMqtt(t, manager, mqtt, 'bulb', bulbStatus());
  await discoverOverMqtt(t, manager, mqtt, 'plug', plugStatus());
  const bulb = [...manager.records.values()].find((r) => r.topic === 'bulb');
  assert.equal(await manager.identify(manager.ids(bulb.mac).device), true);
  const { topic, payload } = mqtt.published.at(-1);
  assert.equal(topic, 'cmnd/bulb/Backlog');
  assert.equal(payload.match(/TOGGLE/g).length, 4, 'an even number of toggles');
  assert.equal(await manager.identify(manager.ids(PLUG_MAC).device), false);
  manager.stop();
});

test('pulse turns a relay on, then off on the device itself', async (t) => {
  t.mock.timers.enable(timers);
  const { manager, mqtt } = await createManager();
  await discoverOverMqtt(t, manager, mqtt, 'plug', plugStatus());
  await manager.pulse(manager.ids(PLUG_MAC).device, 2, 1000);
  assert.deepEqual(mqtt.published.at(-1), {
    topic: 'cmnd/plug/Backlog',
    payload: 'Power2 ON; Delay 3600; Power2 OFF',
  });
  manager.stop();
});

test('an HTTP device is probed, polled, and commanded over HTTP', async (t) => {
  t.mock.timers.enable(timers);
  const { gladys, manager, httpCalls } = await createManager({
    config: { mqtt_mode: 'disabled', http_username: 'admin', http_password: 'pw' },
    httpAnswers: {
      '192.168.1.20 Status 0': plugStatus(),
      '192.168.1.20 POWER OFF': { POWER: 'OFF' },
    },
  });
  const record = await manager.probeHttp('192.168.1.20');
  assert.equal(record.protocol, 'http');
  assert.deepEqual(httpCalls[0].credentials, { username: 'admin', password: 'pw' });
  await manager.publishDevices();
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.should_poll, true);
  assert.equal(device.poll_frequency, 10000);

  assert.equal(await manager.pollDevice(device), true);
  assert.equal(await manager.pollDevice(device), false, 'not due before the interval');
  t.mock.timers.tick(30_000);
  assert.equal(await manager.pollDevice(device), true);

  const ids = manager.ids(PLUG_MAC);
  await manager.setValue(device, { external_id: ids.feature('power') }, 0);
  assert.equal(httpCalls.at(-1).cmnd, 'POWER OFF');
  assert.equal(gladys.fake.lastState(ids.feature('power')), 0, 'the HTTP answer is the feedback');
  manager.stop();
});

test('an HTTP device goes offline after two failed polls', async (t) => {
  t.mock.timers.enable(timers);
  let up = true;
  const { gladys, manager } = await createManager({
    config: { mqtt_mode: 'disabled' },
    httpAnswers: {
      '192.168.1.20': () => {
        if (!up) {
          throw new Error('timeout');
        }
        return plugStatus();
      },
    },
  });
  await manager.probeHttp('192.168.1.20');
  const device = manager.buildDevice(manager.records.get(PLUG_MAC));
  up = false;
  for (let i = 0; i < 2; i += 1) {
    t.mock.timers.tick(60_000);
    await assert.rejects(manager.pollDevice(device), /timeout/);
  }
  assert.equal(manager.records.get(PLUG_MAC).online, false);
  assert.equal(gladys.fake.sceneEvents.at(-1).data.status, 'offline');
  manager.stop();
});

test('an IP range scan reports the devices asking for a password', async (t) => {
  t.mock.timers.enable(timers);
  const { manager } = await createManager({
    config: { mqtt_mode: 'disabled' },
    httpAnswers: {
      '192.168.1.20': plugStatus(),
      '192.168.1.21': new HttpAuthError('192.168.1.21'),
    },
  });
  const { found, authRequired } = await manager.scanHttp([
    '192.168.1.20',
    '192.168.1.21',
    '192.168.1.22',
  ]);
  assert.equal(found.length, 1);
  assert.deepEqual(authRequired, ['192.168.1.21']);
  assert.deepEqual(manager.summary().authRequired, ['192.168.1.21']);
  manager.stop();
});

test('a device seen on both channels stays one device, MQTT first', async (t) => {
  t.mock.timers.enable(timers);
  const { manager, mqtt } = await createManager({
    httpAnswers: { '192.168.1.20': plugStatus() },
  });
  await discoverOverMqtt(t, manager, mqtt, 'plug', plugStatus());
  await manager.probeHttp('192.168.1.20');
  assert.equal(manager.records.size, 1);
  assert.equal(manager.records.get(PLUG_MAC).protocol, 'mqtt');
  manager.stop();
});

test('commands fall back to HTTP and the badge turns degraded when the broker is down', async (t) => {
  t.mock.timers.enable(timers);
  const ids = (gladys) => gladys.externalIds('tasmota', PLUG_MAC);
  const probe = createFakeGladys();
  const { gladys, manager, mqtt, httpCalls } = await createManager({
    devices: [{ external_id: ids(probe).device, name: 'Kitchen plug', features: [], params: [] }],
    httpAnswers: { '192.168.1.20': { POWER: 'ON' } },
  });
  await discoverOverMqtt(t, manager, mqtt, 'plug', plugStatus());
  mqtt.stop();
  await flush();
  const entry = gladys.fake.transports.at(-1);
  assert.equal(entry.transport, DEVICE_TRANSPORTS.LOCAL);
  assert.equal(entry.degraded, true);
  await manager.setValue(
    { external_id: ids(gladys).device },
    { external_id: ids(gladys).feature('power') },
    1,
  );
  assert.equal(httpCalls.at(-1).cmnd, 'POWER ON');
  manager.stop();
});

test('shutters are controlled with the Shutter commands', async (t) => {
  t.mock.timers.enable(timers);
  const { manager, mqtt } = await createManager();
  await discoverOverMqtt(t, manager, mqtt, 'shutter', shutterStatus());
  const record = [...manager.records.values()][0];
  assert.ok(record.features['shutter1-position']);
  const ids = manager.ids(record.mac);
  await manager.setValue(
    { external_id: ids.device },
    { external_id: ids.feature('shutter1-state') },
    -1,
  );
  assert.deepEqual(mqtt.published.at(-1), { topic: 'cmnd/shutter/ShutterClose1', payload: '' });
  manager.stop();
});

test('the records survive a restart through /data', async (t) => {
  t.mock.timers.enable(timers);
  const { manager, mqtt } = await createManager();
  await discoverOverMqtt(t, manager, mqtt, 'plug', plugStatus());
  await manager.save();
  manager.stop();

  const gladys = createFakeGladys();
  await gladys.connect();
  const restarted = new TasmotaManager({ gladys, dataDir: manager.dataDir, mqtt: new FakeMqtt() });
  await restarted.load();
  const record = restarted.records.get(PLUG_MAC);
  assert.equal(record.topic, 'plug');
  assert.equal(record.online, null, 'availability is not persisted');
  assert.ok(record.features.power);
});

test('the devices created in Gladys rebuild a lost store', async () => {
  const gladys = createFakeGladys();
  const ids = gladys.externalIds('tasmota', PLUG_MAC);
  const manager = new TasmotaManager({ gladys, dataDir: '/nonexistent', mqtt: new FakeMqtt() });
  manager.adoptGladysDevices([
    {
      external_id: ids.device,
      name: 'Kitchen plug',
      params: [
        { name: 'TOPIC', value: 'plug' },
        { name: 'IP', value: '192.168.1.20' },
        { name: 'PROTOCOL', value: 'mqtt' },
      ],
      features: [
        { external_id: ids.feature('power'), name: 'Switch', category: 'switch', type: 'binary' },
      ],
    },
    { external_id: 'ext:test-integration:other:1', name: 'Foreign', features: [] },
  ]);
  assert.equal(manager.records.size, 1);
  assert.equal(manager.records.get(PLUG_MAC).topic, 'plug');
  assert.equal(manager.records.get(PLUG_MAC).features.power.category, 'switch');
});

test('the embedded broker mode starts the sub-container and connects to it', async (t) => {
  t.mock.timers.enable(timers);
  const { manager, mqtt, brokerCalls } = await createManager({
    config: { mqtt_mode: 'embedded', broker_password: 'secret' },
  });
  assert.equal(brokerCalls.at(-1).devicePassword, 'secret');
  assert.equal(mqtt.starts.at(-1).url, 'mqtt://mosquitto:1883');
  assert.equal(manager.brokerDevicePassword, 'devpw');
  manager.stop();
});

test('without a broker URL, MQTT stays off and the summary says why', async () => {
  const { manager, mqtt } = await createManager({ config: { mqtt_url: '' } });
  assert.equal(mqtt.connected, false);
  assert.equal(manager.summary().mqttUrlMissing, true);
  manager.stop();
});
