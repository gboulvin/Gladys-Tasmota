// -----------------------------------------------------------------------------
// Application-level connection status shown in the Configuration screen
// (`gladys.setConnectionStatus`), derived from the manager summary.
//
// The form shows the fields of every option at once (the Gladys form engine
// has no conditional display), so each message names the option the user
// chose and the block to fill in: the user always knows what is expected.
// -----------------------------------------------------------------------------

import { MQTT_MODES } from './config.js';
import { t } from './i18n.js';

/**
 * @param {ReturnType<import('./manager.js').TasmotaManager['summary']>} summary
 * @returns {{ connected: boolean, message?: object }}
 */
export function connectionStatusOf(summary) {
  const reason = summary.brokerError ? ` (${String(summary.brokerError).slice(0, 100)})` : '';

  if (summary.mode === MQTT_MODES.DISABLED) {
    return {
      connected: true,
      message: t(
        'Option 3 — HTTP only: the devices listed in block 3 are read over HTTP.',
        'Option 3 — HTTP uniquement : les appareils listés dans le bloc 3 sont lus en HTTP.',
        'Option 3 — nur HTTP: Die in Block 3 aufgeführten Geräte werden per HTTP gelesen.',
        'Opción 3 — solo HTTP: los dispositivos del bloque 3 se leen por HTTP.',
      ),
    };
  }

  if (summary.mode === MQTT_MODES.EMBEDDED) {
    if (summary.brokerConnected) {
      return {
        connected: true,
        message: t(
          'Option 2 — the dedicated broker is running. Use the "Get the command for the devices" action to connect your devices.',
          "Option 2 — le broker dédié fonctionne. Utilisez l'action « Obtenir la commande pour les appareils » pour connecter vos appareils.",
          'Option 2 — der eigene Broker läuft. Nutzen Sie die Aktion „Befehl für die Geräte abrufen“, um Ihre Geräte zu verbinden.',
          'Opción 2 — el broker dedicado funciona. Use la acción «Obtener el comando para los dispositivos» para conectar sus dispositivos.',
        ),
      };
    }
    if (summary.brokerStartError) {
      return {
        connected: false,
        message: t(
          `Option 2 — the dedicated broker could not start${reason}. Check the integration logs, or choose option 1 with your own broker.`,
          `Option 2 — le broker dédié n'a pas pu démarrer${reason}. Consultez les logs de l'intégration, ou choisissez l'option 1 avec votre propre broker.`,
          `Option 2 — der eigene Broker konnte nicht starten${reason}. Prüfen Sie die Logs der Integration oder wählen Sie Option 1 mit Ihrem eigenen Broker.`,
          `Opción 2 — el broker dedicado no pudo iniciarse${reason}. Revise los registros de la integración o elija la opción 1 con su propio broker.`,
        ),
      };
    }
    return {
      connected: false,
      message: t(
        `Option 2 — the dedicated broker is starting, connection in progress${reason}.`,
        `Option 2 — le broker dédié démarre, connexion en cours${reason}.`,
        `Option 2 — der eigene Broker startet, Verbindung läuft${reason}.`,
        `Opción 2 — el broker dedicado se está iniciando, conexión en curso${reason}.`,
      ),
    };
  }

  // Option 1: the user's own broker.
  if (summary.mqttUrlMissing) {
    return {
      connected: false,
      message: t(
        'Option 1 chosen: enter the URL of your MQTT broker in block 1 (e.g. mqtt://192.168.1.10:1883), with its user and password if it has some.',
        "Option 1 choisie : saisissez l'URL de votre broker MQTT dans le bloc 1 (ex. mqtt://192.168.1.10:1883), avec son utilisateur et son mot de passe s'il en a.",
        'Option 1 gewählt: Geben Sie in Block 1 die URL Ihres MQTT-Brokers ein (z. B. mqtt://192.168.1.10:1883), mit Benutzer und Passwort, falls vorhanden.',
        'Opción 1 elegida: introduzca en el bloque 1 la URL de su broker MQTT (p. ej. mqtt://192.168.1.10:1883), con su usuario y contraseña si los tiene.',
      ),
    };
  }
  if (summary.brokerConnected) {
    return { connected: true };
  }
  return {
    connected: false,
    message: t(
      `Option 1 — your MQTT broker cannot be reached${reason}: check its URL, user and password in block 1.`,
      `Option 1 — votre broker MQTT est injoignable${reason} : vérifiez son URL, son utilisateur et son mot de passe dans le bloc 1.`,
      `Option 1 — Ihr MQTT-Broker ist nicht erreichbar${reason}: Prüfen Sie URL, Benutzer und Passwort in Block 1.`,
      `Opción 1 — su broker MQTT es inaccesible${reason}: compruebe su URL, usuario y contraseña en el bloque 1.`,
    ),
  };
}
