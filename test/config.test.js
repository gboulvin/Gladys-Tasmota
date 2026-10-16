import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeBrokerUrl, normalizeConfig } from '../src/config.js';
import {
  buildCommandUrl,
  expandAddresses,
  httpCommand,
  HttpAuthError,
  isValidAddress,
  mapLimit,
} from '../src/transports/http.js';
import { parseDiscoveryTopic, redactUrl, topicLayout } from '../src/transports/mqtt.js';
import {
  ensureBroker,
  hashMosquittoPassword,
  loadBrokerCredentials,
  mosquittoConfig,
} from '../src/broker.js';
import { pbkdf2Sync } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('normalizeConfig returns the defaults when called with no argument', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
});

test('normalizeConfig coerces and bounds the values of a form', () => {
  const config = normalizeConfig({ poll_frequency: '5', mqtt_mode: 'nope', full_topic: 'x' });
  assert.equal(config.poll_frequency, 10, 'ten seconds at least');
  assert.equal(config.mqtt_mode, 'external');
  assert.equal(config.full_topic, 'prefix_topic');
  assert.equal(normalizeConfig({ poll_frequency: 'abc' }).poll_frequency, 30);
});

test('a bare broker host becomes a full URL', () => {
  assert.equal(normalizeBrokerUrl('192.168.1.10'), 'mqtt://192.168.1.10:1883');
  assert.equal(normalizeBrokerUrl('mqtts://broker.lan:8883'), 'mqtts://broker.lan:8883');
  assert.equal(normalizeBrokerUrl('http://broker'), '', 'not an MQTT scheme');
  assert.equal(normalizeBrokerUrl(''), '');
});

test('expandAddresses understands lists, ranges and short ranges', () => {
  assert.deepEqual(expandAddresses('192.168.1.10, 192.168.1.20-192.168.1.22; plug.lan'), [
    '192.168.1.10',
    '192.168.1.20',
    '192.168.1.21',
    '192.168.1.22',
    'plug.lan',
  ]);
  assert.equal(expandAddresses('10.0.0.1-254').length, 254);
  assert.deepEqual(expandAddresses(''), []);
  assert.throws(() => expandAddresses('10.0.0.0-10.0.8.0'), /Too many/);
  assert.throws(() => expandAddresses('300.1.1.1'), /Invalid/);
  assert.throws(() => expandAddresses('10.0.0.9-1'), /Invalid/);
});

test('isValidAddress refuses URLs and paths', () => {
  assert.equal(isValidAddress('192.168.1.10'), true);
  assert.equal(isValidAddress('192.168.1.10:8080'), true);
  assert.equal(isValidAddress('plug.local'), true);
  assert.equal(isValidAddress('http://192.168.1.10'), false);
  assert.equal(isValidAddress('192.168.1.10/cm'), false);
  assert.equal(isValidAddress('1.2.3'), false);
});

test('the command URL carries the credentials only when set', () => {
  assert.equal(buildCommandUrl('10.0.0.5', 'Status 0'), 'http://10.0.0.5/cm?cmnd=Status+0');
  assert.match(
    buildCommandUrl('10.0.0.5', 'Power ON', { username: 'admin', password: 'p&w' }),
    /user=admin&password=p%26w&cmnd=Power\+ON$/,
  );
});

test('httpCommand detects the password request of Tasmota', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    status: 200,
    text: async () => '{"WARNING":"Need user=<username>&password=<password>"}',
  }));
  await assert.rejects(httpCommand('10.0.0.5', 'Status 0'), HttpAuthError);
  globalThis.fetch.mock.mockImplementation(async () => ({
    ok: true,
    status: 200,
    text: async () => '{"POWER":"ON"}',
  }));
  assert.deepEqual(await httpCommand('10.0.0.5', 'Power'), { POWER: 'ON' });
  globalThis.fetch.mock.mockImplementation(async () => ({ ok: false, status: 401 }));
  await assert.rejects(httpCommand('10.0.0.5', 'Power'), HttpAuthError);
});

