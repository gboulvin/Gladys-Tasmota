// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, Gladys 5.1+).
//
// `fields` arrive RESOLVED (scene variables substituted, defaults applied);
// a `"source": "devices"` field is the chosen device external_id. Each handler
// resolves the declared `outputs`. A device that cannot do it is an output,
// not a failure: a scene action is never a condition.
//
// Scene TRIGGERS are fired by the manager from the device messages (see
// src/tasmota/events.js and TasmotaManager.setOnline). Never fire one as a
// consequence of an action received here: a scene would loop.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'scenes' });

export const SCENE_ACTIONS = {
  async send_command(manager, { fields }) {
    logger.info(`Scene action send_command <- ${fields.device}: ${fields.command}`);
    const answer = await manager.sendCommand(fields.device, fields.command, fields.payload);
    return { answered: answer !== null && answer !== undefined, response: answer ?? '' };
  },

  async restart_device(manager, { fields }) {
    logger.info(`Scene action restart_device <- ${fields.device}`);
    await manager.restart(fields.device);
    return { restarted: true };
  },

  async identify_device(manager, { fields }) {
    logger.info(`Scene action identify_device <- ${fields.device}`);
    return { signalled: await manager.identify(fields.device) };
  },

  async pulse_relay(manager, { fields }) {
    logger.info(`Scene action pulse_relay <- ${fields.device}`);
    await manager.pulse(fields.device, fields.relay ?? 1, fields.duration ?? 5);
    return { started: true };
  },
};
