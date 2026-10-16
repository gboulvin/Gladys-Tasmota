// -----------------------------------------------------------------------------
// Tasmota HTTP API: `http://<ip>/cm?cmnd=<command>[&user=..&password=..]`.
//
// The integration container reaches the LAN in unicast (the bridge network
// NATs it), which is all the HTTP API needs. Used for the devices without
// MQTT, for the IP range scan and as a fallback when the broker is down.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'http' });

export const HTTP_TIMEOUT_MS = 5000;

// A range scan never probes more than this many addresses.
export const MAX_SCAN_ADDRESSES = 1024;

export class HttpAuthError extends Error {
  constructor(address) {
    super(`Tasmota at ${address} asks for a web user and password`);
    this.name = 'HttpAuthError';
  }
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const HOST = /^[a-z0-9]([a-z0-9-.]{0,251}[a-z0-9])?(:\d{1,5})?$/i;

/** Accept an IPv4, an IPv4:port or a host name; no scheme, no path. */
export function isValidAddress(address) {
  if (typeof address !== 'string') {
    return false;
  }
  const [host, port] = address.split(':');
  if (port !== undefined && !(Number(port) > 0 && Number(port) < 65536)) {
    return false;
  }
  return IPV4.test(host) || (HOST.test(address) && !/^[\d.]+$/.test(host));
}

export function ipToInt(ip) {
  return ip.split('.').reduce((acc, part) => acc * 256 + Number(part), 0);
}

export function intToIp(value) {
  return [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join('.');
}

/**
 * Expand a user list of addresses: "192.168.1.10, 192.168.1.20-192.168.1.40,
 * 192.168.1.50-60, tasmota-plug.local" -> the individual addresses.
 * @throws when an entry is invalid or the list is longer than MAX_SCAN_ADDRESSES
 */
export function expandAddresses(text) {
  const addresses = [];
  const entries = String(text ?? '')
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const entry of entries) {
    const range = /^([\d.]+)-([\d.]+)$/.exec(entry);
    if (range) {
      const first = range[1];
      // "192.168.1.50-60": the end is the last byte only.
      const last = range[2].includes('.') ? range[2] : first.replace(/\d+$/, range[2]);
      if (!IPV4.test(first) || !IPV4.test(last)) {
        throw new Error(`Invalid address range: ${entry}`);
      }
      const start = ipToInt(first);
      const end = ipToInt(last);
      if (end < start) {
        throw new Error(`Invalid address range: ${entry}`);
      }
      if (addresses.length + (end - start + 1) > MAX_SCAN_ADDRESSES) {
        throw new Error(`Too many addresses (${MAX_SCAN_ADDRESSES} at most)`);
      }
      for (let ip = start; ip <= end; ip += 1) {
        addresses.push(intToIp(ip));
      }
    } else if (isValidAddress(entry)) {
      addresses.push(entry);
    } else {
      throw new Error(`Invalid address: ${entry}`);
    }
  }
  if (addresses.length > MAX_SCAN_ADDRESSES) {
    throw new Error(`Too many addresses (${MAX_SCAN_ADDRESSES} at most)`);
  }
  return [...new Set(addresses)];
}

/** URL of a command, credentials included (never log it as is). */
export function buildCommandUrl(address, cmnd, { username, password } = {}) {
  const url = new URL(`http://${address}/cm`);
  if (username) {
    url.searchParams.set('user', username);
    if (password) {
      url.searchParams.set('password', password);
    }
  }
  url.searchParams.set('cmnd', cmnd);
  return url.href;
}

/**
 * Send one command to a Tasmota device over HTTP and return its JSON answer.
 * @param {string} address IP or host name
 * @param {string} cmnd full command, e.g. "Status 0", "Power1 ON"
 * @param {{ username?: string, password?: string, timeoutMs?: number }} [options]
 * @throws {HttpAuthError} when the device asks for credentials
 */
export async function httpCommand(address, cmnd, options = {}) {
  const url = buildCommandUrl(address, cmnd, options);
  logger.debug(`HTTP ${address} <- ${cmnd}`);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(options.timeoutMs ?? HTTP_TIMEOUT_MS),
  });
  if (response.status === 401 || response.status === 403) {
    throw new HttpAuthError(address);
  }
  if (!response.ok) {
    throw new Error(`Tasmota at ${address} answered HTTP ${response.status}`);
  }
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Tasmota at ${address} answered a non-JSON body`);
  }
  // Tasmota answers 200 + {"WARNING":"Need user=<username>&password=<password>"}.
  if (body && typeof body.WARNING === 'string' && /user=/.test(body.WARNING)) {
    throw new HttpAuthError(address);
  }
  return body;
}

/**
 * Run `task` over `items` with at most `concurrency` in flight.
 * @returns {Promise<PromiseSettledResult[]>} in the order of `items`
 */
export async function mapLimit(items, concurrency, task) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { status: 'fulfilled', value: await task(items[index]) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
