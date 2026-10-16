// -----------------------------------------------------------------------------
// Dashboard widgets (manifest `widgets`, Gladys 5.1+).
//
//   - tasmota_overview : the fleet at a glance — online / offline counts,
//     broker connection, the state of each device, a "refresh" button;
//   - tasmota_device   : one device (setting `device`) — its main live values,
//     identity rows (IP, firmware, signal, uptime) and its buttons (toggle,
//     identify, restart);
//   - tasmota_energy   : the energy metering of one device — power chart, live
//     power / voltage / current, today / yesterday / total.
//
// Contents are declarative (the core renders them); device-bound tiles and
// charts are LIVE (they follow the published states without any nudge). The
// computed parts are nudged by index.js through refreshWidgets().
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  WIDGET_CHART_INTERVALS,
  WIDGET_COLORS,
} from '@gladysassistant/integration-sdk';
import { identifyMessage } from './actions.js';
import { MQTT_MODES } from './config.js';
import { t } from './i18n.js';

const logger = createLogger({ name: 'widgets' });

export const OVERVIEW_WIDGET = 'tasmota_overview';
export const DEVICE_WIDGET = 'tasmota_device';
export const ENERGY_WIDGET = 'tasmota_energy';

const ACTION_KEYS = {
  REFRESH: 'refresh',
  TOGGLE: 'toggle',
  IDENTIFY: 'identify',
  RESTART: 'restart',
};

const ONLINE = {
  true: { value: t('Online', 'En ligne', 'Online', 'En línea'), color: WIDGET_COLORS.SUCCESS },
  false: {
    value: t('Offline', 'Hors ligne', 'Offline', 'Desconectado'),
    color: WIDGET_COLORS.DANGER,
  },
  null: {
    value: t('Unknown', 'Inconnu', 'Unbekannt', 'Desconocido'),
    color: WIDGET_COLORS.NEUTRAL,
  },
};

const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function brokerStatus(summary) {
  if (summary.mode === MQTT_MODES.DISABLED) {
    return {
      value: t('Disabled', 'Désactivé', 'Deaktiviert', 'Desactivado'),
      color: WIDGET_COLORS.NEUTRAL,
    };
  }
  return summary.brokerConnected
    ? { value: t('Connected', 'Connecté', 'Verbunden', 'Conectado'), color: WIDGET_COLORS.SUCCESS }
    : {
        value: t('Disconnected', 'Déconnecté', 'Getrennt', 'Desconectado'),
        color: WIDGET_COLORS.DANGER,
      };
}

function emptyDevice() {
  return {
    ttl_seconds: 300,
    components: [
      {
        type: 'text',
        variant: 'body',
        text: t(
          'Pick a Tasmota device in the widget settings.',
          'Choisissez un appareil Tasmota dans les réglages du widget.',
          'Wählen Sie ein Tasmota-Gerät in den Widget-Einstellungen.',
          'Elija un dispositivo Tasmota en los ajustes del widget.',
        ),
      },
    ],
  };
}

/** Feature keys of a record, filtered by category (and type). */
function featureKeys(record, category, type) {
  return Object.entries(record.features)
    .filter(([, spec]) => spec.category === category && (!type || spec.type === type))
    .map(([key]) => key);
}

function overviewContent(manager) {
  const summary = manager.summary();
  const items = [
    {
      label: t('MQTT broker', 'Broker MQTT', 'MQTT-Broker', 'Broker MQTT'),
      icon: 'radio',
      ...brokerStatus(summary),
    },
    ...summary.records.slice(0, 9).map((record) => ({
      label: truncate(record.name, 40),
      icon: record.protocol === 'mqtt' ? 'wifi' : 'globe',
      ...ONLINE[String(record.online)],
    })),
  ];
  return {
    ttl_seconds: 120,
    components: [
      {
        type: 'value',
        label: t('Devices', 'Appareils', 'Geräte', 'Dispositivos'),
        icon: 'cpu',
        value: summary.total,
      },
      {
        type: 'value',
        label: t('Online', 'En ligne', 'Online', 'En línea'),
        icon: 'check-circle',
        value: summary.online,
        color: WIDGET_COLORS.SUCCESS,
      },
      {
        type: 'value',
        label: t('Offline', 'Hors ligne', 'Offline', 'Desconectados'),
        icon: 'alert-circle',
        value: summary.offline,
        color: summary.offline > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
      },
      { type: 'status', items },
      {
        type: 'button',
        label: t('Refresh', 'Actualiser', 'Aktualisieren', 'Actualizar'),
        icon: 'refresh-cw',
        style: 'secondary',
        action: { key: ACTION_KEYS.REFRESH },
      },
    ],
  };
}

