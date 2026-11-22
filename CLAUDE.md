# Marquee

Ty's custom Jellyfin front end. Cinematic layout with HomeDash/LikeLoop's purple liquid glass. Used mostly on the phone and the projector/TV browser (remote arrow-key navigation matters).

- Zero-dependency Node.js server (`server.js`) + static app (`public/`). No build step. hls.js is vendored in `public/vendor/`.
- The server proxies `/jf/*` to `JELLYFIN_URL`. The app uses Jellyfin's REST API directly (auth header `MediaBrowser ... Token=`), so all state (progress, favorites, watched) lives in Jellyfin.
- Runs in Docker on the ZimaOS VM next to Jellyfin (`docker-compose.yml`, container `marquee`, port 8098). Code is at `/DATA/AppData/marquee/app`. Jellyfin is the ZimaOS App Store install on host port 8096, reached via `host.docker.internal`.
- **Deploying:** push to `main`. The `marquee-updater` container pulls every 5 minutes and the server restarts itself when the commit changes. Tell the user to wait up to 5 minutes, then fully close and reopen the app.
- When changing frontend files, bump the cache name in `public/sw.js` (marquee-vN).
- Test with a mock Jellyfin and headless Chrome screenshots (phone 390x844 and TV 1920x1080) before pushing. The user is usually on a phone, so keep instructions short and commands one line each.
- Player: POST PlaybackInfo with a device profile built from `canPlayType`; direct play when possible, otherwise HLS (fMP4) from Jellyfin, which hardware-transcodes with QuickSync. hls.js everywhere except Safari. Reports start/progress (10s)/stop to `/Sessions/Playing*`.
- Routes are hash-based: `#/`, `#/library/<id>`, `#/item/<id>?season=`, `#/search?q=`, `#/play/<id>?start=`.
- People: `#/person/<id>?tab=all`. "In your library" = Jellyfin `PersonIds` items plus any library item matched from the TMDB filmography. "Full filmography" comes from the server's `/api/person` (TMDB `combined_credits`, cached 24h; talk/news shows and "Self" roles filtered out; Movies/TV/Directing/Writing). Owned titles are matched by `ProviderIds.Tmdb` and link in-app; others open themoviedb.org.
- TMDB key: `/DATA/AppData/marquee/config/tmdb-key` (mounted at `/config`, read on every request; v3 key or v4 token). Never commit it. TMDB attribution line is shown under the filmography.
