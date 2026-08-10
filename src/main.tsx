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
// subpath (base: './') without server rewrites. Routes: App is the layout
// shell; pages render into its <Outlet/>. Add new pages as sibling <Route>s.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <AuctionDataProvider>
        <FiltersProvider>
          <Routes>
            <Route element={<App />}>
              <Route index element={<DashboardPage key="prices" />} />
              {/* Timelines + Compare Years merged into Trends behind a view
                  toggle. The old routes redirect, deep-linking their lens; the
                  distinct keys force a remount so initialView wins over a reused
                  TrendsPage instance's view state. */}
              <Route path="trends" element={<TrendsPage key="trends" />} />
              <Route path="timelines" element={<TrendsPage key="trends-season" initialView="season" />} />
              <Route path="compare" element={<TrendsPage key="trends-year" initialView="year" />} />
              <Route path="transmutes" element={<TransmutesPage />} />
              {/* Onyx folded into Prices as a view; /onyx deep-links it with the
                  Onyx view preselected so old bookmarks (and the Auction Data
                  link) still land on Onyx. The distinct key forces a remount when
                  crossing between this and the index route, so initialView is
                  honoured instead of the reused instance's stale view state. */}
              <Route path="onyx" element={<DashboardPage key="onyx" initialView="onyx" />} />
              <Route path="explorer" element={<ExplorerPage />} />
              {/* Augments & Withheld folded into Auction Data (the explorer);
                  redirect old bookmarks rather than 404 them. */}
              <Route path="augments" element={<Navigate to="/explorer" replace />} />
              <Route path="analytics" element={<AnalyticsPage />} />
            </Route>
          </Routes>
        </FiltersProvider>
      </AuctionDataProvider>
    </HashRouter>
  </StrictMode>,
)
