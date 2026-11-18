/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminView } from './components/AdminView';
import { DigitalPassView } from './components/DigitalPassView';
import { ActiveView, Navbar } from './components/Navbar';
import { PurchaseView } from './components/PurchaseView';
import { ScannerView } from './components/ScannerView';
import { TicketZone } from './types';
import { safeParseJson } from './utils/api';

const SESSION_STORAGE_KEY = 'mosly_session_token';

type RouteState =
  | { view: ActiveView }
  | { view: 'pass'; token: string };

function parseLocationRoute(): RouteState {
  const pathname = window.location.pathname.replace(/\/+$/, '').toLowerCase();
  const rawHash = window.location.hash.replace(/^#/, '');
  const [hashPath, hashQuery] = rawHash.split('?');
  const normalizedHash = hashPath.toLowerCase();

  if (normalizedHash === 'pase' || pathname === '/pase') {
    const params = new URLSearchParams(hashQuery || window.location.search || '');
    return { view: 'pass', token: params.get('t') || '' };
  }
  if (pathname === '/admin' || normalizedHash === 'admin') {
    return { view: 'admin' };
  }
  if (
    pathname === '/escaner' ||
    pathname === '/scanner' ||
    pathname === '/puerta' ||
    normalizedHash === 'escaner' ||
    normalizedHash === 'scanner' ||
    normalizedHash === 'puerta'
  ) {
    return { view: 'scanner' };
  }
  return { view: 'purchase' };
}

export default function App() {
  const [route, setRoute] = useState<RouteState>(() => parseLocationRoute());
  const [selectedZone, setSelectedZone] = useState<TicketZone>('general');
  const [authToken, setAuthToken] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(SESSION_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const formSectionRef = useRef<HTMLDivElement | null>(null);

  const verifySession = useCallback(async (tokenOverride?: string | null) => {
    setIsCheckingAuth(true);
    const activeToken = tokenOverride !== undefined ? tokenOverride : authToken;
    try {
      const response = await fetch('/api/auth/session', {
        credentials: 'include',
        headers: activeToken ? { Authorization: `Bearer ${activeToken}` } : undefined,
      });
      if (response.ok) {
        const data = await safeParseJson<{ authenticated?: boolean }>(response);
        const valid = Boolean(data?.authenticated);
        setIsAuthenticated(valid);
        if (!valid) {
          setAuthToken(null);
          try {
            sessionStorage.removeItem(SESSION_STORAGE_KEY);
          } catch {
            // Ignore storage restrictions
          }
        }
      } else {
        setIsAuthenticated(false);
      }
    } catch {
      setIsAuthenticated(false);
    } finally {
      setIsCheckingAuth(false);
    }
  }, [authToken]);

  useEffect(() => {
    verifySession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const syncRoute = () => {
      setRoute(parseLocationRoute());
    };
    window.addEventListener('hashchange', syncRoute);
    window.addEventListener('popstate', syncRoute);
    return () => {
      window.removeEventListener('hashchange', syncRoute);
      window.removeEventListener('popstate', syncRoute);
    };
  }, []);

  const handleNavigate = useCallback((view: ActiveView) => {
    setRoute({ view });
    const pathMap: Record<ActiveView, string> = {
      purchase: '/',
      admin: '/admin',
      scanner: '/escaner',
    };
    if (window.location.pathname !== pathMap[view] || window.location.hash) {
      window.history.pushState(null, '', pathMap[view]);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleScrollToSection = useCallback(
    (sectionId: 'zonas' | 'pagos' | 'reserva') => {
      if (route.view !== 'purchase') {
        handleNavigate('purchase');
        window.setTimeout(() => {
          document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 120);
      } else {
        document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    [route.view, handleNavigate],
  );

  const handleQuickReserve = useCallback(() => {
    handleScrollToSection('reserva');
  }, [handleScrollToSection]);

  const handleAuthenticated = useCallback((token: string | null) => {
    if (token) {
      setAuthToken(token);
      try {
        sessionStorage.setItem(SESSION_STORAGE_KEY, token);
      } catch {
        // Ignore storage restrictions
      }
    }
    setIsAuthenticated(true);
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Ignore network issues during logout
    }
    setAuthToken(null);
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Ignore storage restrictions
    }
    setIsAuthenticated(false);
  }, []);

  const activeNavView: ActiveView = route.view === 'pass' ? 'purchase' : route.view;

  return (
    <div className="min-h-screen flex flex-col bg-[#09090B] text-zinc-50">
      <Navbar
        activeView={activeNavView}
        onNavigate={handleNavigate}
        onScrollToSection={handleScrollToSection}
        onQuickReserve={handleQuickReserve}
      />

      <div className="flex-1">
        {route.view === 'purchase' && (
          <PurchaseView
            selectedZone={selectedZone}
            onSelectZone={setSelectedZone}
            formSectionRef={formSectionRef}
          />
        )}
        {route.view === 'admin' && (
          <AdminView
            authToken={authToken}
            isAuthenticated={isAuthenticated}
            isCheckingAuth={isCheckingAuth}
            onAuthenticated={handleAuthenticated}
            onLogout={handleLogout}
          />
        )}
        {route.view === 'scanner' && (
          <ScannerView
            authToken={authToken}
            isAuthenticated={isAuthenticated}
            isCheckingAuth={isCheckingAuth}
            onAuthenticated={handleAuthenticated}
            onLogout={handleLogout}
          />
        )}
        {route.view === 'pass' && (
          <DigitalPassView
            token={route.token}
            onBackToStore={() => handleNavigate('purchase')}
          />
        )}
      </div>

      <footer className="border-t border-white/10 bg-[#09090B] py-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div>MOSLY · Taquilla Oficial</div>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => handleScrollToSection('zonas')}
              className="hover:text-zinc-300 transition-colors"
            >
              Zonas
            </button>
            <button
              type="button"
              onClick={() => handleScrollToSection('pagos')}
              className="hover:text-zinc-300 transition-colors"
            >
              Métodos de pago
            </button>
            <button
              type="button"
              onClick={() => handleScrollToSection('reserva')}
              className="hover:text-zinc-300 transition-colors"
            >
              Comprar entrada
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
