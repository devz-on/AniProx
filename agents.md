# AGENTS.md - AniProx

Update AGENTS.md every time something big is changed, fixed, added, removed, or behavior is altered.

## Purpose
- AniProx is the media and CORS proxy used by the DevzAnime stack.
- It handles playlist and segment proxying so browsers can play upstream streams that require custom headers or have strict CORS.

## Stack
- Node.js HTTP server
- `http-proxy`
- dotenv config
- Custom handlers for M3U8 and TS proxying

## Runtime Flow
1. `src/index.js` starts server via `src/lib/server.js`.
2. `server.js` loads env and calls `createServer(...)`.
3. `createServer.js` creates HTTP server, applies broad CORS headers, and forwards requests to `getHandler`.
4. `getHandler.js` resolves request type:
   - Root HTML
   - `/m3u8-proxy`
   - `/ts-proxy`
   - Generic CORS proxy pass-through for URL-style paths (`/<http(s)://target...>`).

## Main Routes
- `GET /`
  - Returns `src/index.html`.
- `GET /m3u8-proxy?url=<encoded-url>&headers=<json>`
  - Fetches playlist, rewrites segment/child playlist URLs, returns proxied M3U8.
- `GET /ts-proxy?url=<encoded-url>&headers=<json>`
  - Proxies segment/media file bytes with forwarded headers.
- `OPTIONS *`
  - CORS preflight handled globally.
- Generic CORS proxy:
  - Path format `/<http(s)://upstream-host/path...>`
  - Proxies upstream through `http-proxy` with response header adjustments.

## Important Files
- `src/lib/getHandler.js`
  - Route selection and request validation.
- `src/lib/proxyM3U8.js`
  - M3U8-specific rewrite/proxy logic.
- `src/lib/proxyTS.js`
  - TS/media segment proxy logic.
- `src/lib/proxyRequest.js`
  - Low-level proxy response handling, redirect handling, CORS headers.

## Environment Variables
- `HOST` (default `127.0.0.1`)
- `PORT` (default `8080`)
- `PUBLIC_URL` (public proxy base URL)
- `ALLOWED_ORIGINS` (comma-separated whitelist)

## Integration with Other Projects
- Consumed by DevzAnime and DAniApi for stream/media delivery paths.
- Usually sits between browser and upstream stream providers.

## AI Editing Notes
- Keep CORS behavior stable unless explicitly requested.
- Be careful when changing header forwarding and redirect logic in `proxyRequest.js`.
- Validate that `/m3u8-proxy` and `/ts-proxy` still work together after changes.
