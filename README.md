# bmux

A keyboard-driven browser with tmux-style multiplexing and telescope-style fuzzy finders.
Chromium rendering via Electron, no Google services, DuckDuckGo search by default,
filter-list ad/tracker blocking, and all site permission prompts (location, notifications,
camera…) denied automatically.

## Install

Requires macOS (Apple Silicon) and Node.js.

```
npm install
npm start                 # run from source
npm run package:install   # build bmux.app and install to /Applications
```

Installed builds keep themselves up to date from GitHub Releases automatically.

The prefix is **ctrl-b** (tmux default). Press `prefix ?` for searchable in-app help;
every new tab shows the cheatsheet.

Everything else — keybindings, panes, tabs, sessions, finders, themes, configuration,
development — is in [GUIDE.md](GUIDE.md). Release setup lives in
[RELEASING.md](RELEASING.md).
