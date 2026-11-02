// -----------------------------------------------------------------------------
// Manifest actions: the buttons of the Configuration screen.
//
// Each entry is keyed by the action `key` of the manifest `actions` field;
// index.js registers it with `gladys.onAction(key, ...)`. The resolved
// multi-language message is shown under the button, a thrown error too.
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_FEATURE_CATEGORIES } from '@gladysassistant/integration-sdk';
import { BROKER_DEVICE_USER, brokerHostPort } from './broker.js';
import { MQTT_MODES } from './config.js';
import { expandAddresses, isValidAddress } from './transports/http.js';
import { mapText, t } from './i18n.js';

const logger = createLogger({ name: 'actions' });

/** Message of the identify action, shared with the widgets. */
export function identifyMessage(signalled) {
  return signalled
    ? t(
        'Look around: the light is blinking.',
        'Regardez autour de vous : la lampe clignote.',
        'Schauen Sie sich um: Die Lampe blinkt.',
        'Mire a su alrededor: la luz parpadea.',
      )
    : t(
        'Only lights can signal themselves (a relay may drive a heater).',
        'Seules les lampes peuvent se signaler (un relais peut piloter un radiateur).',
        'Nur Lampen können sich bemerkbar machen (ein Relais kann eine Heizung steuern).',
        'Solo las luces pueden señalarse (un relé puede controlar un radiador).',
      );
}

function scanMessage({ found, authRequired }) {
  const names = found.map((record) => record.name).join(', ');
  const base = t(
    `${found.length} Tasmota device(s) found${names ? `: ${names}` : ''}.`,
    `${found.length} appareil(s) Tasmota trouvé(s)${names ? ` : ${names}` : ''}.`,
    `${found.length} Tasmota-Gerät(e) gefunden${names ? `: ${names}` : ''}.`,
    `${found.length} dispositivo(s) Tasmota encontrado(s)${names ? `: ${names}` : ''}.`,
  );
  if (authRequired.length === 0) {
    return base;
  }
  const list = authRequired.join(', ');
  const auth = t(
    ` Web password required for: ${list}.`,
    ` Mot de passe web requis pour : ${list}.`,
    ` Web-Passwort erforderlich für: ${list}.`,
    ` Se requiere contraseña web para: ${list}.`,
  );
  return mapText(base, (text, lang) => `${text}${auth[lang]}`);
}

const KIND_LABELS = {
  [DEVICE_FEATURE_CATEGORIES.LIGHT]: t('light', 'lampe', 'Lampe', 'luz'),
  [DEVICE_FEATURE_CATEGORIES.SWITCH]: t('switch', 'interrupteur', 'Schalter', 'interruptor'),
};

/** Message of the customize_feature action: what changed, and how it reaches Gladys. */
export function customizeMessage({ before, after, created }) {
  const renamed = before.name !== after.name;
  const retyped = before.category !== after.category;
  if (!renamed && !retyped) {
    return t(
      `Nothing changed: "${after.name}" already has these settings.`,
      `Rien n'a changé : « ${after.name} » a déjà ces réglages.`,
      `Nichts geändert: „${after.name}“ hat diese Einstellungen bereits.`,
      `Nada ha cambiado: «${after.name}» ya tiene estos ajustes.`,
    );
  }
  const kind = KIND_LABELS[after.category];
  const what = t(
    `"${before.name}" is now "${after.name}"${retyped ? ` (${kind.en})` : ''}.`,
    `« ${before.name} » devient « ${after.name} »${retyped ? ` (${kind.fr})` : ''}.`,
    `„${before.name}“ heißt jetzt „${after.name}“${retyped ? ` (${kind.de})` : ''}.`,
    `«${before.name}» pasa a ser «${after.name}»${retyped ? ` (${kind.es})` : ''}.`,
  );
  let next;
  if (!created) {
    next = t(
      'It applies when you add the device from the Discovery tab.',
      "Le changement s'appliquera quand vous ajouterez l'appareil depuis l'onglet Découverte.",
      'Es gilt, sobald Sie das Gerät im Reiter Erkennung hinzufügen.',
      'Se aplicará cuando añada el dispositivo desde la pestaña Descubrimiento.',
    );
  } else if (retyped) {
    next = t(
      'Open the Discovery tab and click Update on this device: history and scenes are kept.',
      "Ouvrez l'onglet Découverte et cliquez sur Mettre à jour sur cet appareil : l'historique et les scènes sont conservés.",
      'Öffnen Sie den Reiter Erkennung und klicken Sie bei diesem Gerät auf Aktualisieren: Verlauf und Szenen bleiben erhalten.',
      'Abra la pestaña Descubrimiento y pulse Actualizar en este dispositivo: se conservan el historial y las escenas.',
    );
  } else {
    next = t(
      'Gladys only offers Update for a type change: the new name applies at the next Update of this device.',
      "Gladys ne propose Mettre à jour que pour un changement de type : le nouveau nom s'appliquera à la prochaine mise à jour de cet appareil.",
      'Gladys bietet Aktualisieren nur bei einer Typänderung an: Der neue Name gilt bei der nächsten Aktualisierung dieses Geräts.',
      'Gladys solo ofrece Actualizar para un cambio de tipo: el nuevo nombre se aplicará en la próxima actualización de este dispositivo.',
    );
  }
  return mapText(what, (text, lang) => `${text} ${next[lang]}`);
}

