# Frontend Redesign — Tech Theme Migration

This branch (`redesign/tech-theme`) migrates the frontend visual language to a
terminal-inspired "tech" theme: Geist Mono typography, phosphor-green accents on
near-black surfaces, hairline borders, dense headers, and a smart-hierarchy
watchlist with auto-bucketing and a focus panel.

The migration is **partial by design**: the screens that ship the new look in
this PR are listed under [Migrated](#migrated). Everything under
[Deferred](#deferred) keeps the legacy styling until its own follow-up PR.

---

## How to apply

This redesign was generated outside the repo and is delivered as a drop-in
`frontend/` tree. To apply:

```bash
git checkout -b redesign/tech-theme
# Copy the generated frontend/ tree over your working tree:
cp -R /path/to/generated/frontend ./
# Review the diff:
git status
git diff --stat
# Install (no new deps, but lockfile may have moved):
cd frontend && npm install
npm run dev
```

No backend changes are required — types, API client, and auth context are
unchanged.

---

## Architecture changes

### CSS strategy: hybrid (global tokens + per-component modules)

| Layer | File | Purpose |
|---|---|---|
| Tokens | `src/styles/tokens.css` | All `--nbc-*`, `--bull`, `--bear`, `--warn`, `--info`, density (`--d-*`) custom properties. Themeable via `data-density` and `data-cb` attributes on `<html>`. |
| Base | `src/styles/base.css` | Reset, body, global utility classes (`.num`, `.label`, `.prose`, `.term`), button base (`.btn`, `.btn--primary`, etc.). |
| Component | `*.module.css` next to each `.tsx` | Component-scoped styles, hashed at build time. Reference globals via CSS custom properties + the `prose` / `label` / `num` utility classes via `:global()`. |
| Legacy | `src/App.css` | **Unchanged.** Still ships the styling for not-yet-migrated components (PositionsPanel, KillSwitchDashboard family, modals, NotificationToast, ErrorBoundary, auth pages). |

`main.tsx` imports CSS in this order — important so the new aesthetic wins for
shared selectors like `.btn`:

```ts
import './App.css';            // legacy
import './styles/tokens.css';  // new tokens
import './styles/base.css';    // new base + global utilities
```

### New folders

```
src/
├── styles/
│   ├── tokens.css            (NEW)
│   └── base.css              (NEW)
├── helpers/
│   └── hierarchy.ts          (NEW: computeFocus, bucketSymbols, fakeScoreComponents)
├── hooks/
│   ├── useNow.ts             (NEW)
│   ├── useScanCountdown.ts   (NEW)
│   └── useIsMobile.ts        (NEW)
├── components/
│   ├── atoms/                (NEW folder for small reusable presentation atoms)
│   │   ├── HeartbeatDot.tsx
│   │   ├── ScanProgressBar.tsx
│   │   ├── ScoreGrid.tsx + .module.css
│   │   ├── SideBadge.tsx + .module.css
│   │   ├── TriggerPill.tsx + .module.css
│   │   ├── LrcBar.tsx + .module.css
│   │   ├── PriceSpark.tsx
│   │   └── RailIcon.tsx
│   ├── LeftRail.tsx + .module.css       (NEW)
│   ├── BottomNav.tsx + .module.css      (NEW)
│   ├── Ticker.tsx + .module.css         (NEW)
│   ├── FocusPanel.tsx + .module.css     (NEW)
│   ├── CommandBar.tsx + .module.css     (NEW)
│   ├── UserMenu.tsx + .module.css       (NEW)
│   └── SymbolRow.tsx + .module.css      (NEW: compact variant of SymbolCard)
└── types-ui.ts                          (NEW: MainTab, SymbolsFilter)
```

### Replaced files

| File | What changed |
|---|---|
| `index.html` | Swapped Inter for **Geist Mono + JetBrains Mono + Inter Tight**, updated favicon SVG, dark theme-color. |
| `main.tsx` | New import order for stylesheets (see above). |
| `App.tsx` | New layout: Header → Ticker → LeftRail + Main → BottomNav (mobile). Tabs moved from inline buttons into the LeftRail/BottomNav. Wires three new top-level overlays (NotificationBell dropdown, ConfigPanel slide-out, UserMenu). Fetches positions for the Focus panel. |
| `App.module.css` | NEW — replaces the `.app` / `.app-main` / `.app-footer` rules from the legacy stylesheet. |
| `components/Header.tsx` | Full rewrite — dense terminal-style bar with brand · LIVE · telemetry · CommandBar · actions · user. Mobile variant collapses to brand + LIVE pill + scan + bell. |
| `components/NotificationBell.tsx` | Full rewrite — the icon trigger now lives in `Header.tsx`; this component owns the dropdown body (filters: todas / señales / sistema), polling, and read-state. Accepts `open` + `onClose` from `App.tsx` so the bell/gear/user-menu coordinate (only one open at a time). |
| `components/ConfigPanel.tsx` | Full rewrite as a right-side slide-out with backdrop blur. Score filter is now a tick-bar slider; toggles use a custom switch; auto-tune section gets its own header. Preserves the existing `/config` GET + POST wiring exactly. |
| `components/SymbolCard.tsx` | Full rewrite with `featured` and standard variants. Uses `ScoreGrid` + `LrcBar` + `SideBadge` + `TriggerPill` atoms. |
| `components/SymbolsGrid.tsx` | Full rewrite — uses `bucketSymbols()` to render three tiers: **Setups firmes** (featured cards), **En seguimiento** (standard cards), **Tranquilos** (compressed `SymbolRow`s). Filter chips become `all` / `signals` / `fresh`. |
| `components/SignalsTable.tsx` | Restyled (no API change) — denser table, "fresh" rows get a green left-bar and tinted background, score column uses inline pill style. Adds a `mobile` prop that switches to a card-stack layout. |
| `components/StatusBar.tsx` | Restyled as a dense horizontal strip (was 4 large metric cards). Same data, less vertical real estate. |
| `vite-env.d.ts` | NEW — declares the `*.module.css` module type so TypeScript stops complaining about CSS imports. |

### Unchanged files

These were touched only by my GitHub import to read their types/props; the
files in your repo are byte-identical:

- `src/api.ts`, `src/types.ts`, `src/utils.ts`
- `src/auth/*` (AuthContext, useAuth, api, LoginPage, SetupPage, ProtectedRoute, *.css)
- `src/components/NotificationToast.tsx` — works fine alongside the new bell
- `src/components/ErrorBoundary.tsx`
- `src/components/ChartModal.tsx` — left as is; modals come in a follow-up
- `src/components/OpenPositionModal.tsx` — same
- `src/components/TuneReportModal.tsx` — same
- `src/components/PositionsPanel.tsx` — Posiciones tab still uses legacy styling
- `src/components/KillSwitchDashboard.tsx`, `KillSwitchSymbolCard.tsx`,
  `PortfolioPanel.tsx`, `AlertsStrip.tsx`, `MetricsBlock.tsx`, `Sparkline.tsx`
  — Kill-switch tab still uses legacy styling

---

## Migrated

The **Mercado** tab is fully on the new design system:

- ✅ Header (dense terminal bar with brand, LIVE pulse, telemetry, CommandBar, actions, user)
- ✅ Ticker tape under the header
- ✅ LeftRail (desktop) / BottomNav (mobile)
- ✅ NotificationBell dropdown
- ✅ ConfigPanel slide-out
- ✅ UserMenu dropdown
- ✅ StatusBar
- ✅ FocusPanel ("qué mirar ahora" — auto-prioritised by `computeFocus`)
- ✅ Watchlist with three-tier bucketing (Setups firmes / En seguimiento / Tranquilos)
- ✅ SymbolCard (featured + standard) + SymbolRow (quiet)
- ✅ SignalsTable (table on desktop, cards on mobile, fresh-row highlight)
- ✅ Mobile layout (collapses header, swaps rail for bottom nav, stacks panels)

---

## Deferred (next PRs)

These keep working but visually feel like the old app. Each is a self-contained
follow-up PR:

1. **PositionsPanel** (`PositionsPanel.tsx`, 21KB) — biggest unmigrated piece. Needs its own pass for the empty state, open / closed tables, and probably a redesign of the inline position-cards.
2. **KillSwitch tab** (`KillSwitchDashboard.tsx` + `KillSwitchSymbolCard.tsx` + `PortfolioPanel.tsx` + `AlertsStrip.tsx` + `MetricsBlock.tsx` + `Sparkline.tsx`).
3. **Modals**: `ChartModal`, `OpenPositionModal`, `TuneReportModal` — wrap in the new backdrop+blur shell and re-skin the controls.
4. **NotificationToast** — toast stack styles are still legacy; should adopt the new card/glyph language consistent with the bell dropdown.
5. **Auth pages** (`LoginPage`, `SetupPage`) — separate `.css` files; not yet redesigned.

When you migrate one, the corresponding selectors can be **deleted from `App.css`**.
Eventually the file should disappear entirely.

---

## Known gotchas

- **`fakeScoreComponents`** in `helpers/hierarchy.ts` generates a placeholder
  cell-breakdown for the `ScoreGrid` because the backend doesn't yet expose
  per-component scoring. When `/symbols` starts returning a `score_components`
  array, swap the call site in `SymbolCard.tsx` and `SymbolRow.tsx`.
- **`PriceSpark` data** is currently a deterministic synthetic series seeded
  from the symbol name. The sparkline is visually faithful but does NOT
  reflect real price action. When `/symbols` exposes recent ticks (or we add
  a `getSparkline()` endpoint), replace `fakePriceSeries` in `SymbolCard.tsx`.
- **`Ticker` change direction** uses `lrc_pct <= 25` as a bull proxy, since
  the backend doesn't expose a 24h change. Swap for the real field once
  available.
- **`FocusPanel` near-SL / near-TP heuristic** approximates "current price"
  via `entry_price * (1 + pnl_pct/100)`. If the backend's `pnl_pct` is stale
  by more than the scan interval, the focus items can be off by a tick. When
  positions ship a fresh `current_price` field, use it directly.
- **`useIsMobile` breakpoint** is `768px`. Adjust in `src/hooks/useIsMobile.ts`
  if you want a different cutoff.
- **CSS `:has()`** is used in `SignalsTable.module.css` for the
  no-action-column variant. Supported in all evergreen browsers from 2023;
  drop it if you need IE11 (you don't).
- **No new dependencies**. The migration uses only React + react-router-dom
  which you already ship. No CSS-in-JS, no lightweight-charts changes, no
  Mantine. `package.json` is untouched.

---

## Tests

I did not add tests for the new components. The existing test suite
(`*.test.tsx`) targets the OLD components — many will fail after migration
because the rendered DOM has changed. Plan:

1. Delete obsolete tests for the rewritten components (or update their
   assertions for the new DOM).
2. Add a smoke test that mounts `<App />` with mocked `getSymbols` / `getStatus`
   / `getSignals` and asserts the new section headers render.
3. The atoms (`ScoreGrid`, `SideBadge`, `TriggerPill`, `LrcBar`, `PriceSpark`)
   are pure presentation and trivial to unit test.

---

## Visual reference

The HTML mock used as the source-of-truth for this migration lives at
the project root: `Mercado Redesign.html` (open in any browser). Every
component there has a 1:1 TSX equivalent under `frontend/src/components/`.
