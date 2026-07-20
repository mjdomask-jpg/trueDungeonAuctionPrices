import { Outlet } from 'react-router-dom';
import { SiteHeader } from './components/SiteHeader';
import { useTheme } from './hooks/useTheme';
import './App.css';

// Layout shell shared by every page: the constrained wrapper, the global
// header, and an <Outlet/> where the routed page renders.
export default function App() {
  const [theme, toggleTheme] = useTheme();

  return (
    <div className="wrap">
      <SiteHeader theme={theme} onToggleTheme={toggleTheme} />
      <Outlet />
    </div>
  );
}
