// -----------------------------------------------------------------------------
// Entry point of the Gladys Tasmota integration.
//
// Role of this file: wire the SDK to the TasmotaManager (src/manager.js). It
// holds NO protocol logic. It only:
//   1. instantiates the SDK (connection, auth, reconnection: handled for you);
//   2. registers the event handlers BEFORE connect();
//   3. connects, then (re)applies the configuration on every connection.
//
// Environment variables provided by the Gladys supervisor to the container:
//   GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { TasmotaManager } from './src/manager.js';
import { ACTIONS } from './src/actions.js';
import { SCENE_ACTIONS } from './src/scenes.js';
import { createWidgets, refreshWidgets } from './src/widgets.js';
import { connectionStatusOf } from './src/status-message.js';

const gladys = new GladysIntegration();
const manager = new TasmotaManager({ gladys });
const widgets = createWidgets(manager);

// Every change the widgets show (a device online/offline, the broker) nudges
// them; the core rate-limits the nudges (1 per 10 s per widget).
manager.onChange = () => {
  if (gladys.connected) {
    refreshWidgets(gladys, widgets);
    reportConnectionStatus();
  }
};

let lastStatusKey = null;
function reportConnectionStatus() {
  const { connected, message } = connectionStatusOf(manager.summary());
  const key = JSON.stringify([connected, message]);
  if (key === lastStatusKey) {
    return;
  }
  lastStatusKey = key;
  gladys.setConnectionStatus(connected, message).catch(() => {
    lastStatusKey = null;
  });
}

// --- Discovery: the user opened the Discovery tab or pressed "Scan" ----------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> asking every device for its status');
  for (const record of manager.records.values()) {
    if (record.topic) {
      manager.requestStatus(record.topic, { force: true });
    }
  }
  await manager.probeConfiguredAddresses();
  await manager.publishDevices();
});

// --- Commands -----------------------------------------------------------------
gladys.onSetValue(async (device, feature, value) => {
  logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
  await manager.setValue(device, feature, value);
});

// --- Polling of the HTTP devices -----------------------------------------------
gladys.onPoll(async (device) => {
  if (!(await manager.pollDevice(device))) {
    logger.debug(`onPoll skipped (not due) for ${device.external_id}`);
  }
});

// --- The user created / deleted a device: transport badges follow ------------
gladys.onDeviceCreated(async () => manager.publishTransportsSafe());
gladys.onDeviceUpdated(async () => manager.publishTransportsSafe());

// --- Manifest actions (Configuration screen) -----------------------------------
for (const [key, handler] of Object.entries(ACTIONS)) {
  gladys.onAction(key, (fields) => handler(manager, { fields, gladys }));
}

// --- Scene actions --------------------------------------------------------------
for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
  gladys.onSceneAction(key, (fields) => handler(manager, { fields, gladys }));
}

// --- Dashboard widgets ----------------------------------------------------------
for (const [key, widget] of Object.entries(widgets)) {
  gladys.onWidgetGet(key, (request) => widget.get(request));
  if (typeof widget.action === 'function') {
    gladys.onWidgetAction(key, (actionKey, params, extra) =>
      widget.action(actionKey, params, extra),
    );
  }
}

// --- Configuration ----------------------------------------------------------------
gladys.onConfigUpdated(async (config) => {
  logger.info('onConfigUpdated -> applying the new configuration');
  await manager.applyConfig(config);
  lastStatusKey = null;
  reportConnectionStatus();
  refreshWidgets(gladys, widgets);
});

// --- Connection lifecycle ---------------------------------------------------------
let loaded = false;
gladys.on('connected', async () => {
  try {
    if (!loaded) {
      await manager.load();
      loaded = true;
    }
    manager.adoptGladysDevices(gladys.devices);
    await manager.applyConfig(await gladys.getConfig());
    await manager.publishDevices();
    await manager.publishTransportsSafe();
    lastStatusKey = null;
    reportConnectionStatus();
    refreshWidgets(gladys, widgets);
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await gladys
      .setConnectionStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
        de: 'Initialisierung fehlgeschlagen, prüfen Sie die Logs der Integration.',
        es: 'La inicialización falló, revise los registros de la integración.',
      })
      .catch(() => {});
  }
});

// --- Graceful shutdown --------------------------------------------------------------
gladys.handleShutdown(async (signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  await manager.save().catch(() => {});
  manager.stop();
});

logger.info('Starting the Tasmota integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
