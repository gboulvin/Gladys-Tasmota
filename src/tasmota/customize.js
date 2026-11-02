// -----------------------------------------------------------------------------
// User customization of the published features. PURE module.
//
// Gladys lets the user rename a device and pick its room, but the features of
// an external integration are defined by the integration: their name and
// category come from the discovery payload. The native Tasmota integration let
// the user rename features and turn a relay into a light (or a light relay back
// into a switch); this module brings both back, as overrides kept per device
// (`record.overrides`, in /data) and applied each time the device is published:
//
//   { power2: { category: 'light', name: 'Living room lamp' } }
//
// The feature KEY never changes (external ids are forever): a category change
// only redefines the feature, so the Gladys "Update" gesture of the Discovery
// tab applies it in place, history and scenes kept.
//
// Without an override, a device configured in Tasmota with `SetOption30 1`
// (the Tasmota convention for "my relays drive lights", read from the native
// discovery) publishes its relays as lights.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
} from '@gladysassistant/integration-sdk';

export const RELAY_KINDS = { SWITCH: 'switch', LIGHT: 'light' };

// Values of the `type` field of the customize_feature action.
export const TYPE_CHOICES = { UNCHANGED: 'unchanged', AUTO: 'auto', ...RELAY_KINDS };

// A name made of this single character resets the feature to its default name.
export const RESET_NAME = '-';
export const MAX_NAME_LENGTH = 100;

/** Is this feature key a relay (POWER, POWER1…POWER32)? */
export function isRelayKey(key) {
  return /^power\d*$/.test(key);
}

function relayIndex(key) {
  return key.replace(/^power/, '');
}

function defaultRelayName(kind, key) {
  const index = relayIndex(key);
  const base = kind === RELAY_KINDS.LIGHT ? 'Light' : 'Switch';
  return index ? `${base} ${index}` : base;
}

/** Category of a relay: its override, else SetOption30, else what Tasmota reported. */
function relayKind(spec, override, discovery) {
  if (override?.category) {
    return override.category;
  }
  if (Number(discovery?.so?.['30']) === 1) {
    return RELAY_KINDS.LIGHT;
  }
  return spec.category === C.LIGHT ? RELAY_KINDS.LIGHT : RELAY_KINDS.SWITCH;
}

/**
 * The features as published: the extracted specs with the user's overrides
 * (and SetOption30) applied. The input is never modified.
 * @param {Record<string, object>} features feature key -> spec
 * @param {Record<string, { name?: string, category?: string }>} [overrides]
 * @param {object} [discovery] Tasmota native discovery config
 * @returns {Record<string, object>}
 */
export function applyOverrides(features, overrides = {}, discovery = undefined) {
  const result = {};
  for (const [key, spec] of Object.entries(features)) {
    const override = overrides?.[key];
    let effective = { ...spec };
    if (isRelayKey(key)) {
      const kind = relayKind(spec, override, discovery);
      const currentKind = spec.category === C.LIGHT ? RELAY_KINDS.LIGHT : RELAY_KINDS.SWITCH;
      if (kind !== currentKind) {
        effective = {
          ...effective,
          category: kind === RELAY_KINDS.LIGHT ? C.LIGHT : C.SWITCH,
          type: kind === RELAY_KINDS.LIGHT ? T.LIGHT.BINARY : T.SWITCH.BINARY,
          name: defaultRelayName(kind, key),
        };
      }
    }
    if (override?.name) {
      effective.name = override.name;
    }
    result[key] = effective;
  }
  return result;
}

/** Keys of the relays published as lights (what `identify` may blink). */
export function lightRelayKeys(effectiveFeatures) {
  return Object.entries(effectiveFeatures)
    .filter(([key, spec]) => isRelayKey(key) && spec.category === C.LIGHT)
    .map(([key]) => key)
    .sort((a, b) => Number(relayIndex(a) || 1) - Number(relayIndex(b) || 1));
}

/**
 * Find the feature the user means: its key ("power2"), its current name
 * ("Switch 2", case-insensitive), or a relay number ("2").
 * @returns {string | undefined} the feature key
 */
export function resolveFeatureKey(effectiveFeatures, input) {
  const wanted = String(input ?? '').trim();
  if (!wanted) {
    return undefined;
  }
  if (effectiveFeatures[wanted]) {
    return wanted;
  }
  if (/^\d+$/.test(wanted)) {
    const key = `power${wanted}`;
    if (effectiveFeatures[key]) {
      return key;
    }
    // A single-relay device reports POWER, not POWER1.
    if (wanted === '1' && effectiveFeatures.power) {
      return 'power';
    }
  }
  const lower = wanted.toLocaleLowerCase();
  const byName = Object.entries(effectiveFeatures).filter(
    ([, spec]) => String(spec.name).toLocaleLowerCase() === lower,
  );
  return byName.length === 1 ? byName[0][0] : undefined;
}

/**
 * New override of one feature after a customize_feature request.
 * @param {string} key feature key
 * @param {{ name?: string, category?: string } | undefined} current
 * @param {{ name?: string, type?: string }} request
 * @returns {{ override: object | undefined, error?: string }}
 */
export function nextOverride(key, current, { name, type } = {}) {
  const override = { ...(current ?? {}) };
  const choice = type || TYPE_CHOICES.UNCHANGED;
  if (choice !== TYPE_CHOICES.UNCHANGED) {
    if (!isRelayKey(key)) {
      return { override: current, error: 'type-not-relay' };
    }
    if (choice === TYPE_CHOICES.AUTO) {
      delete override.category;
    } else if (choice === RELAY_KINDS.SWITCH || choice === RELAY_KINDS.LIGHT) {
      override.category = choice;
    } else {
      return { override: current, error: 'type-invalid' };
    }
  }
  const newName = String(name ?? '').trim();
  if (newName === RESET_NAME) {
    delete override.name;
  } else if (newName) {
    override.name = newName.slice(0, MAX_NAME_LENGTH);
  }
  return { override: Object.keys(override).length > 0 ? override : undefined };
}
