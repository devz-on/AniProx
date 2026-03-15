import https from "node:https";
import http from "node:http";

export async function proxyTs(url, headers, req, res) {
  const isHeadRequest = req?.method === "HEAD";
  let forceHTTPS = false;

  if (url.startsWith("https://")) {
    forceHTTPS = true;
  }

  const uri = new URL(url);
  const options = {
    hostname: uri.hostname,
    port: uri.port,
    path: uri.pathname + uri.search,
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.132 Safari/537.36",
      ...headers,
    },
  };
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "*");

  try {
    if (forceHTTPS) {
      const proxy = https.request(options, (r) => {
        if (!r.headers["content-type"]) {
          r.headers["content-type"] = "video/mp2t";
        }
        res.writeHead(r.statusCode ?? 200, r.headers);

        if (isHeadRequest) {
          r.resume();
          res.end();
          return;
        }

        r.pipe(res, {
          end: true,
        });
      });

      proxy.on("error", (err) => {
        if (!res.headersSent) {
          res.writeHead(502);
        }
        res.end(err?.message || "Upstream request failed");
      });

      if (isHeadRequest) {
        proxy.end();
      } else {
        req.pipe(proxy, {
          end: true,
        });
      }
    } else {
      const proxy = http.request(options, (r) => {
        if (!r.headers["content-type"]) {
          r.headers["content-type"] = "video/mp2t";
        }
        res.writeHead(r.statusCode ?? 200, r.headers);

        if (isHeadRequest) {
          r.resume();
          res.end();
          return;
        }

        r.pipe(res, {
          end: true,
        });
      });

      proxy.on("error", (err) => {
        if (!res.headersSent) {
          res.writeHead(502);
        }
        res.end(err?.message || "Upstream request failed");
      });

      if (isHeadRequest) {
        proxy.end();
      } else {
        req.pipe(proxy, {
          end: true,
        });
      }
    }
  } catch (e) {
    res.writeHead(500);
    res.end(e.message);
    return null;
  }
}
