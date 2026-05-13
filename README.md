# AniProx HLS Lab

AniProx serves a browser HLS playground with two playback strategies:

1. **Direct browser mode**: the HTML/JavaScript page asks the browser to load the M3U8 playlist and media files directly from the stream host.
2. **Header Bridge mode**: the browser asks AniProx for a same-origin playlist URL, and AniProx relays playlists/segments with the JSON headers supplied by the client.

Direct browser mode is the pure client-side path. Header Bridge mode exists for streams that require headers the browser is not allowed to set itself, such as `Referer`, `Origin`, `User-Agent`, `Cookie`, or `Host`.

## Important browser limits

Browser JavaScript cannot spoof forbidden request headers and cannot bypass CORS. This is a browser security boundary, not a missing helper function. AniProx handles that boundary by keeping direct playback available and by providing Header Bridge as the practical fallback when an upstream stream requires forbidden headers.

Use **Direct browser** when the stream host allows browser/CORS playback. Use **Header Bridge** when the upstream host requires headers like this:

```json
{
  "Referer": "https://megaplay.buzz/"
}
```

## Installation

1. Clone the repository.

```bash
git clone https://github.com/yahyaMomin/m3u8-proxy.git
```

2. Install dependencies.

```bash
bun install
```

3. Run the server.

```bash
bun dev
```

You can configure the web server with a `.env` file:

```env
HOST="localhost"
PORT="3030"
PUBLIC_URL="http://localhost:3030"
```

`PUBLIC_URL` is used when Header Bridge rewrites child playlists and media segment URLs.

## Usage

Open the app in your browser:

```text
http://localhost:3030/
```

Paste a direct `.m3u8` URL, enter optional request headers as JSON, choose a mode, and click **Play**.

You can also share a pre-filled client URL:

```text
http://localhost:3030/?url=https%3A%2F%2Fexample.com%2Fmaster.m3u8&headers=%7B%7D&mode=direct
```

## Routes

- `GET /` serves the HLS Lab UI.
- `GET /m3u8-proxy?url=<encoded-url>&headers=<json>` fetches a playlist with the supplied upstream headers and rewrites child playlist, key, and media URLs through AniProx.
- `GET /ts-proxy?url=<encoded-url>&headers=<json>` streams a media segment/key with the supplied upstream headers.
- `/<http(s)://target...>` keeps the generic CORS proxy path available for compatibility.
