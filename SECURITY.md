# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration, of Gladys and of the Tasmota firmware;
- whether you use your own MQTT broker, the embedded broker or HTTP only;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords, MQTT credentials and
  addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository, the Docker image it publishes, and the
configuration it generates for the embedded Mosquitto broker.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the Tasmota firmware (see the
[Tasmota project](https://github.com/arendst/Tasmota)), Eclipse Mosquitto, and
third-party brokers.

## How the integration handles secrets

- Broker and web passwords are `secret` fields: Gladys never sends them back to
  the browser, and the integration never logs them (broker URLs are logged with
  the password masked).
- The embedded broker refuses anonymous clients. Its passwords are stored as
  PBKDF2-SHA512 hashes in its password file; the clear values live in
  `/data/broker.json` (mode 0600), inside the private volume of the
  integration.
- Per-device HTTP credentials typed in an action are kept in
  `/data/devices.json` (mode 0600), never in the device parameters Gladys
  displays.
- The Tasmota HTTP API only supports credentials in the URL, in clear text on
  the LAN: prefer MQTT with a password, or keep the devices on a trusted
  network.
