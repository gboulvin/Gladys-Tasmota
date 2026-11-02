// RFID / NFC badge readers (RC522, PN532, RDM6300, Wiegand): payloads as the
// Tasmota drivers print them (xsns_80_mfrc522, xsns_40_pn532, xsns_51_rdm6300,
// xsns_82_wiegand).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
} from '@gladysassistant/integration-sdk';
import { extractEvents, normalizeUid, TRIGGERS } from '../src/tasmota/events.js';
import { extractReadings } from '../src/tasmota/features.js';
import { createManager, discoverOverMqtt, flush, PLUG_MAC, plugStatus } from './helpers.js';

const timers = { apis: ['setTimeout', 'Date'] };

const RC522 = {
  Time: '2026-11-02T21:00:00',
  RC522: { UID: 'BA839D07', Data: 'Gladys', Type: 'MIFARE 1KB' },
};

test('every reader read becomes one rfid_tag_read event', () => {
  assert.deepEqual(extractEvents(RC522), [
    { key: TRIGGERS.RFID, data: { uid: 'BA839D07', data: 'Gladys', reader: 'RC522' } },
  ]);
  assert.deepEqual(extractEvents({ PN532: { UID: '94d8fc5f' } }), [
    { key: TRIGGERS.RFID, data: { uid: '94D8FC5F', data: '', reader: 'PN532' } },
  ]);
  assert.deepEqual(extractEvents({ RDM6300: { UID: '0011AABB' } })[0].data.reader, 'RDM6300');
  assert.deepEqual(extractEvents({ Wiegand: { UID: 12345678, Size: 26 } })[0].data, {
    uid: '12345678',
    data: '',
    reader: 'Wiegand',
  });
  assert.deepEqual(extractEvents({ RC522: { UID: '' } }), [], 'no UID, no read');
  assert.deepEqual(
    extractEvents({ PN532: { COMMAND: 'E' } }),
    [],
    'a command answer is not a read',
  );
  assert.equal(normalizeUid(' ba839d07 '), 'BA839D07');
});

test('the last badge is a text feature, and no numeric feature leaks from the UID', () => {
  const readings = extractReadings('sensors', RC522);
  assert.equal(readings.length, 1);
  const [reading] = readings;
  assert.equal(reading.key, 'rc522-uid');
  assert.equal(reading.text, 'BA839D07');
  assert.equal(reading.spec.category, C.TEXT);
  assert.equal(reading.spec.type, T.TEXT.TEXT);
  assert.equal(reading.spec.keep_history, false);
  // An all-digit Wiegand UID must not turn into a numeric sensor.
  const wiegand = extractReadings('sensors', { Wiegand: { UID: 12345678, Size: 26 } });
  assert.deepEqual(
    wiegand.map((r) => r.key),
    ['wiegand-uid'],
  );
});

test('a badge read fires the scene event, adds the feature and publishes the badge', async (t) => {
  t.mock.timers.enable(timers);
  const { gladys, manager, mqtt } = await createManager();
  t.after(() => manager.stop());
  await discoverOverMqtt(t, manager, mqtt, 'plug', plugStatus());
  t.mock.timers.tick(1500);
  await flush();
  const ids = manager.ids(PLUG_MAC);

  await mqtt.receive(manager, 'tele/plug/SENSOR', RC522);
  assert.deepEqual(gladys.fake.sceneEvents.at(-1), {
    key: TRIGGERS.RFID,
    data: { device: ids.device, uid: 'BA839D07', data: 'Gladys', reader: 'RC522' },
  });
  assert.ok(manager.records.get(PLUG_MAC).features['rc522-uid'], 'the reader is learnt');
  assert.equal(gladys.fake.lastState(ids.feature('rc522-uid')), 'BA839D07');

  // Gladys accepts the published device with its text feature.
  t.mock.timers.tick(1500);
  await flush();
  const published = gladys.fake.discoveredDevices[0].features.find((f) =>
    f.external_id.endsWith(':rc522-uid'),
  );
  assert.equal(published.category, C.TEXT);

  // The same badge again: a new read, a new event.
  await mqtt.receive(manager, 'tele/plug/SENSOR', RC522);
  assert.equal(gladys.fake.sceneEvents.filter((e) => e.key === TRIGGERS.RFID).length, 2);
});
