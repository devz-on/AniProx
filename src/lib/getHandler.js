import { isValidHostName } from "./isValidHostName.js";
import { getProxyForUrl } from "proxy-from-env";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import withCORS from "./withCORS.js";
import parseURL from "./parseURL.js";
import proxyM3U8 from "./proxyM3U8.js";
import { proxyTs } from "./proxyTS.js";
import proxyRequest from "./proxyRequest.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const docsHtml = readFileSync(join(__dirname, "../docs.html"), "utf8");
const adminLoginHtml = readFileSync(join(__dirname, "../admin-login.html"), "utf8");
const adminTrialHtml = readFileSync(join(__dirname, "../index.html"), "utf8");

const ADMIN_COOKIE_NAME = "anyprox_admin_trial";
const DEFAULT_ADMIN_SESSION_TTL_SECONDS = 60 * 60;
const MAX_BODY_SIZE_BYTES = 16 * 1024;

function parseCookies(rawCookieHeader) {
  const pairs = String(rawCookieHeader || "").split(";");
  const cookies = {};
  pairs.forEach((pair) => {
    const [rawName, ...rest] = pair.split("=");
    const name = String(rawName || "").trim();
    if (!name) return;
    const value = rest.join("=").trim();
    cookies[name] = decodeURIComponent(value);
  });
  return cookies;
}

function readRequestBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      if (body.length >= MAX_BODY_SIZE_BYTES) {
        return;
      }
      body += String(chunk || "");
      if (body.length > MAX_BODY_SIZE_BYTES) {
        body = body.slice(0, MAX_BODY_SIZE_BYTES);
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", () => resolve(""));
  });
}

function parseUrlEncodedBody(rawBody) {
  const params = new URLSearchParams(String(rawBody || ""));
  const data = {};
  params.forEach((value, key) => {
    data[key] = value;
  });
  return data;
}

function toSessionTtlSeconds() {
  const raw = Number.parseInt(
    String(process.env.ADMIN_TRIAL_SESSION_TTL_SECONDS || ""),
    10
  );
  if (!Number.isFinite(raw) || raw < 60) {
    return DEFAULT_ADMIN_SESSION_TTL_SECONDS;
  }
  return raw;
}

function createAdminCookieValue() {
  const maxAge = toSessionTtlSeconds();
  return `${ADMIN_COOKIE_NAME}=1; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax`;
}

function clearAdminCookieValue() {
  return `${ADMIN_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`;
}

function hasAdminAccess(req, password) {
  if (!password) {
    return true;
  }
  const cookies = parseCookies(req.headers.cookie || "");
  return cookies[ADMIN_COOKIE_NAME] === "1";
}

function writeHtml(res, html, statusCode = 200, extraHeaders = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    ...extraHeaders,
  });
  res.end(html);
}

function redirect(res, location, extraHeaders = {}) {
  res.writeHead(302, {
    Location: location,
    ...extraHeaders,
  });
  res.end();
}

