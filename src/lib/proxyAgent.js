import { HttpsProxyAgent } from "https-proxy-agent";
import { getProxyForUrl } from "proxy-from-env";

export function getProxyAgent(targetUrl) {
  const proxyUrl = getProxyForUrl(targetUrl);
  return proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;
}
