# bmux

A keyboard-driven browser with tmux-style multiplexing and telescope-style fuzzy finders.
Chromium rendering via Electron, no Google services, DuckDuckGo search by default, and all
site permission prompts (location, notifications, camera…) denied automatically.

```
npm install
npm start            # run from source
npm run package:install   # build bmux.app and install to /Applications
```

The prefix is **ctrl-b** (tmux default). Press `prefix ?` for searchable in-app help; every
new tab shows the cheatsheet.

## Panes (tmux)

| Keys | Action |
|---|---|
| `prefix %` / `prefix "` | split side by side / stacked |
| `prefix h j k l` (or arrows) | move focus between panes *(repeats — keep tapping)* |
| `prefix H J K L` | resize pane *(repeats — keep tapping)* |
| `prefix ;` | last active pane |
| `prefix q` | display pane numbers — press one to jump |
| `prefix z` | zoom / unzoom pane |
| `prefix x` | close pane |
| `prefix !` | break pane out to its own tab |
| `prefix { / }` | swap pane with previous / next |
| `prefix Space` | equalize pane sizes |

Like tmux `bind -r`, focus and resize keys repeat within 600ms without re-typing the
prefix (`repeatTimeMs` in config). `pane: join into another tab…` in the palette is the
inverse of break — it moves the current pane into any other tab as a split.

## Tabs (tmux windows)

| Keys | Action |
|---|---|
| `prefix c` | new tab (opens the url prompt; the tab is created on accept) |
| `prefix n / p` | next / previous tab |
| `prefix 1-9` | jump to tab |
| `prefix Tab` | last tab |
| `prefix ,` | rename tab |
| `prefix &` | close tab |
| `prefix < / >` | move tab left / right |
| `prefix .` | move tab to position… |

## Windows & sessions (tmux sessions)

Named sessions hold a full set of tabs and splits, all persisted across restarts. Each OS
window is a client attached to one session — `⌘N` opens a new window on a fresh session,
`⌘⇧W` closes a window (its session stays on disk for reattaching), and switching to a
session that's open in another window focuses that window.

| Keys | Action |
|---|---|
| `prefix s` | session picker — switch, type a new name to create, `C-x` delete |
| `prefix w` | choose tree — jump to any tab in any session |
| `prefix $` | rename current session |
| `prefix d` | detach — close the window, session persists on disk |

Sessions restore with full fidelity: every pane's back/forward history survives a
restart, and per-site zoom levels (`⌘+/-`) are remembered per host.

## Scroll / copy mode (tmux copy-mode)

`prefix v` enters a modal scroll mode on the current page — no keys are stolen from
pages outside it. The status bar shows **SCROLL** (or **VISUAL**).

| Keys | Action |
|---|---|
| `j / k` `h / l` | scroll by line / horizontally |
| `d / u` | half page down / up |
| `f / b` (or `Space`) | full page down / up |
| `gg / G` | top / bottom |
| `v` | visual mode — extend selection with `h j k l w b e 0 $` |
| `y` | yank selection (or the url if nothing selected) and exit |
| `/` | find in page |
| `q` / `Esc` | exit (in visual: back to scroll) |

## Telescope

| Keys | Action |
|---|---|
| `prefix f` | fuzzy-find any tab/pane by title or url (buffers) |
| `prefix g` | live grep across the text of every open page |
| `prefix o` / `prefix O` | open or edit url — prompt is prefilled with the current url, selected (type to replace, arrows to edit) |
| `prefix u` | fuzzy history |
| `prefix m` | bookmark current page — type `tag/name` to group (tags replace folders) |
| `prefix '` | bookmarks finder — `C-x` delete, `C-i` import |
| `prefix /` | find in current page |
| `prefix e` / `prefix E` | link hints — label every clickable element, type to click (E opens links in a new tab) |

Link hints reach into iframes (labels are disjoint across frames) and follow the page
when it scrolls under you.

The window is a single top bar (native macOS traffic lights, tabs, url) above the panes —
drag it to move, double-click to zoom.

Bookmark import (`C-i` inside the bookmarks finder) auto-detects Chrome, Brave, Edge,
Chromium, Arc, and Vivaldi profiles, Safari (needs Full Disk Access), and Firefox, and can
parse any browser's exported bookmarks `.html`. Folder hierarchies become tag paths like
`work/docs`. Bookmarks live in `bookmarks.json` alongside history.

