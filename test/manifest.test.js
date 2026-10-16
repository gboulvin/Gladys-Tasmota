// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The store validator checks the manifest itself; nothing there knows which
// handlers the code registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACTIONS } from '../src/actions.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { createWidgets } from '../src/widgets.js';
import { TRIGGERS } from '../src/tasmota/events.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { LANGUAGES } from '../src/i18n.js';
import { BROKER_CONTAINER, BROKER_PORT_NAME } from '../src/broker.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const keysOf = (list) => (list ?? []).map((entry) => entry.key);

const allFields = [
  ...manifest.config_schema,
  ...[...manifest.actions, ...manifest.scene_triggers, ...manifest.scene_actions].flatMap(
    (item) => item.fields ?? [],
  ),
  ...manifest.widgets.flatMap((widget) => widget.settings ?? []),
];

// Every multi-language text of the manifest, with its path.
function* texts(node, path = 'manifest') {
  if (Array.isArray(node)) {
    for (const [i, child] of node.entries()) {
      yield* texts(child, `${path}.${i}`);
    }
  } else if (node && typeof node === 'object') {
    for (const [key, child] of Object.entries(node)) {
      if (['label', 'description', 'placeholder'].includes(key)) {
        yield [`${path}.${key}`, child];
      } else {
        yield* texts(child, `${path}.${key}`);
      }
    }
  }
}

test('every text of the manifest is translated in English, French, German and Spanish', () => {
  for (const [path, text] of texts(manifest)) {
    assert.equal(typeof text, 'object', `${path} must be a multi-language object`);
    for (const lang of LANGUAGES) {
      assert.ok(text[lang], `${path}.${lang} is missing`);
    }
  }
});

test('every manifest action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), Object.keys(ACTIONS).sort());
});

test('every scene action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
});

test('every scene trigger the code fires is declared, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGERS).sort());
});

test('every trigger exposes the keys its events carry', () => {
  const carried = {
    [TRIGGERS.BUTTON]: ['device', 'button', 'action'],
    [TRIGGERS.SWITCH]: ['device', 'switch', 'action'],
    [TRIGGERS.RF]: ['device', 'code', 'rf_key'],
    [TRIGGERS.IR]: ['device', 'code', 'protocol'],
    [TRIGGERS.AVAILABILITY]: ['device', 'status'],
  };
  for (const trigger of manifest.scene_triggers) {
    const declared = new Set([...keysOf(trigger.fields), ...keysOf(trigger.variables)]);
    for (const key of carried[trigger.key]) {
      assert.ok(declared.has(key), `${trigger.key}: data.${key} would be dropped by the core`);
    }
  }
});

test('every widget has a content handler, and vice versa', () => {
  const widgets = createWidgets({});
  assert.deepEqual(keysOf(manifest.widgets).sort(), Object.keys(widgets).sort());
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section') {
      assert.ok(!(field.key in DEFAULT_CONFIG), `section ${field.key} stores no value`);
      continue;
    }
    assert.ok(field.key in DEFAULT_CONFIG, `${field.key} has no default in DEFAULT_CONFIG`);
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `DEFAULT_CONFIG.${field.key}`);
    }
  }
});

test('the embedded broker sub-container matches the code', () => {
  const broker = manifest.containers.find((c) => c.name === BROKER_CONTAINER);
  assert.ok(broker, 'the mosquitto sub-container is declared');
  assert.equal(broker.start, 'manual', 'started once its config is written');
  assert.deepEqual(broker.volumes, ['/config']);
  assert.ok(broker.ports.some((p) => p.name === BROKER_PORT_NAME && p.container_port === 1883));
  assert.match(broker.docker_image, /^eclipse-mosquitto:\d+\.\d+\.\d+$/, 'a pinned tag');
});

test('dynamic selects declare a source and no static options', () => {
  for (const field of allFields.filter((f) => f.source !== undefined)) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined, `field "${field.key}"`);
  }
});

test('the manifest is local-only, for Gladys 5.1.0 or later', () => {
  assert.deepEqual(manifest.transports, ['local']);
  assert.match(manifest.gladys_version, /^>=5\.1\.0/);
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});

test('the user documentation exists in the four languages', async () => {
  for (const lang of LANGUAGES) {
    const doc = await readFile(new URL(`../docs/${lang}.md`, import.meta.url), 'utf8');
    assert.ok(doc.trim().length >= 300, `docs/${lang}.md is too short`);
  }
});