function deviceContent(manager, record) {
  const ids = manager.ids(record.mac);
  const tileKeys = [
    ...featureKeys(record, C.SWITCH, T.SWITCH.BINARY),
    ...featureKeys(record, C.LIGHT, T.LIGHT.BINARY),
    ...featureKeys(record, C.LIGHT, T.LIGHT.BRIGHTNESS),
    ...featureKeys(record, C.SHUTTER, T.SHUTTER.POSITION),
    ...featureKeys(record, C.ENERGY_SENSOR, T.ENERGY_SENSOR.POWER),
    ...featureKeys(record, C.TEMPERATURE_SENSOR),
    ...featureKeys(record, C.HUMIDITY_SENSOR),
    ...featureKeys(record, C.FAN),
  ].slice(0, 4);

  const tiles = tileKeys.map((key) => ({
    type: 'value',
    label: truncate(record.features[key].name, 24),
    device_feature: ids.feature(key),
  }));

  // Budget of a widget: 8 components. 4 tiles + 1 status + up to 3 buttons,
  // so the device name is the first status row rather than a heading.
  const items = [
    {
      label: t('Device', 'Appareil', 'Gerät', 'Dispositivo'),
      icon: 'cpu',
      value: truncate(record.name, 40),
      color: WIDGET_COLORS.NEUTRAL,
    },
    {
      label: t('State', 'État', 'Status', 'Estado'),
      icon: 'activity',
      ...ONLINE[String(record.online)],
    },
    {
      label: t('Connection', 'Connexion', 'Verbindung', 'Conexión'),
      icon: 'link',
      value: record.protocol.toUpperCase(),
      color: WIDGET_COLORS.INFO,
    },
  ];
  if (record.ip) {
    items.push({
      label: t('IP address', 'Adresse IP', 'IP-Adresse', 'Dirección IP'),
      icon: 'globe',
      value: record.ip,
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  if (record.firmware) {
    items.push({
      label: t('Firmware', 'Firmware', 'Firmware', 'Firmware'),
      icon: 'package',
      value: truncate(String(record.firmware), 40),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  if (record.rssi !== undefined) {
    const rssi = Number(record.rssi);
    items.push({
      label: t('Wi-Fi signal', 'Signal Wi-Fi', 'WLAN-Signal', 'Señal Wi-Fi'),
      icon: 'wifi',
      value: `${rssi} %`,
      color:
        rssi >= 60
          ? WIDGET_COLORS.SUCCESS
          : rssi >= 30
            ? WIDGET_COLORS.WARNING
            : WIDGET_COLORS.DANGER,
    });
  }
  if (record.uptime) {
    items.push({
      label: t('Uptime', 'Disponibilité', 'Laufzeit', 'Tiempo activo'),
      icon: 'clock',
      value: truncate(String(record.uptime), 40),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }

  const buttons = [];
  const firstPower = Object.keys(record.features).find((key) => /^power\d*$/.test(key));
  if (firstPower) {
    buttons.push({
      type: 'button',
      label: t('Toggle', 'Basculer', 'Umschalten', 'Alternar'),
      icon: 'power',
      style: 'primary',
      action: { key: ACTION_KEYS.TOGGLE, params: { device: ids.device, power: firstPower } },
    });
  }
  if (record.ctx?.isLight) {
    buttons.push({
      type: 'button',
      label: t('Identify', 'Identifier', 'Identifizieren', 'Identificar'),
      icon: 'eye',
      style: 'secondary',
      action: { key: ACTION_KEYS.IDENTIFY, params: { device: ids.device } },
    });
  }
  buttons.push({
    type: 'button',
    label: t('Restart', 'Redémarrer', 'Neustart', 'Reiniciar'),
    icon: 'rotate-cw',
    style: 'danger',
    action: { key: ACTION_KEYS.RESTART, params: { device: ids.device }, confirm: true },
  });

  return {
    ttl_seconds: 300,
    components: [...tiles, { type: 'status', items: items.slice(0, 10) }, ...buttons],
  };
}

function energyContent(manager, record) {
  const ids = manager.ids(record.mac);
  const energyKey = (field) => (record.features[`energy-${field}`] ? `energy-${field}` : null);
  const power = energyKey('power') ?? (record.features['energy-power-1'] ? 'energy-power-1' : null);
  if (!power) {
    return {
      ttl_seconds: 300,
      components: [
        {
          type: 'text',
          variant: 'body',
          text: t(
            'This device has no energy metering.',
            "Cet appareil ne mesure pas l'énergie.",
            'Dieses Gerät misst keine Energie.',
            'Este dispositivo no mide la energía.',
          ),
        },
      ],
    };
  }
  const components = [
    { type: 'text', variant: 'heading', text: truncate(record.name, 40) },
    {
      type: 'chart',
      title: t('Power', 'Puissance', 'Leistung', 'Potencia'),
      chart_type: 'area',
      device_features: [ids.feature(power)],
      interval: WIDGET_CHART_INTERVALS.LAST_DAY,
    },
    {
      type: 'value',
      label: t('Power', 'Puissance', 'Leistung', 'Potencia'),
      icon: 'zap',
      device_feature: ids.feature(power),
    },
  ];
  const tiles = [
    ['voltage', t('Voltage', 'Tension', 'Spannung', 'Tensión'), 'battery-charging'],
    ['current', t('Current', 'Courant', 'Strom', 'Corriente'), 'activity'],
    ['today', t('Today', "Aujourd'hui", 'Heute', 'Hoy'), 'sun'],
    ['yesterday', t('Yesterday', 'Hier', 'Gestern', 'Ayer'), 'calendar'],
    ['total', t('Total', 'Total', 'Gesamt', 'Total'), 'database'],
  ];
  for (const [field, label, icon] of tiles) {
    const key = energyKey(field);
    if (key) {
      components.push({ type: 'value', label, icon, device_feature: ids.feature(key) });
    }
  }
  // At most 6 tiles in a widget: the power tile plus five.
  return { ttl_seconds: 600, components };
}

export function createWidgets(manager) {
  const withRecord = (settings, build) => {
    const record = settings?.device ? manager.recordOf(settings.device) : undefined;
    return record ? build(record) : emptyDevice();
  };

  async function deviceAction(actionKey, params) {
    switch (actionKey) {
      case ACTION_KEYS.TOGGLE:
        await manager.sendCommand(params.device, params.power.toUpperCase(), 'TOGGLE');
        return t('Toggled.', 'Basculé.', 'Umgeschaltet.', 'Alternado.');
      case ACTION_KEYS.IDENTIFY:
        return identifyMessage(await manager.identify(params.device));
      case ACTION_KEYS.RESTART:
        await manager.restart(params.device);
        return t('Restarting…', 'Redémarrage…', 'Neustart…', 'Reiniciando…');
      default:
        throw new Error(`Unknown widget action: ${actionKey}`);
    }
  }

  return {
    [OVERVIEW_WIDGET]: {
      async get() {
        logger.debug(`onWidgetGet <- ${OVERVIEW_WIDGET}`);
        return overviewContent(manager);
      },
      async action(actionKey) {
        if (actionKey !== ACTION_KEYS.REFRESH) {
          throw new Error(`Unknown widget action: ${actionKey}`);
        }
        for (const record of manager.records.values()) {
          if (record.topic) {
            manager.requestStatus(record.topic, { force: true });
          }
        }
        return t(
          'Refresh requested.',
          'Actualisation demandée.',
          'Aktualisierung angefordert.',
          'Actualización solicitada.',
        );
      },
    },
    [DEVICE_WIDGET]: {
      async get({ settings }) {
        return withRecord(settings, (record) => deviceContent(manager, record));
      },
      async action(actionKey, params) {
        return deviceAction(actionKey, params);
      },
    },
    [ENERGY_WIDGET]: {
      async get({ settings }) {
        return withRecord(settings, (record) => energyContent(manager, record));
      },
    },
  };
}

/** Ask the core to re-pull every widget now (rate-limited core-side). */
export function refreshWidgets(gladys, widgets) {
  for (const key of Object.keys(widgets)) {
    gladys.requestWidgetRefresh(key);
  }
}
