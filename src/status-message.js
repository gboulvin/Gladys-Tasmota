// -----------------------------------------------------------------------------
// Application-level connection status shown in the Configuration screen
// (`gladys.setConnectionStatus`), derived from the manager summary.
// -----------------------------------------------------------------------------

import { MQTT_MODES } from './config.js';
import { t } from './i18n.js';

/**
 * @param {ReturnType<import('./manager.js').TasmotaManager['summary']>} summary
 * @returns {{ connected: boolean, message?: object }}
 */
export function connectionStatusOf(summary) {
  if (summary.mode === MQTT_MODES.DISABLED) {
    return { connected: true };
  }
  // No URL yet is a configuration step, not an error: say what to do.
  if (summary.mqttUrlMissing) {
    return {
      connected: false,
      message: t(
        'Enter the URL of your MQTT broker, or choose the embedded broker.',
        "Saisissez l'URL de votre broker MQTT, ou choisissez le broker intégré.",
        'Geben Sie die URL Ihres MQTT-Brokers ein oder wählen Sie den integrierten Broker.',
        'Introduzca la URL de su broker MQTT o elija el broker integrado.',
      ),
    };
  }
  if (summary.brokerConnected) {
    return { connected: true };
  }
  const reason = summary.brokerError ? ` (${summary.brokerError})`.slice(0, 120) : '';
  return {
    connected: false,
    message: t(
      `MQTT broker unreachable${reason}.`,
      `Broker MQTT injoignable${reason}.`,
      `MQTT-Broker nicht erreichbar${reason}.`,
      `Broker MQTT inaccesible${reason}.`,
    ),
  };
}