Inside a finder: type to filter, `C-j`/`C-k` (or arrows) to move, `Enter` to select,
`⌘Enter` to open in a new tab, `Esc` to close. Queries are fzf-style — space-separated
terms all have to match (`gh issues` finds "Issues · GitHub").

The open prompt is unified: suggestions merge already-open tabs (selecting one switches
to it instead of loading a copy), bookmarks, and history, deduped in that order and
ranked by frecency — how often *and* how recently you visit a url. A `downloads` finder
(palette: `find: downloads`) opens or reveals past downloads, and `page: open clipboard
url` is paste-and-go.

## Page

`prefix [ / ]` back/forward · `prefix r` reload · `prefix y` copy url.

Chrome muscle memory also works: `⌘T` `⌘W` `⌘L` `⌘P` `⌘F` `⌘Y` `⌘R` `⌘[` `⌘]`
`⌘+/-/0`, `⌘⇧G` live grep, `⌘⌥I` devtools, `⌘N` new window, `⌘⇧N` private tab,
`⌘⇧T` reopen closed tab, `⌃Tab`/`⌃⇧Tab` next/prev tab, `⌘1-8`/`⌘9` jump to tab/last
tab, `⌘O` open local file (the url prompt also accepts `/paths` and `~/paths`).

## Start page

New tabs open `bmux://start` — a neovim-dashboard-style home screen, fully keyboard
driven. ASCII-art header, then a navigable menu: **Actions** (find tab, history,
bookmarks, grep, split, command palette, settings…) and **Jump back in** (recently
closed + most-frecent history + bookmarks, with favicons). `j`/`k` (or arrows) move the
cursor, `Enter` runs the selected item, and each row's **hotkey** (shown on the right)
jumps straight to it. `/` focuses the address box — type a URL or a query (queries go
through your search engine). The essential `C-b` shortcuts stay pinned at the bottom.

Actions run through a bridge that is exposed only to `bmux://` pages and re-checked
against the sender's URL in the main process, so ordinary web pages can't reach it.

## Mouse (fallback)

Keyboard first, but the pointer works where it's natural: drag the gutter between panes to
resize (double-grab to equalize), click a tab to select it, hover a tab for its close ×,
`+` for a new tab, and click the url in the top bar — which shows a **⌘L search or enter
address** hint when empty — to open the url/search prompt. Clicking a pane focuses it.

Pages follow your system light/dark appearance; force it with the `appearance:` commands
in the palette (persisted to config).

## Command palette

Everything that isn't a high-frequency action lives in the command palette — `prefix :`
(or `⌘⇧P`), fuzzy-searchable, no binding to memorize: swap/rotate/break/join panes, close
or rename or reorder tabs, new private tab (in-memory session, no history), mute pane,
hard reload, open in default browser, open clipboard url, print, save as PDF, import
bookmarks, downloads finder, toggle tracker blocking, clear history / site data, open
downloads folder, edit & reload config.

## Custom keybindings

Add your own shortcuts in config — they complement the built-ins (built-ins always win on
conflict). `prefix: true` makes it a prefix chord instead of a global one; global bindings
need at least one of `control`/`alt`/`meta`.

```json
"keybindings": [
  { "key": "n", "alt": true, "command": "tab-next" },
  { "key": "p", "alt": true, "command": "tab-prev" },
  { "key": "N", "prefix": true, "shift": true, "command": "pane-focus-next" }
]
```

Any command id works — palette ids (`tab-close`, `pane-swap-next`, `page-copy-url`,
`tab-private`, `appearance-dark`, …) plus core actions: `tab-next/prev/last/new`,
`tab-move-left/right`, `pane-split-right/down`, `pane-focus-left/right/up/down/next/prev`,
`pane-last`, `pane-zoom`, `pane-close`, `pane-join`, `pane-display`, `layout-equalize`,
`page-back/forward/reload`, `scroll-mode`, `open-clipboard`, `hints`, `hints-newtab`,
`bookmark-add`, `open`, `open-newtab`,
`find-tabs/grep/history/bookmarks/sessions/tree/commands/in-page` and `find-downloads`.
Edit with the `app: edit config file` command, apply with `app: reload config`.

## Custom website actions

Per-site scripts bound to a shortcut. Each action runs your JavaScript in the active
page and only fires when the current URL matches its `match` glob — so the same key can
do different things on different sites. Actions also appear in the command palette as
`action: <name>`.

