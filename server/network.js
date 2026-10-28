import os from 'node:os';

export function lanUrls(port, interfaces = os.networkInterfaces()) {
  const urls = [];
  const entries = Object.entries(interfaces).sort(([a], [b]) => Number(/wi-?fi|wlan|wireless|無線/i.test(b)) - Number(/wi-?fi|wlan|wireless|無線/i.test(a)));
  for (const [name, addresses] of entries) {
    if (/vEthernet|WSL|Hyper-V|Docker|VirtualBox|vmnet|loopback|VPN|Tailscale/i.test(name)) continue;
    for (const item of addresses || []) {
      if (item.family === 'IPv4' && !item.internal && !item.address.startsWith('169.254.')) urls.push(`http://${item.address}:${port}`);
    }
  }
  return [...new Set(urls)];
}

export function invitationOrigin(host, port, interfaces) {
  try {
    const parsed = new URL(`http://${host}`);
    if (['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) return lanUrls(port, interfaces)[0] || parsed.origin;
    return parsed.origin;
  } catch { return lanUrls(port, interfaces)[0] || `http://localhost:${port}`; }
}
