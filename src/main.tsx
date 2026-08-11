import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import DashboardPage from './pages/DashboardPage.tsx'
import TrendsPage from './pages/TrendsPage.tsx'
import TransmutesPage from './pages/TransmutesPage.tsx'
import ExplorerPage from './pages/ExplorerPage.tsx'
import AnalyticsPage from './pages/AnalyticsPage.tsx'
import { AuctionDataProvider } from './data/AuctionDataProvider.tsx'
import { FiltersProvider } from './data/FiltersProvider.tsx'

// HashRouter keeps client-side routing working on any static host served from a
// subpath (base: './') without server rewrites. App is the layout shell; pages
// render into its <Outlet/>.
//
// Views are routable: each page's view lives in a `:view` path segment
// (/#/page/view), so every view is a shareable link (see useRoutedView). A bare
// page path redirects to its default view; legacy single-purpose routes redirect
// to their new home. Prices is the exception — its All view is the site home at
// `/`, so it has no /prices/all in the URL (the page canonicalises there).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <AuctionDataProvider>
        <FiltersProvider>
          <Routes>
            <Route element={<App />}>
              {/* Prices — All is the site home (special-cased); Standard/Onyx
                  are /prices/:view. An unknown or /prices/all slug canonicalises
                  back to `/` inside the page. */}
              <Route index element={<DashboardPage />} />
              <Route path="prices" element={<Navigate to="/" replace />} />
              <Route path="prices/:view" element={<DashboardPage />} />
              <Route path="onyx" element={<Navigate to="/prices/onyx" replace />} />

              {/* Trends — season (default) | yoy. /timelines and /compare were
                  the two lenses before they merged; keep them as deep-links. */}
              <Route path="trends" element={<Navigate to="/trends/season" replace />} />
              <Route path="trends/:view" element={<TrendsPage />} />
              <Route path="timelines" element={<Navigate to="/trends/season" replace />} />
              <Route path="compare" element={<Navigate to="/trends/yoy" replace />} />

              {/* Transmutes — Recipes (default) | Build Calculator, both behind
                  the in-page view toggle so the top-level nav stays at five. */}
              <Route path="transmutes" element={<Navigate to="/transmutes/recipes" replace />} />
              <Route path="transmutes/:view" element={<TransmutesPage />} />

              {/* Auction Data (explorer) — grouped (default) | full. /augments
                  folded in here; redirect old bookmarks rather than 404 them. */}
              <Route path="explorer" element={<Navigate to="/explorer/grouped" replace />} />
              <Route path="explorer/:view" element={<ExplorerPage />} />
              <Route path="augments" element={<Navigate to="/explorer/grouped" replace />} />

              {/* Analytics — current (default) | historical | quartiles | context. */}
              <Route path="analytics" element={<Navigate to="/analytics/current" replace />} />
              <Route path="analytics/:view" element={<AnalyticsPage />} />
            </Route>
          </Routes>
        </FiltersProvider>
      </AuctionDataProvider>
    </HashRouter>
  </StrictMode>,
)
