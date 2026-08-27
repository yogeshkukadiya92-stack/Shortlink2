const dns = require("dns").promises;
const net = require("net");

function isPrivateIp(address) {
  const value = String(address || "").trim().toLowerCase();
  if (!value) return true;
  if (net.isIPv4(value)) {
    const parts = value.split(".").map(Number);
    return parts[0] === 10 || parts[0] === 127 || parts[0] === 0
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)
      || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
      || parts[0] >= 224;
  }
  if (net.isIPv6(value)) {
    return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd")
      || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea")
      || value.startsWith("feb") || value.startsWith("ff") || value.startsWith("::ffff:127.")
      || value.startsWith("::ffff:10.") || value.startsWith("::ffff:192.168.");
  }
  return true;
}

async function assertSafeOutboundUrl(input) {
  const parsed = input instanceof URL ? input : new URL(String(input || ""));
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only HTTP and HTTPS destinations are allowed.");
  if (parsed.username || parsed.password) throw new Error("Destination URLs cannot contain credentials.");
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("Private network destinations are not allowed.");
  }
  const records = net.isIP(hostname) ? [{ address: hostname }] : await dns.lookup(hostname, { all: true, verbatim: true });
  if (!records.length || records.some((record) => isPrivateIp(record.address))) {
    throw new Error("Private network destinations are not allowed.");
  }
  return parsed;
}

async function safeFetch(input, options = {}, maxRedirects = 4) {
  let current = await assertSafeOutboundUrl(input);
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await fetch(current, { ...options, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location || redirectCount === maxRedirects) throw new Error("Too many outbound redirects.");
    current = await assertSafeOutboundUrl(new URL(location, current));
  }
  throw new Error("Too many outbound redirects.");
}

module.exports = { assertSafeOutboundUrl, isPrivateIp, safeFetch };
