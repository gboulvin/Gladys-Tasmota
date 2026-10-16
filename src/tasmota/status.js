// -----------------------------------------------------------------------------
// `Status 0` -> device identity. PURE module.
//
// `Status 0` returns every status block of a Tasmota device: identity
// (Status), firmware (StatusFWR), network (StatusNET), MQTT (StatusMQT),
// state (StatusSTS) and sensors (StatusSNS). Over HTTP it comes as one JSON;
// over MQTT, depending on the firmware, as one `STATUS0` message or as a
// series of `STATUS`, `STATUS1`... `STATUS11` messages, merged by the caller.
// -----------------------------------------------------------------------------

/** "84:F3:EB:12:AB:CD" / "84F3EB12ABCD" -> "84f3eb12abcd" (null if invalid). */
export function normalizeMac(mac) {
  if (typeof mac !== 'string') {
    return null;
  }
  const hex = mac.replace(/[^0-9a-f]/gi, '').toLowerCase();
  return hex.length === 12 ? hex : null;
}

/** "84f3eb12abcd" -> "84:F3:EB:12:AB:CD". */
export function formatMac(mac) {
  return mac.toUpperCase().match(/.{2}/g).join(':');
}

/** Is a status set complete enough to describe a device? */
export function isStatusComplete(status) {
  return Boolean(status?.Status && normalizeMac(status?.StatusNET?.Mac));
}

/**
 * Identity of a device from its (merged) `Status 0` blocks.
 * @param {object} status
 */
export function parseStatus(status) {
  const identity = status.Status ?? {};
  const network = status.StatusNET ?? {};
  const firmware = status.StatusFWR ?? {};
  const friendlyNames = Array.isArray(identity.FriendlyName)
    ? identity.FriendlyName
    : [identity.FriendlyName].filter(Boolean);
  const name = identity.DeviceName || friendlyNames[0] || network.Hostname || identity.Topic;
  return {
    mac: normalizeMac(network.Mac),
    name: String(name || 'Tasmota'),
    topic: identity.Topic ? String(identity.Topic) : undefined,
    ip: network.IPAddress && network.IPAddress !== '0.0.0.0' ? network.IPAddress : undefined,
    hostname: network.Hostname,
    module: identity.Module !== undefined ? String(identity.Module) : undefined,
    firmware: firmware.Version,
    hardware: firmware.Hardware,
    state: status.StatusSTS ?? {},
    sensors: status.StatusSNS ?? {},
  };
}
