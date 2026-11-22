# Marquee

A custom front end for Jellyfin: cinematic layout, HomeDash's purple liquid glass, built for phones and the projector.

- Zero-dependency Node.js server and a static app. The server passes `/jf/*` straight to Jellyfin, so the browser only talks to one address.
- Signs in with your Jellyfin account. Watch progress, favorites and watched status live in Jellyfin, so they match the official apps.
- Works with a TV remote or keyboard: arrows move, Enter selects, Back goes back. In the player, left/right skip when the controls are hidden.
- Runs on port 8098. Set `JELLYFIN_URL` to Jellyfin's address.

Run locally: `JELLYFIN_URL=http://192.168.1.x:8097 node server.js`

`public/vendor/hls.min.js` is hls.js 1.7.4 (Apache-2.0), for streaming transcodes outside Safari.

When changing frontend files, bump the cache name in `public/sw.js`.