```json
"actions": [
  {
    "name": "Jira: copy ticket id + title",
    "match": "*.atlassian.net/*",
    "key": { "key": "j", "control": true, "alt": true },
    "script": "const id = document.querySelector('[data-testid=\"issue.views.issue-base.foundation.breadcrumbs.current-issue.item\"]')?.innerText; bmux.copy(`${id} — ${document.title}`); bmux.notify('copied ' + id)"
  }
]
```

- `match` — glob (`*` wildcard) against the full page URL. Omit to match everywhere.
- `key` — same shape as a keybinding; add `"prefix": true` for a `C-b`-prefixed chord,
  otherwise include at least one of `control`/`alt`/`meta` for a global chord.
- `script` — runs in the page. A `bmux` helper is injected:
  - `bmux.copy(text)` — write `text` to the clipboard
  - `bmux.notify(msg)` — flash `msg` in the status bar
  - `bmux.open(url)` — navigate the active pane to `url`

  Anything the script throws is shown in the status bar. The script has no Node access —
  it is ordinary page JavaScript plus the `bmux` helper.

## Themes

`theme` picks a preset for the bmux UI chrome (top bar, finders, settings, start page);
`themeColors` overrides individual tokens. This is the app's own colors — web pages still
render per the light/dark **Appearance** setting.

```json
"theme": "tokyonight",
"themeColors": { "accent": "#ff9e64", "bg": "#101014" }
```

Presets: `tokyonight` (default), `light`, `gruvbox`, `nord`. Tokens: `bg`, `panel`, `fg`,
`dim`, `faint`, `accent`, `border`, `input-bg`, `sel-bg`, `match`. Changes apply live on
`app: reload config` (open start-page tabs pick up new colors on reload).

## Settings

`⌘,` (or the `app: settings…` command) opens Settings as an in-window panel, like the
finders — homepage, search engine, appearance, tracker blocking, prefix key, and custom
keybindings (click a combo, press the new keys). `Esc`, `⌘,`, `⌘W`, or clicking outside
closes it. Changes apply live and write through to `config.json`, which remains editable
directly.

## Config

`~/Library/Application Support/bmux/config.json`:

```json
{
  "prefix": { "key": "b", "control": true, "alt": false, "shift": false },
  "searchUrl": "https://duckduckgo.com/?q=%s",
  "homepage": "bmux://start",
  "blockTrackers": true,
  "blockExtra": ["example-tracker.com"],
  "prefixTimeoutMs": 0,
  "repeatTimeMs": 600,
  "topBarHeight": 36,
  "topBarFontSize": 11.5,
  "whichKey": true,
  "whichKeyDelayMs": 250,
  "theme": "tokyonight",
  "themeColors": {},
  "actions": []
}
```

`topBarHeight` (24–80) and `topBarFontSize` (9–24) size the top bar and its text — also
editable in Settings; changes apply live. Or press **`C-b t`** to enter top-bar resize
mode (the status bar shows **BAR**) and use `⌘+` / `⌘-` / `⌘0` to scale both together.

`whichKey` (on by default) shows a cheatsheet of the prefix keys after you press `C-b`,
like which-key.nvim — toggle it in Settings; `whichKeyDelayMs` is how long the prefix is
held before it appears.

Like tmux, a pending prefix never expires by default (the status bar shows **PREFIX**);
set `prefixTimeoutMs` to make it time out. `repeatTimeMs` is the tmux `repeat-time`
window for focus/resize keys.

Requests to ~55 common ad/tracking domains are blocked (`⊘ n` counter in the status bar),
and every request carries `DNT: 1` and `Sec-GPC: 1` headers. Set `blockTrackers: false`
to disable, `blockExtra` to add your own domains.

Session (tabs + splits) and history persist in the same directory.

Popups opened via `window.open` (OAuth sign-in flows and the like) open as a tab with
`window.opener` intact, so `postMessage` back to the opener works; the tab closes itself
when the popup calls `window.close()`. Plain target=_blank links still open as normal
tabs with no opener.

## Control server (dev)

`BMUX_DEBUG=1 npm start` exposes an HTTP control API on `127.0.0.1:9223` — `/state`,
`/key`, `/eval`, `/main`, `/shot` — used to drive and test the browser from scripts.
`BMUX_DEBUG_PORT` overrides the port; `BMUX_USER_DATA` points the app at an alternate
profile directory.

## Tests

`npm test` runs the end-to-end suite in `test/` — each test boots the real app against a
throwaway profile and drives it over the control server.
