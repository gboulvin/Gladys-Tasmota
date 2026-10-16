// -----------------------------------------------------------------------------
// Tasmota events -> scene triggers.
//
// Some Tasmota messages say "this happened" rather than "this is the state":
// a button pressed (SetOption73 1, or a ButtonTopic), a switch toggled with
// SetOption114 1, an RF code received by a Sonoff RF Bridge, an IR code
// received by an IR receiver. They become scene events (manifest
// `scene_triggers`), never states. PURE module: no I/O.
// -----------------------------------------------------------------------------

// Scene trigger keys, as declared in the manifest. Keys are forever.
export const TRIGGERS = {
  BUTTON: 'button_pressed',
  SWITCH: 'switch_changed',
  RF: 'rf_code_received',
  IR: 'ir_code_received',
  AVAILABILITY: 'availability_changed',
};

// Button actions Tasmota reports, as accepted by the trigger filter.
export const BUTTON_ACTIONS = ['SINGLE', 'DOUBLE', 'TRIPLE', 'QUAD', 'PENTA', 'HOLD', 'CLEAR'];

/**
 * Scene events carried by one Tasmota message (RESULT / SENSOR).
 * @param {object} payload parsed JSON message
 * @returns {{ key: string, data: object }[]} events WITHOUT the `device` key
 */
export function extractEvents(payload) {
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  const events = [];
  for (const [name, content] of Object.entries(payload)) {
    if (!content || typeof content !== 'object') {
      continue;
    }
    let match = /^Button(\d+)$/.exec(name);
    if (match && typeof content.Action === 'string') {
      events.push({
        key: TRIGGERS.BUTTON,
        data: { button: Number(match[1]), action: content.Action.toUpperCase() },
      });
      continue;
    }
    match = /^Switch(\d+)$/.exec(name);
    if (match && typeof content.Action === 'string') {
      events.push({
        key: TRIGGERS.SWITCH,
        data: { switch: Number(match[1]), action: content.Action.toUpperCase() },
      });
      continue;
    }
    if (name === 'RfReceived') {
      const data = String(content.Data ?? '');
      if (data) {
        events.push({
          key: TRIGGERS.RF,
          data: { code: data, rf_key: content.RfKey == null ? '' : String(content.RfKey) },
        });
      }
      continue;
    }
    if (name === 'IrReceived') {
      const data = String(content.Data ?? content.Hash ?? '');
      if (data) {
        events.push({
          key: TRIGGERS.IR,
          data: { code: data, protocol: String(content.Protocol ?? 'UNKNOWN') },
        });
      }
    }
  }
  return events;
}
