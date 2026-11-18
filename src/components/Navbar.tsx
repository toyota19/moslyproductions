import React, { useState } from 'react';
import { EVENT_LOGO_URL } from '../types';

export type ActiveView = 'purchase' | 'admin' | 'scanner';

interface NavbarProps {
  activeView: ActiveView;
  onNavigate: (view: ActiveView) => void;
  onScrollToSection: (sectionId: 'zonas' | 'pagos' | 'reserva') => void;
  onQuickReserve: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeView,
  onNavigate,
  onScrollToSection,
  onQuickReserve,
}) => {
  const [logoFailed, setLogoFailed] = useState(false);
  const isStaffRoute = activeView === 'admin' || activeView === 'scanner';

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#09090B]/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-8 px-4 sm:px-6 lg:px-8">
        {/* Zone 1: Event Logo */}
        <button
          type="button"
          onClick={() => onNavigate('purchase')}
          aria-label="Ir a MOSLY"
          className="flex items-center whitespace-nowrap shrink-0 transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-sm"
        >
          {!logoFailed ? (
            <img
              src={EVENT_LOGO_URL}
              alt="MOSLY"
              onError={() => setLogoFailed(true)}
              className="h-7 w-auto object-contain mix-blend-screen"
            />
          ) : (
            <span className="font-display text-lg font-bold tracking-[0.2em] text-zinc-50">
              MOSLY
            </span>
          )}
        </button>

        {/* Zone 2: Public customer links vs private staff links */}
        {isStaffRoute ? (
          <nav
            aria-label="Navegación interna"
            className="flex items-center gap-5 sm:gap-7 overflow-x-auto overflow-y-hidden md:overflow-visible"
          >
            <button
              type="button"
              onClick={() => onNavigate('admin')}
              aria-current={activeView === 'admin' ? 'page' : undefined}
              className={`relative py-2 text-xs sm:text-sm font-medium whitespace-nowrap shrink-0 transition-colors ${
                activeView === 'admin' ? 'text-zinc-50' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Panel Admin
              {activeView === 'admin' && (
                <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[2px] bg-amber-500" />
              )}
            </button>
            <button
              type="button"
              onClick={() => onNavigate('scanner')}
              aria-current={activeView === 'scanner' ? 'page' : undefined}
              className={`relative py-2 text-xs sm:text-sm font-medium whitespace-nowrap shrink-0 transition-colors ${
                activeView === 'scanner' ? 'text-zinc-50' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Escáner Puerta
              {activeView === 'scanner' && (
                <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[2px] bg-amber-500" />
              )}
            </button>
            <button
              type="button"
              onClick={() => onNavigate('purchase')}
              className="py-2 text-xs sm:text-sm font-medium text-zinc-400 hover:text-zinc-200 whitespace-nowrap shrink-0 transition-colors"
            >
              Ver Taquilla
            </button>
          </nav>
        ) : (
          <nav
            aria-label="Navegación principal"
            className="flex items-center gap-5 sm:gap-7 overflow-x-auto overflow-y-hidden md:overflow-visible"
          >
            <button
              type="button"
              onClick={() => onScrollToSection('zonas')}
              className="py-2 text-xs sm:text-sm font-medium text-zinc-300 hover:text-zinc-50 whitespace-nowrap shrink-0 transition-colors"
            >
              Zonas
            </button>
            <button
              type="button"
              onClick={() => onScrollToSection('pagos')}
              className="py-2 text-xs sm:text-sm font-medium text-zinc-300 hover:text-zinc-50 whitespace-nowrap shrink-0 transition-colors"
            >
              Métodos de Pago
            </button>
            <button
              type="button"
              onClick={() => onScrollToSection('reserva')}
              className="py-2 text-xs sm:text-sm font-medium text-zinc-300 hover:text-zinc-50 whitespace-nowrap shrink-0 transition-colors"
            >
              Subir Comprobante
            </button>
          </nav>
        )}

        {/* Zone 3: Single primary action */}
        <div className="hidden md:flex items-center shrink-0">
          <button
            type="button"
            onClick={onQuickReserve}
            className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-zinc-950 whitespace-nowrap shrink-0 transition-colors duration-150 hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090B]"
          >
            Comprar Entrada
          </button>
        </div>
      </div>
    </header>
  );
};
