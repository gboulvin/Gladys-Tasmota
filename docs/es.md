# Tasmota

Controle sus dispositivos [Tasmota](https://tasmota.github.io/) desde Gladys, **100 % en local**:
enchufes, relés, bombillas y tiras LED, reguladores, persianas, ventiladores, medidores de energía
y sensores. Sin nube.

## Qué obtiene

- **Descubrimiento automático** por MQTT (`LWT`, `Status 0` y el descubrimiento nativo de
  Tasmota) y por HTTP (una lista de direcciones o el escaneo de un rango de IP).
- Cada dispositivo se identifica por su **dirección MAC**: renombrarlo, cambiar su topic o su IP,
  o pasarlo de HTTP a MQTT conserva el mismo dispositivo Gladys y su historial.
- **Relés** (`POWER1`…`POWER8`), **luces** (encendido/apagado, brillo, color RGB, temperatura de
  blanco, efectos y su velocidad), **ventiladores** (`FanSpeed`), **persianas** (abrir / cerrar /
  parar, posición).
- **Medición de energía**: potencia, potencias aparente y reactiva, tensión, corriente, energía
  de hoy, de ayer y total (el total es un índice acumulado, utilizable por el seguimiento de
  energía de Gladys), medidores multicanal incluidos.
- **Sensores**: temperatura, humedad, presión, iluminancia, CO2, COV, PM2.5 / PM10, distancia,
  índice UV, humedad del suelo, entradas analógicas, contadores de impulsos, entradas de
  interruptor, temperatura del chip, señal Wi-Fi y tiempo activo.
- **Disparadores de escena**: botón pulsado (simple, doble, triple… mantenido), entrada de
  interruptor cambiada, código RF recibido (Sonoff RF Bridge), código IR recibido, dispositivo en
  línea / desconectado.
- **Acciones de escena**: enviar cualquier comando Tasmota (Backlog, RfSend, IRSend, Rule…),
  encender un relé un tiempo, hacer parpadear una luz, reiniciar un dispositivo.
- **Widgets del panel**: vista general, ficha de dispositivo, ficha de energía.
- Una **insignia «Local»** en cada dispositivo, naranja cuando el broker no responde y los
  comandos pasan por HTTP, roja cuando el dispositivo es inaccesible.

## Elegir cómo hablan los dispositivos con Gladys

### Opción 1 — Su broker MQTT (recomendado si ya tiene uno)

Si usa la integración **MQTT** de Gladys, su broker ya funciona en el equipo de Gladys
(puerto 1883, con el usuario y la contraseña que muestra esa integración).

1. En **Configuración**, deje **Broker MQTT: Mi broker MQTT**.
2. **URL del broker**: `mqtt://<IP del broker>:1883` — use la IP de la red local, no
   `localhost` (la integración funciona en su propio contenedor).
3. Indique el **usuario** y la **contraseña del broker** y guarde.
4. En cada dispositivo Tasmota: **Configuration → MQTT**, introduzca el mismo host, puerto,
   usuario y contraseña. Conserve el **Full Topic** predeterminado `%prefix%/%topic%/` (o elija
   `%topic%/%prefix%/` en la configuración si es el que usa).

### Opción 2 — El broker integrado (todavía sin broker)

1. Elija **Broker MQTT: Broker integrado** y guarde. La integración inicia su propio broker
   Mosquitto en un subcontenedor; la pantalla de configuración muestra la dirección y el puerto
   que deben usar los dispositivos (usuario `tasmota`).
2. Pulse la acción **Ajustes del broker integrado** (escriba la IP de Gladys): da un comando
   listo para pegar, por ejemplo
   `Backlog MqttHost 192.168.1.10; MqttPort 41883; MqttUser tasmota; MqttPassword …`.
3. Péguelo en la **Console** de cada dispositivo Tasmota. El dispositivo se reinicia y aparece en
   Gladys.

Deje **Contraseña de los dispositivos** vacía para generar una, o indique la suya.

### Opción 3 — Solo HTTP

Elija **Broker MQTT: Sin MQTT (solo HTTP)** y liste las direcciones en **Direcciones HTTP**
(`192.168.1.20, 192.168.1.30-45`) o use la acción **Escanear un rango de IP**. Los dispositivos
HTTP se leen cada **Intervalo de actualización HTTP** segundos (30 por defecto). Si sus
dispositivos tienen una contraseña web, indique **Usuario web** (`admin`) y **Contraseña web**.

HTTP y MQTT pueden combinarse: un dispositivo encontrado por HTTP que luego se conecta al broker
pasa a MQTT por sí solo. La acción **Pasar un dispositivo a MQTT** envía por usted los ajustes del
broker a un dispositivo HTTP.

## Añadir los dispositivos

Abra la pestaña **Descubrimiento** de la integración: allí aparecen los dispositivos
encontrados, con sus funciones. Pulse **Añadir**, elija la habitación y listo. Cuando un
dispositivo gana una función (un sensor conectado, un nuevo firmware), aparece un botón
**Actualizar**.

## Acciones de la pantalla de configuración

- **Probar la conexión** — estado del broker y número de dispositivos en línea.
- **Ajustes del broker integrado** — el comando de consola para el broker integrado.
- **Añadir un dispositivo HTTP** / **Escanear un rango de IP** — encontrar dispositivos por HTTP
  (1024 direcciones como máximo).
- **Identificar una luz** — la luz parpadea dos veces y vuelve a su estado. Los relés nunca
  parpadean (pueden controlar un radiador).
- **Enviar un comando** — cualquier comando Tasmota, la respuesta aparece bajo el botón.
- **Reiniciar un dispositivo**.
- **Pasar un dispositivo a MQTT** — envía `MqttHost`, `MqttPort`, `MqttUser`, `MqttPassword`.

## Escenas

En la categoría **Integraciones** del editor de escenas (Gladys 5.1 o posterior):

| Disparador                                  | Ajuste de Tasmota necesario                                | Variables          |
| ------------------------------------------- | ---------------------------------------------------------- | ------------------ |
| Botón Tasmota pulsado                       | `SetOption73 1` (botones desacoplados de los relés)        | `button`, `action` |
| Entrada de interruptor Tasmota cambiada     | `SetOption114 1` (interruptores desacoplados de los relés) | `switch`, `action` |
| Código RF recibido                          | un RF Bridge (`RfReceived`)                                | `code`, `rf_key`   |
| Código IR recibido                          | un receptor IR (`IrReceived`)                              | `code`, `protocol` |
| Dispositivo Tasmota en línea / desconectado | ninguno (LWT por MQTT, lecturas fallidas por HTTP)         | `status`           |

Cada filtro es opcional: vacío, acepta todo. Lea los valores en las acciones siguientes con
`{{triggerEvent.data.code}}`, por ejemplo.

Acciones: **Enviar un comando Tasmota** (salidas `answered` y `response`), **Encender un relé un
tiempo** (el dispositivo lo apaga por sí mismo, hasta 360 s), **Hacer parpadear una luz
Tasmota**, **Reiniciar un dispositivo Tasmota**.

Los estados en sí (un relé, una temperatura…) son funciones de dispositivo normales: use para
ellos el disparador «Estado de un dispositivo» y la acción «Controlar un dispositivo» de Gladys.

## Panel

- **Dispositivos Tasmota** — número de dispositivos, en línea y desconectados, conexión al
  broker, estado de cada dispositivo, un botón **Actualizar**.
- **Dispositivo Tasmota** — elija un dispositivo: sus principales valores en directo, IP,
  firmware, señal Wi-Fi, tiempo activo y los botones **Alternar**, **Identificar** (luces) y
  **Reiniciar**.
- **Energía Tasmota** — elija un medidor: curva de potencia de 24 horas, potencia, tensión y
  corriente en directo, energía de hoy, de ayer y total.

## Solución de problemas

- **Nada en Descubrimiento (MQTT)**: compruebe que la URL del broker usa la IP de la red local y
  que los dispositivos muestran «MQTT connected» en su consola. Pulse **Escanear** en la pestaña
  Descubrimiento: se vuelve a consultar cada dispositivo conocido.
- **Un dispositivo pide contraseña (HTTP)**: indique el usuario y la contraseña web en la
  configuración, o en los campos de las acciones Añadir / Escanear.
- **Los botones no disparan escenas**: envíe `SetOption73 1` al dispositivo (y `SetOption114 1`
  para las entradas de interruptor).
- **Registros**: abra los registros de la integración desde Gladys; `LOG_LEVEL=debug` da todo el
  detalle.
