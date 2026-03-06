import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const host = process.env.HOST || "127.0.0.1";
const port = process.env.PORT || 8080;
const web_server_url = process.env.PUBLIC_URL || `http://${host}:${port}`;

const HLS_CONTENT_TYPE = "application/vnd.apple.mpegurl";
const STRIP_RESPONSE_HEADERS = [
  "Access-Control-Allow-Origin",
  "Access-Control-Allow-Methods",
  "Access-Control-Allow-Headers",
  "Access-Control-Max-Age",
  "Access-Control-Allow-Credentials",
  "Access-Control-Expose-Headers",
  "Access-Control-Request-Method",
  "Access-Control-Request-Headers",
  "Origin",
  "Vary",
  "Referer",
  "Server",
  "x-cache",
  "via",
  "x-amz-cf-pop",
  "x-amz-cf-id",
];
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function applyProxyCorsHeaders(res) {
  STRIP_RESPONSE_HEADERS.forEach((header) => res.removeHeader(header));
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "*");
}

function toOrigin(referer) {
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function buildUpstreamHeaders(headers = {}) {
  const safeHeaders =
    headers && typeof headers === "object" && !Array.isArray(headers)
      ? headers
      : {};
  const upstreamHeaders = {
    "User-Agent": DEFAULT_USER_AGENT,
    Accept: "application/vnd.apple.mpegurl,application/x-mpegURL,*/*",
    ...safeHeaders,
  };
  const referer = upstreamHeaders.Referer ?? upstreamHeaders.referer;
  if (referer && !upstreamHeaders.Origin && !upstreamHeaders.origin) {
    const origin = toOrigin(referer);
    if (origin) {
      upstreamHeaders.Origin = origin;
    }
  }
  return upstreamHeaders;
}

function encodeHeaders(headers) {
  return encodeURIComponent(JSON.stringify(headers ?? {}));
}

function buildTsProxyUrl(targetUrl, headers) {
  return (
    `${web_server_url}/ts-proxy?url=` +
    encodeURIComponent(targetUrl) +
    "&headers=" +
    encodeHeaders(headers)
  );
}

function buildM3U8ProxyUrl(targetUrl, headers) {
  return (
    `${web_server_url}/m3u8-proxy?url=` +
    encodeURIComponent(targetUrl) +
    "&headers=" +
    encodeHeaders(headers)
  );
}

function rewriteManifest(content, sourceUrl, headers) {
  const lines = String(content ?? "").split("\n");
  const rewritten = [];
  const isMasterPlaylist = String(content ?? "").includes("RESOLUTION=");

  for (const line of lines) {
    if (!line.trim()) {
      rewritten.push(line);
      continue;
    }

    if (line.startsWith("#")) {
      if (line.startsWith("#EXT-X-KEY:")) {
        const regex = /https?:\/\/[^\""\s]+/g;
        const keyUrl = regex.exec(line)?.[0] ?? "";
        const proxyUrl = buildTsProxyUrl(keyUrl, headers);
        rewritten.push(line.replace(regex, proxyUrl));
      } else if (isMasterPlaylist && line.startsWith("#EXT-X-MEDIA:TYPE=AUDIO")) {
        const regex = /https?:\/\/[^\""\s]+/g;
        const audioUrl = regex.exec(line)?.[0] ?? "";
        const proxyUrl = buildM3U8ProxyUrl(audioUrl, headers);
        rewritten.push(line.replace(regex, proxyUrl));
      } else {
        rewritten.push(line);
      }
      continue;
    }

    const target = new URL(line, sourceUrl).href;
    rewritten.push(
      isMasterPlaylist
        ? buildM3U8ProxyUrl(target, headers)
        : buildTsProxyUrl(target, headers)
    );
  }

  return rewritten.join("\n");
}

export default async function proxyM3U8(url, headers, req, res) {
  const method = req?.method === "HEAD" ? "HEAD" : "GET";

  if (!url) {
    applyProxyCorsHeaders(res);
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Missing url query parameter");
    return;
  }

  let upstreamResponse;
  try {
    upstreamResponse = await axios(url, {
      method,
      headers: buildUpstreamHeaders(headers),
      responseType: "text",
      transformResponse: [(data) => data],
      validateStatus: () => true,
    });
  } catch (err) {
    applyProxyCorsHeaders(res);
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end(err?.message || "upstream fetch failed");
    return;
  }

  applyProxyCorsHeaders(res);

  const upstreamStatus = upstreamResponse?.status ?? 502;
  const upstreamContentType =
    upstreamResponse?.headers?.["content-type"] || HLS_CONTENT_TYPE;

  if (method === "HEAD") {
    res.writeHead(upstreamStatus, { "Content-Type": upstreamContentType });
    res.end();
    return;
  }

  if (upstreamStatus < 200 || upstreamStatus >= 300) {
    res.writeHead(upstreamStatus, { "Content-Type": "text/plain" });
    const errorPayload =
      typeof upstreamResponse?.data === "string"
        ? upstreamResponse.data
        : "upstream fetch failed";
    res.end(errorPayload);
    return;
  }

  let rewrittenManifest = "";
  try {
    rewrittenManifest = rewriteManifest(upstreamResponse?.data, url, headers);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(err?.message || "manifest rewrite failed");
    return;
  }

  res.writeHead(200, { "Content-Type": HLS_CONTENT_TYPE });
  res.end(rewrittenManifest);
}