test('mapLimit keeps the order and the failures', async () => {
  let running = 0;
  let peak = 0;
  const results = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setImmediate(resolve));
    running -= 1;
    if (n === 3) {
      throw new Error('three');
    }
    return n * 2;
  });
  assert.equal(peak, 2);
  assert.deepEqual(
    results.map((r) => r.value ?? r.reason.message),
    [2, 4, 'three', 8, 10],
  );
});

test('MQTT topics follow the FullTopic layout', () => {
  const standard = topicLayout('prefix_topic');
  assert.deepEqual(standard.parse('tele/plug/STATE'), {
    prefix: 'tele',
    deviceTopic: 'plug',
    suffix: 'STATE',
  });
  assert.equal(standard.parse('cmnd/plug/POWER'), null, 'commands are not ours to read');
  assert.equal(standard.command('plug', 'POWER'), 'cmnd/plug/POWER');
  const reversed = topicLayout('topic_prefix');
  assert.equal(reversed.parse('plug/stat/RESULT').deviceTopic, 'plug');
  assert.equal(reversed.command('plug', 'POWER'), 'plug/cmnd/POWER');
  assert.deepEqual(parseDiscoveryTopic('tasmota/discovery/84F3EB12ABCD/config'), {
    mac: '84f3eb12abcd',
    kind: 'config',
  });
  assert.equal(redactUrl('mqtt://u:secret@h:1883'), 'mqtt://u:***@h:1883');
});

test('the Mosquitto password hash is the mosquitto_passwd $7$ format', () => {
  const salt = Buffer.alloc(12, 7);
  const hash = hashMosquittoPassword('pw', salt);
  const [, kind, iterations, saltB64, hashB64] = hash.split('$');
  assert.equal(kind, '7');
  assert.equal(iterations, '101');
  assert.equal(Buffer.from(saltB64, 'base64').length, 12);
  assert.equal(hashB64, pbkdf2Sync('pw', salt, 101, 64, 'sha512').toString('base64'));
  assert.match(mosquittoConfig(), /allow_anonymous false/);
  assert.match(mosquittoConfig(), /password_file \/config\/passwd/);
});

test('the broker credentials are generated once, the device password follows the config', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'broker-'));
  const first = await loadBrokerCredentials(dir, '');
  const again = await loadBrokerCredentials(dir, '');
  assert.equal(first.changed, true);
  assert.equal(again.changed, false);
  assert.equal(again.gladysPassword, first.gladysPassword);
  const changed = await loadBrokerCredentials(dir, 'mine');
  assert.equal(changed.devicePassword, 'mine');
  assert.equal(changed.gladysPassword, first.gladysPassword);
});

test('ensureBroker writes the config once and restarts the broker only on a change', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'broker-'));
  const calls = [];
  const containers = [{ name: 'mosquitto', status: 'stopped', ports: [] }];
  const gladys = {
    getContainers: async () => containers,
    startContainer: async (name) => {
      calls.push(['start', name]);
      containers[0].status = 'running';
    },
    restartContainer: async (name) => calls.push(['restart', name]),
  };
  const first = await ensureBroker(gladys, { dataDir: dir, devicePassword: '' });
  assert.equal(first.url, 'mqtt://mosquitto:1883');
  const passwd = await readFile(join(dir, 'containers/mosquitto/config/passwd'), 'utf8');
  assert.match(passwd, /^gladys:\$7\$101\$/m);
  assert.match(passwd, /^tasmota:\$7\$101\$/m);
  await ensureBroker(gladys, { dataDir: dir, devicePassword: '' });
  await ensureBroker(gladys, { dataDir: dir, devicePassword: 'new' });
  assert.deepEqual(calls, [
    ['start', 'mosquitto'],
    ['restart', 'mosquitto'],
  ]);
});
