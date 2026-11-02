# Orca'JP — the client

**English** · [Español](es/jp.md) · [All guides](../../README.md)

Orca'JP (`apps/jp`) is a Netflix-style client for Jellyfin: profiles, a home page with rows, title
pages, search, the whole library by genre or A–Z, and a player with audio and subtitle choices. It is
a static web app; the same build runs in a desktop browser, inside the [Android app](android.md) and
inside the [Xbox/Windows app](xbox.md). It is driven by mouse, touch, keyboard, TV remote or gamepad.

It only needs a reachable Jellyfin server. It does not need Orca'H&M.

## Configure

```bash
cp apps/jp/.env.example apps/jp/.env
```

| Variable                   | Purpose                                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_JELLYFIN_SERVERS`    | Servers offered on the sign-in picker, comma-separated (`https://jellyfin.example.com,http://media.local:8096`). Empty: only the servers this device already used, plus manual entry. |
| `VITE_JELLYFIN_SERVER_URL` | Older single-server form; still read and listed first.                                                                                                                                |
| `VITE_PUBLIC_URL`          | Address a phone opens when it scans the "sign in with your phone" QR (Jellyfin Quick Connect). Empty: the address the app was loaded from, which must not be `localhost`.             |
| `JP_ALLOWED_HOSTS`         | Dev server only: extra host names it answers to, comma-separated, such as a tunnel that exposes it to phones and TVs.                                                                 |

`VITE_*` values are **baked into the build** when it is made. The Android and Xbox packages carry
whatever `apps/jp/.env` held when you built them; rebuild after changing it.

## Run in development

```bash
pnpm dev            # from the repository root; http://localhost:5173
```

To open it from another device on your network, run `pnpm --filter @orca/jp dev --host` and use this
machine's LAN address. If you reach it through a tunnel or a domain name, add that name to
`JP_ALLOWED_HOSTS`, or Vite answers `403`.

## Build and host it

```bash
pnpm --filter @orca/jp build      # output: apps/jp/dist/
pnpm preview                      # serve that build locally to try it
```

`dist/` is plain static files: serve it with any web server (nginx, Caddy, a static host). Things to know:

- **Plain-http Jellyfin servers from an https page.** Firefox and Safari block them as mixed content.
  Chrome and Edge allow them only when the server is a private IP literal or a `.local` name, after a
  permission prompt. Serve Orca'JP over http on your LAN, or put Jellyfin behind https, to avoid this.
- **Quick Connect** (the QR on TVs and consoles) needs Quick Connect enabled in Jellyfin
  (Dashboard › General) and an address the phone can reach (`VITE_PUBLIC_URL`).
- The language follows the browser or device (English and Spanish).

## Sign in

The first screen lists the servers from `VITE_JELLYFIN_SERVERS` and the ones used before, with a live
status for each, plus "add a server" for a manual address. Each signed-in account becomes a profile
on the profile picker; profiles are kept on the device.

## Tests

```bash
pnpm --filter @orca/jp test
```

Tests never touch a real Jellyfin: HTTP goes through a fake axios adapter.
