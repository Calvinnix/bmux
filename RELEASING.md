# Releasing & auto-updates

bmux keeps its bundled Chromium patched through a weekly CI job that bumps
Electron, runs the e2e suite as a gate, and — if green — builds a signed +
notarized macOS build and publishes it to GitHub Releases. The installed app
pulls updates from that feed via `electron-updater`.

You don't run any of this by hand once it's set up. The steps below are the
**one-time setup**.

---

## 1. Push the repo to GitHub (public)

The workflow and the in-app updater both target **`calvinnix/bmux`**. If your
repo lives somewhere else, change `build.publish` in `package.json` to match.

```bash
git remote add origin https://github.com/calvinnix/bmux.git
git push -u origin main
```

Keep it **public**. `electron-updater` reads the Releases feed anonymously; a
private repo would force you to bake an access token into the shipped app.

## 2. Add the signing & notarization secrets

Set these under **Settings → Secrets and variables → Actions** in the repo.
`GITHUB_TOKEN` is provided automatically — you don't add it.

| Secret | What it is |
| --- | --- |
| `MAC_CERT_P12_BASE64` | base64 of your **Developer ID Application** cert (`.p12`) |
| `MAC_CERT_PASSWORD` | the password you set when exporting that `.p12` |
| `APPLE_API_KEY_BASE64` | base64 of an **App Store Connect API key** (`.p8`) |
| `APPLE_API_KEY_ID` | that key's ID (e.g. `A1B2C3D4E5`) |
| `APPLE_API_ISSUER` | that key's issuer UUID |

### Exporting the Developer ID cert

1. In **Keychain Access**, find your *Developer ID Application: …* certificate.
2. Right-click → **Export** → save as `cert.p12`, set a password (that's
   `MAC_CERT_PASSWORD`).
3. base64 it for the secret value:
   ```bash
   base64 -i cert.p12 | pbcopy   # paste into MAC_CERT_P12_BASE64
   ```

### Creating the App Store Connect API key (for notarization)

1. <https://appstoreconnect.apple.com> → **Users and Access → Integrations →
   App Store Connect API** → generate a key with the **Developer** role.
2. Download the `.p8` (you can only download it once). Note the **Key ID** and
   the **Issuer ID** shown on that page.
3. base64 the key:
   ```bash
   base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy   # paste into APPLE_API_KEY_BASE64
   ```
   `APPLE_API_KEY_ID` = the Key ID, `APPLE_API_ISSUER` = the Issuer ID.

## 3. Cut the first release

Trigger the workflow manually so the first published build exists:

**Actions → electron-update → Run workflow → set `force` = true → Run.**

After that it runs itself every Monday and only publishes when Electron actually
has a new version. Nothing else is needed from you.

---

## How it behaves once live

- **Producing builds:** `.github/workflows/electron-update.yml`, weekly. Bumps
  Electron → `npm test` (the gate) → bump app version → commit → build, sign,
  notarize, publish to Releases. On any failure it opens an issue instead of
  shipping.
- **Receiving updates:** the app checks the feed 10s after launch and every 6h,
  downloads in the background, and shows progress in the status bar. It
  auto-applies on next quit; to apply immediately run **`app: restart to
  update`** from the command palette (`C-b :`).
- **Disabled** under `BMUX_DEBUG` and in unpackaged/dev runs, so it never
  interferes with tests or `npm start`.

## Building locally

```bash
npm run package:install   # ad-hoc signed build, copied to /Applications (no cert needed)
npm run release           # signed + notarized + published — normally only CI runs this
```

## Caveat

The e2e suite spawns a GUI Electron, so CI runs it on a `macos-latest` runner
where a display is available. That's standard for Electron testing but can be
occasionally flaky — if a run fails on a test timeout rather than a real
regression, that's the likely cause, and the job will have opened an issue
rather than shipped a bad build.