export default function getHandler(options, proxy) {
  const corsAnywhere = {
    handleInitialRequest: null,
    getProxyForUrl: getProxyForUrl,
    maxRedirects: 5,
    originBlacklist: [],
    originWhitelist: [],
    checkRateLimit: null,
    redirectSameOrigin: false,
    requireHeader: null,
    removeHeaders: [],
    setHeaders: {},
    corsMaxAge: 0,
  };

  Object.keys(corsAnywhere).forEach(function (option) {
    if (Object.prototype.hasOwnProperty.call(options, option)) {
      corsAnywhere[option] = options[option];
    }
  });

  if (corsAnywhere.requireHeader) {
    if (typeof corsAnywhere.requireHeader === "string") {
      corsAnywhere.requireHeader = [corsAnywhere.requireHeader.toLowerCase()];
    } else if (
      !Array.isArray(corsAnywhere.requireHeader) ||
      corsAnywhere.requireHeader.length === 0
    ) {
      corsAnywhere.requireHeader = null;
    } else {
      corsAnywhere.requireHeader = corsAnywhere.requireHeader.map(function (
        headerName
      ) {
        return headerName.toLowerCase();
      });
    }
  }

  const hasRequiredHeaders = function (headers) {
    return (
      !corsAnywhere.requireHeader ||
      corsAnywhere.requireHeader.some(function (headerName) {
        return Object.hasOwnProperty.call(headers, headerName);
      })
    );
  };

  const serveDocs = (res) => writeHtml(res, docsHtml);
  const serveAdminLogin = (res) => writeHtml(res, adminLoginHtml);
  const serveAdminTrial = (res) => writeHtml(res, adminTrialHtml);

  return function (req, res) {
    const adminPassword = String(process.env.ADMIN_TRIAL_PASSWORD || "").trim();
    const requestUrl = new URL(req.url || "/", "http://localhost:3000");

    // Dedicated web UI routes (docs + password-gated trial page)
    if (requestUrl.pathname === "/" && req.method === "GET") {
      serveDocs(res);
      return;
    }

    if (requestUrl.pathname === "/admin-trial/logout") {
      redirect(res, "/", { "Set-Cookie": clearAdminCookieValue() });
      return;
    }

    if (requestUrl.pathname === "/admin-trial/login") {
      if (req.method !== "POST") {
        redirect(res, "/");
        return;
      }

      void readRequestBody(req).then((rawBody) => {
        const form = parseUrlEncodedBody(rawBody);
        const password = String(form.password || "").trim();
        if (!adminPassword || password === adminPassword) {
          redirect(res, "/admin-trial", {
            "Set-Cookie": createAdminCookieValue(),
          });
          return;
        }
        redirect(res, "/", {
          "Set-Cookie": clearAdminCookieValue(),
        });
      });
      return;
    }

    if (requestUrl.pathname === "/admin-trial" && req.method === "GET") {
      if (hasAdminAccess(req, adminPassword)) {
        serveAdminTrial(res);
        return;
      }
      serveAdminLogin(res);
      return;
    }

    req.corsAnywhereRequestState = {
      getProxyForUrl: corsAnywhere.getProxyForUrl,
      maxRedirects: corsAnywhere.maxRedirects,
      corsMaxAge: corsAnywhere.corsMaxAge,
    };

    const cors_headers = withCORS({}, req);
    if (req.method === "OPTIONS") {
      res.writeHead(200, cors_headers);
      res.end();
      return;
    }

    const location = parseURL(req.url.slice(1));

    if (
      corsAnywhere.handleInitialRequest &&
      corsAnywhere.handleInitialRequest(req, res, location)
    ) {
      return;
    }

    if (!location) {
      if (/^\/https?:\/[^/]/i.test(req.url)) {
        res.writeHead(400, "Missing slash", cors_headers);
        res.end(
          "The URL is invalid: two slashes are needed after the http(s):."
        );
        return;
      }

      serveDocs(res);
      return;
    }

    if (location.host === "iscorsneeded") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("no");
      return;
    }

    if ((Number(location.port) ?? 0) > 65535) {
      res.writeHead(400, "Invalid port", cors_headers);
      res.end("Port number too large: " + location.port);
      return;
    }

    if (!/^\/https?:/.test(req.url) && !isValidHostName(location.hostname)) {
      const uri = requestUrl;
      if (uri.pathname === "/m3u8-proxy") {
        let headers = {};
        try {
          headers = JSON.parse(uri.searchParams.get("headers") ?? "{}");
        } catch (e) {
          res.writeHead(500);
          res.end(e.message);
          return;
        }
        const url = uri.searchParams.get("url");
        return proxyM3U8(url ?? "", headers, req, res);
      }
      if (uri.pathname === "/ts-proxy") {
        let headers = {};
        try {
          headers = JSON.parse(uri.searchParams.get("headers") ?? "{}");
        } catch (e) {
          res.writeHead(500);
          res.end(e.message);
          return;
        }
        const url = uri.searchParams.get("url");
        return proxyTs(url ?? "", headers, req, res);
      }

      res.writeHead(404, "Invalid host", cors_headers);
      res.end("Invalid host: " + location.hostname);
      return;
    }

    if (!hasRequiredHeaders(req.headers)) {
      res.writeHead(400, "Header required", cors_headers);
      res.end(
        "Missing required request header. Must specify one of: " +
          corsAnywhere.requireHeader
      );
      return;
    }

    const origin = req.headers.origin || "";
    if (corsAnywhere.originBlacklist.indexOf(origin) >= 0) {
      res.writeHead(403, "Forbidden", cors_headers);
      res.end(
        'The origin "' +
          origin +
          '" was blacklisted by the operator of this proxy.'
      );
      return;
    }

    if (
      corsAnywhere.originWhitelist.length &&
      corsAnywhere.originWhitelist.indexOf(origin) === -1
    ) {
      res.writeHead(403, "Forbidden", cors_headers);
      res.end(
        'The origin "' +
          origin +
          '" was not whitelisted by the operator of this proxy.'
      );
      return;
    }

    const rateLimitMessage =
      corsAnywhere.checkRateLimit && corsAnywhere.checkRateLimit(origin);
    if (rateLimitMessage) {
      res.writeHead(429, "Too Many Requests", cors_headers);
      res.end(
        'The origin "' +
          origin +
          '" has sent too many requests.\n' +
          rateLimitMessage
      );
      return;
    }

    if (
      corsAnywhere.redirectSameOrigin &&
      origin &&
      location.href[origin.length] === "/" &&
      location.href.lastIndexOf(origin, 0) === 0
    ) {
      cors_headers.vary = "origin";
      cors_headers["cache-control"] = "private";
      cors_headers.location = location.href;
      res.writeHead(301, "Please use a direct request", cors_headers);
      res.end();
      return;
    }

    const isRequestedOverHttps =
      req.connection.encrypted ||
      /^\s*https/.test(req.headers["x-forwarded-proto"]);
    const proxyBaseUrl =
      (isRequestedOverHttps ? "https://" : "http://") + req.headers.host;

    corsAnywhere.removeHeaders.forEach(function (header) {
      delete req.headers[header];
    });

    Object.keys(corsAnywhere.setHeaders).forEach(function (header) {
      req.headers[header] = corsAnywhere.setHeaders[header];
    });

    req.corsAnywhereRequestState.location = location;
    req.corsAnywhereRequestState.proxyBaseUrl = proxyBaseUrl;

    proxyRequest(req, res, proxy);
  };
}
