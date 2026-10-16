# Tasmota

Pilotez vos appareils [Tasmota](https://tasmota.github.io/) depuis Gladys, **100 % en local** :
prises, relais, ampoules et rubans LED, variateurs, volets, ventilateurs, compteurs d'énergie et
capteurs. Aucun cloud.

## Ce que vous obtenez

- **Découverte automatique** en MQTT (`LWT`, `Status 0` et la découverte native de Tasmota) et
  en HTTP (une liste d'adresses, ou le scan d'une plage d'IP).
- Chaque appareil est identifié par son **adresse MAC** : le renommer, changer son topic ou son
  IP, ou le passer de HTTP à MQTT conserve le même appareil Gladys et son historique.
- **Relais** (`POWER1`…`POWER8`), **lampes** (marche/arrêt, luminosité, couleur RVB, température
  de blanc, effets et leur vitesse), **ventilateurs** (`FanSpeed`), **volets** (ouvrir / fermer /
  stop, position).
- **Mesure d'énergie** : puissance, puissances apparente et réactive, tension, courant, énergie
  du jour, de la veille et totale (le total est un index cumulé, exploitable par le suivi
  d'énergie de Gladys), compteurs multi-canaux compris.
- **Capteurs** : température, humidité, pression, luminosité, CO2, COV, PM2.5 / PM10, distance,
  indice UV, humidité du sol, entrées analogiques, compteurs d'impulsions, entrées interrupteur,
  température de la puce, signal Wi-Fi et durée de fonctionnement.
- **Déclencheurs de scène** : bouton appuyé (simple, double, triple… appui long), entrée
  interrupteur changée, code RF reçu (Sonoff RF Bridge), code IR reçu, appareil en ligne / hors
  ligne.
- **Actions de scène** : envoyer n'importe quelle commande Tasmota (Backlog, RfSend, IRSend,
  Rule…), allumer un relais un moment, faire clignoter une lampe, redémarrer un appareil.
- **Widgets de tableau de bord** : vue d'ensemble, fiche d'un appareil, fiche énergie.
- Un **badge « Local »** sur chaque appareil, orange quand le broker est tombé et que les
  commandes passent par HTTP, rouge quand l'appareil est injoignable.

## Choisir comment les appareils parlent à Gladys

### Option 1 — Votre broker MQTT (recommandé si vous en avez déjà un)

Si vous utilisez l'intégration **MQTT** de Gladys, son broker tourne déjà sur la machine Gladys
(port 1883, avec l'utilisateur et le mot de passe affichés dans cette intégration).

1. Dans **Configuration**, gardez **Broker MQTT : Mon broker MQTT**.
2. **URL du broker** : `mqtt://<IP du broker>:1883` — utilisez l'adresse IP du réseau local,
   pas `localhost` (l'intégration tourne dans son propre conteneur).
3. Renseignez l'**utilisateur** et le **mot de passe du broker**, puis enregistrez.
4. Sur chaque appareil Tasmota : **Configuration → MQTT**, saisissez le même hôte, port,
   utilisateur et mot de passe. Gardez le **Full Topic** par défaut `%prefix%/%topic%/` (ou
   choisissez `%topic%/%prefix%/` dans la configuration si c'est celui que vous utilisez).

### Option 2 — Le broker intégré (pas encore de broker)

1. Choisissez **Broker MQTT : Broker intégré** et enregistrez. L'intégration démarre son propre
   broker Mosquitto dans un sous-conteneur ; l'écran de configuration affiche l'adresse et le
   port que les appareils doivent utiliser (utilisateur `tasmota`).
2. Cliquez sur l'action **Réglages du broker intégré** (saisissez l'adresse IP de Gladys) : elle
   donne une commande prête à coller, par exemple
   `Backlog MqttHost 192.168.1.10; MqttPort 41883; MqttUser tasmota; MqttPassword …`.
3. Collez-la dans la **Console** de chaque appareil Tasmota. L'appareil redémarre et apparaît
   dans Gladys.

Laissez **Mot de passe des appareils** vide pour en générer un, ou saisissez le vôtre.

### Option 3 — HTTP uniquement

Choisissez **Broker MQTT : Pas de MQTT (HTTP seul)**, puis listez les adresses dans **Adresses
HTTP** (`192.168.1.20, 192.168.1.30-45`) ou utilisez l'action **Scanner une plage d'IP**. Les
appareils HTTP sont lus toutes les **Intervalle de rafraîchissement HTTP** secondes (30 par
défaut). Si un mot de passe web est défini sur vos appareils, renseignez **Utilisateur web**
(`admin`) et **Mot de passe web**.

HTTP et MQTT peuvent se combiner : un appareil trouvé en HTTP qui se connecte ensuite au broker
passe en MQTT tout seul. L'action **Passer un appareil en MQTT** envoie pour vous les réglages
du broker à un appareil HTTP.

## Ajouter les appareils

Ouvrez l'onglet **Découverte** de l'intégration : les appareils trouvés y apparaissent, avec
leurs fonctionnalités. Cliquez sur **Ajouter**, choisissez la pièce, c'est fini. Quand un
appareil gagne une fonctionnalité (un capteur branché, un nouveau firmware), un bouton **Mettre
à jour** apparaît.

## Actions de l'écran de configuration

- **Tester la connexion** — état du broker et nombre d'appareils en ligne.
- **Réglages du broker intégré** — la commande console pour le broker intégré.
- **Ajouter un appareil HTTP** / **Scanner une plage d'IP** — trouver des appareils en HTTP
  (1024 adresses au plus).
- **Identifier une lampe** — la lampe clignote deux fois puis revient à son état. Les relais ne
  clignotent jamais (ils peuvent piloter un radiateur).
- **Envoyer une commande** — n'importe quelle commande Tasmota, la réponse s'affiche sous le
  bouton.
- **Redémarrer un appareil**.
- **Passer un appareil en MQTT** — envoie `MqttHost`, `MqttPort`, `MqttUser`, `MqttPassword`.

## Scènes

Dans la catégorie **Intégrations** de l'éditeur de scènes (Gladys 5.1 ou plus récent) :

| Déclencheur                            | Réglage Tasmota nécessaire                            | Variables          |
| -------------------------------------- | ----------------------------------------------------- | ------------------ |
| Bouton Tasmota appuyé                  | `SetOption73 1` (boutons découplés des relais)        | `button`, `action` |
| Entrée interrupteur Tasmota changée    | `SetOption114 1` (interrupteurs découplés des relais) | `switch`, `action` |
| Code RF reçu                           | un RF Bridge (`RfReceived`)                           | `code`, `rf_key`   |
| Code IR reçu                           | un récepteur IR (`IrReceived`)                        | `code`, `protocol` |
| Appareil Tasmota en ligne / hors ligne | aucun (LWT en MQTT, échecs de lecture en HTTP)        | `status`           |

Chaque filtre est facultatif : laissé vide, il accepte tout. Lisez les valeurs dans les actions
suivantes avec `{{triggerEvent.data.code}}`, par exemple.

Actions : **Envoyer une commande Tasmota** (sorties `answered` et `response`), **Allumer un relais
un moment** (l'appareil le coupe lui-même, jusqu'à 360 s), **Faire clignoter une lampe Tasmota**,
**Redémarrer un appareil Tasmota**.

Les états eux-mêmes (un relais, une température…) sont des fonctionnalités d'appareil
classiques : utilisez pour eux le déclencheur « État d'un appareil » et l'action « Contrôler un
appareil » de Gladys.

## Tableau de bord

- **Appareils Tasmota** — nombre d'appareils, en ligne et hors ligne, connexion au broker, état
  de chaque appareil, bouton **Actualiser**.
- **Appareil Tasmota** — choisissez un appareil : ses principales valeurs en direct, IP,
  firmware, signal Wi-Fi, durée de fonctionnement, et les boutons **Basculer**, **Identifier**
  (lampes) et **Redémarrer**.
- **Énergie Tasmota** — choisissez un appareil de mesure : courbe de puissance sur 24 heures,
  puissance, tension et courant en direct, énergie du jour, de la veille et totale.

## Dépannage

- **Rien dans Découverte (MQTT)** : vérifiez que l'URL du broker utilise l'IP du réseau local,
  et que les appareils affichent « MQTT connected » dans leur console. Cliquez sur **Scanner**
  dans l'onglet Découverte : chaque appareil connu est réinterrogé.
- **Un appareil demande un mot de passe (HTTP)** : renseignez l'utilisateur et le mot de passe
  web dans la configuration, ou dans les champs des actions Ajouter / Scanner.
- **Les boutons ne déclenchent pas les scènes** : envoyez `SetOption73 1` à l'appareil (et
  `SetOption114 1` pour les entrées interrupteur).
- **Logs** : ouvrez les logs de l'intégration depuis Gladys ; `LOG_LEVEL=debug` donne tout le
  détail.
