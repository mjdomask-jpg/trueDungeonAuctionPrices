import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import DashboardPage from './pages/DashboardPage.tsx'
import TimelinesPage from './pages/TimelinesPage.tsx'
import ComparePage from './pages/ComparePage.tsx'
import TransmutesPage from './pages/TransmutesPage.tsx'
import OnyxPage from './pages/OnyxPage.tsx'
import ExplorerPage from './pages/ExplorerPage.tsx'
import { AuctionDataProvider } from './data/AuctionDataProvider.tsx'

// HashRouter keeps client-side routing working on any static host served from a
// subpath (base: './') without server rewrites. Routes: App is the layout
// shell; pages render into its <Outlet/>. Add new pages as sibling <Route>s.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <AuctionDataProvider>
        <Routes>
          <Route element={<App />}>
            <Route index element={<DashboardPage />} />
            <Route path="timelines" element={<TimelinesPage />} />
            <Route path="compare" element={<ComparePage />} />
            <Route path="transmutes" element={<TransmutesPage />} />
            <Route path="onyx" element={<OnyxPage />} />
            <Route path="explorer" element={<ExplorerPage />} />
          </Route>
        </Routes>
      </AuctionDataProvider>
    </HashRouter>
  </StrictMode>,
)