export const ACTIONS = {
  async test_connection(manager) {
    const summary = manager.summary();
    const devices = t(
      `${summary.total} device(s), ${summary.online} online.`,
      `${summary.total} appareil(s), ${summary.online} en ligne.`,
      `${summary.total} Gerät(e), ${summary.online} online.`,
      `${summary.total} dispositivo(s), ${summary.online} en línea.`,
    );
    let broker;
    if (summary.mode === MQTT_MODES.DISABLED) {
      broker = t(
        'MQTT disabled (HTTP only).',
        'MQTT désactivé (HTTP seul).',
        'MQTT deaktiviert (nur HTTP).',
        'MQTT desactivado (solo HTTP).',
      );
    } else if (summary.brokerConnected) {
      broker = t(
        'MQTT broker connected.',
        'Broker MQTT connecté.',
        'MQTT-Broker verbunden.',
        'Broker MQTT conectado.',
      );
    } else {
      const reason = summary.brokerError ? ` (${summary.brokerError})` : '';
      broker = t(
        `MQTT broker NOT connected${reason}.`,
        `Broker MQTT NON connecté${reason}.`,
        `MQTT-Broker NICHT verbunden${reason}.`,
        `Broker MQTT NO conectado${reason}.`,
      );
    }
    return mapText(broker, (text, lang) => `${text} ${devices[lang]}`);
  },

  async broker_info(manager, { fields, gladys }) {
    if (manager.config.mqtt_mode !== MQTT_MODES.EMBEDDED) {
      return t(
        'This action is for option 2: choose "Option 2 — Dedicated broker deployed by the integration" as connection mode and save first.',
        "Cette action concerne l'option 2 : choisissez d'abord le mode de connexion « Option 2 — Broker dédié déployé par l'intégration » et enregistrez.",
        'Diese Aktion gilt für Option 2: Wählen Sie zuerst den Verbindungsmodus „Option 2 — Eigener Broker, von der Integration bereitgestellt“ und speichern Sie.',
        'Esta acción es para la opción 2: elija primero el modo de conexión «Opción 2 — Broker dedicado desplegado por la integración» y guarde.',
      );
    }
    const port = await brokerHostPort(gladys);
    const host = fields.gladys_host?.trim() || '<Gladys IP>';
    const backlog = `Backlog MqttHost ${host}; MqttPort ${port ?? '?'}; MqttUser ${BROKER_DEVICE_USER}; MqttPassword ${manager.brokerDevicePassword ?? '?'}`;
    return t(
      `Paste this in the Tasmota console of each device: ${backlog}`,
      `Collez ceci dans la console Tasmota de chaque appareil : ${backlog}`,
      `Fügen Sie dies in die Tasmota-Konsole jedes Geräts ein: ${backlog}`,
      `Pegue esto en la consola Tasmota de cada dispositivo: ${backlog}`,
    );
  },

  async add_http_device(manager, { fields }) {
    const address = String(fields.address ?? '').trim();
    if (!isValidAddress(address)) {
      throw new Error(`Invalid address: ${address}`);
    }
    const credentials = fields.username
      ? { username: fields.username, password: fields.password ?? '' }
      : undefined;
    const record = await manager.probeHttp(address, credentials);
    await manager.publishDevices();
    return t(
      `${record.name} added: find it in the Discovery tab.`,
      `${record.name} ajouté : retrouvez-le dans l'onglet Découverte.`,
      `${record.name} hinzugefügt: Sie finden es im Reiter Erkennung.`,
      `${record.name} añadido: encuéntrelo en la pestaña Descubrimiento.`,
    );
  },

  async scan_http(manager, { fields }) {
    const addresses = expandAddresses(fields.range);
    logger.info(`HTTP scan of ${addresses.length} address(es)`);
    const credentials = fields.username
      ? { username: fields.username, password: fields.password ?? '' }
      : undefined;
    const result = await manager.scanHttp(addresses, credentials);
    if (result.found.length > 0) {
      await manager.publishDevices();
    }
    return scanMessage(result);
  },

  async identify(manager, { fields }) {
    return identifyMessage(await manager.identify(fields.device));
  },

  async send_command(manager, { fields }) {
    const answer = await manager.sendCommand(fields.device, fields.command, fields.payload);
    if (answer === null || answer === undefined) {
      return t(
        'Command sent (no answer within 5 seconds).',
        'Commande envoyée (pas de réponse sous 5 secondes).',
        'Befehl gesendet (keine Antwort innerhalb von 5 Sekunden).',
        'Comando enviado (sin respuesta en 5 segundos).',
      );
    }
    const text = answer.length > 900 ? `${answer.slice(0, 900)}…` : answer;
    return t(`Answer: ${text}`, `Réponse : ${text}`, `Antwort: ${text}`, `Respuesta: ${text}`);
  },

  async restart(manager, { fields }) {
    await manager.restart(fields.device);
    return t(
      'Restarting: the device is back in about 10 seconds.',
      "Redémarrage : l'appareil revient dans une dizaine de secondes.",
      'Neustart: Das Gerät ist in etwa 10 Sekunden zurück.',
      'Reiniciando: el dispositivo vuelve en unos 10 segundos.',
    );
  },

  async configure_mqtt(manager, { fields, gladys }) {
    const host = String(fields.host ?? '').trim();
    if (!isValidAddress(host)) {
      throw new Error(`Invalid broker address: ${host}`);
    }
    const embedded = manager.config.mqtt_mode === MQTT_MODES.EMBEDDED;
    const port = Number(fields.port) || (embedded ? await brokerHostPort(gladys) : 1883);
    if (!port) {
      throw new Error('The embedded broker has no port yet: save the configuration first.');
    }
    await manager.configureMqtt(fields.device, {
      host,
      port,
      username: fields.username || (embedded ? BROKER_DEVICE_USER : manager.config.mqtt_username),
      password:
        fields.password || (embedded ? manager.brokerDevicePassword : manager.config.mqtt_password),
    });
    return t(
      `Broker ${host}:${port} sent: the device restarts and joins it.`,
      `Broker ${host}:${port} envoyé : l'appareil redémarre et s'y connecte.`,
      `Broker ${host}:${port} gesendet: Das Gerät startet neu und verbindet sich.`,
      `Broker ${host}:${port} enviado: el dispositivo se reinicia y se conecta.`,
    );
  },

  async customize_feature(manager, { fields }) {
    try {
      return customizeMessage(
        await manager.customizeFeature(fields.device, {
          feature: fields.feature,
          name: fields.name,
          type: fields.type,
        }),
      );
    } catch (err) {
      if (err.code === 'feature-unknown') {
        const list = err.available.join(', ');
        return t(
          `No feature "${fields.feature}" on this device. Its features: ${list}.`,
          `Aucune fonctionnalité « ${fields.feature} » sur cet appareil. Ses fonctionnalités : ${list}.`,
          `Keine Funktion „${fields.feature}“ an diesem Gerät. Seine Funktionen: ${list}.`,
          `No hay ninguna función «${fields.feature}» en este dispositivo. Sus funciones: ${list}.`,
        );
      }
      if (err.code === 'type-not-relay') {
        return t(
          'Only a relay can become a switch or a light: leave the type on "Unchanged" for this feature.',
          'Seul un relais peut devenir interrupteur ou lampe : laissez le type sur « Inchangé » pour cette fonctionnalité.',
          'Nur ein Relais kann Schalter oder Lampe werden: Lassen Sie den Typ für diese Funktion auf „Unverändert“.',
          'Solo un relé puede ser interruptor o luz: deje el tipo en «Sin cambios» para esta función.',
        );
      }
      throw err;
    }
  },
};
