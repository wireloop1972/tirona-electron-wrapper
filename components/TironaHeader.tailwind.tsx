'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Layers,
  Home,
  Grid3X3,
  UserCircle,
  BookOpen,
  Shield,
  Settings,
  Minus,
  Square,
  X,
  Copy,
} from 'lucide-react';

/**
 * TironaHeader - Tailwind CSS version
 * 
 * Prerequisites:
 * 1. Install lucide-react: npm install lucide-react
 * 2. Add custom colors to tailwind.config.js:
 *    colors: {
 *      tirona: {
 *        gold: '#f0c878',
 *        'gold-light': '#d4a84b',
 *        'dark': '#1a130e',
 *        'dark-light': '#2d1f14',
 *      }
 *    }
 * 3. Add custom font (Cinzel) for the title, or use serif fallback
 */

declare global {
  interface Window {
    electron?: {
      isElectron: boolean;
      platform: string;
      window: {
        minimize: () => void;
        maximize: () => void;
        close: () => void;
        isMaximized: () => Promise<boolean>;
      };
      openSettings: () => void;
    };
  }
}

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  href?: string;
}

interface TironaHeaderProps {
  currentPage?: string;
  onNavigate?: (page: string) => void;
  userAvatar?: string;
  userName?: string;
}

export function TironaHeader({
  currentPage = 'adventure',
  onNavigate,
  userAvatar,
  userName = 'Player',
}: TironaHeaderProps) {
  const [isMaximized, setIsMaximized] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isElectron = typeof window !== 'undefined' && window.electron?.isElectron;

  const navItems: NavItem[] = [
    { id: 'adventure', label: 'Adventure', icon: <Layers size={16} /> },
    { id: 'village', label: 'Village', icon: <Home size={16} /> },
    { id: 'battlemap', label: 'Battlemap', icon: <Grid3X3 size={16} /> },
    { id: 'character', label: 'Character Creation', icon: <UserCircle size={16} /> },
    { id: 'guide', label: 'Guide', icon: <BookOpen size={16} /> },
    { id: 'admin', label: 'Admin', icon: <Shield size={16} /> },
    { id: 'settings', label: 'Settings', icon: <Settings size={16} /> },
  ];

  useEffect(() => {
    if (isElectron) {
      window.electron?.window.isMaximized().then(setIsMaximized);
    }
  }, [isElectron]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMinimize = () => window.electron?.window.minimize();
  const handleMaximize = () => {
    window.electron?.window.maximize();
    setIsMaximized(!isMaximized);
  };
  const handleClose = () => window.electron?.window.close();

  return (
    <header
      className="fixed top-0 left-0 right-0 z-[9999] h-14 
        bg-gradient-to-b from-[#2d1f14]/95 to-[#1a130e]/95
        backdrop-blur-md border-b border-[#f0c878]/20
        flex items-center justify-between select-none"
    >
      {/* Left: Logo + Title (draggable) */}
      <div
        className="flex items-center gap-3 pr-6 cursor-move"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Logo */}
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#8b6914] via-[#d4a84b] to-[#8b6914]
          flex items-center justify-center shadow-lg ml-4"
        >
          <span className="text-lg font-bold text-[#1a130e]">T</span>
        </div>

        {/* Title */}
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold text-[#f0c878] tracking-wide
            font-serif drop-shadow-[0_0_10px_rgba(240,200,120,0.3)]"
          >
            Tirona
          </span>
          <span className="text-[11px] font-medium text-[#d4a84b] tracking-[0.2em] uppercase opacity-90">
            REBIRTH
          </span>
        </div>
      </div>

      {/* Center: Navigation */}
      <nav
        className="flex items-center gap-1 flex-1 justify-center"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate?.(item.id)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13px] font-medium
              transition-all duration-200 whitespace-nowrap
              ${currentPage === item.id
                ? 'bg-[#f0c878]/15 border border-[#f0c878]/50 text-[#f0c878]'
                : 'border border-transparent text-[#f0c878]/70 hover:bg-[#f0c878]/10 hover:text-[#f0c878]'
              }`}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Right: User avatar + Window controls */}
      <div
        className="flex items-center gap-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* User dropdown */}
        <div ref={dropdownRef} className="relative">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="w-10 h-10 rounded-full border-2 border-[#f0c878]/40
              bg-gradient-to-br from-[#3d2d1a] to-[#2d1f14]
              flex items-center justify-center cursor-pointer
              hover:border-[#f0c878]/70 transition-colors"
            style={userAvatar ? { backgroundImage: `url(${userAvatar})`, backgroundSize: 'cover' } : {}}
          >
            {!userAvatar && (
              <span className="text-[#f0c878] text-base">{userName.charAt(0).toUpperCase()}</span>
            )}
          </button>

          {/* Dropdown */}
          {dropdownOpen && (
            <div className="absolute top-12 right-0 min-w-[180px]
              bg-gradient-to-b from-[#2d1f14]/98 to-[#1a130e]/98
              backdrop-blur-md border border-[#f0c878]/20 rounded-lg
              shadow-[0_8px_32px_rgba(0,0,0,0.4)] py-2 z-[10000]"
            >
              <div className="px-4 py-3 border-b border-[#f0c878]/10">
                <p className="text-[#f0c878] text-sm font-medium">{userName}</p>
              </div>
              <button
                onClick={() => {
                  window.electron?.openSettings();
                  setDropdownOpen(false);
                }}
                className="w-full px-4 py-2.5 text-left text-[13px] text-[#f0c878]/80
                  hover:bg-[#f0c878]/10 transition-colors"
              >
                Settings (TODO)
              </button>
            </div>
          )}
        </div>

        {/* Window controls (Electron only) */}
        {isElectron && (
          <div className="flex items-stretch h-14 ml-2">
            <button
              onClick={handleMinimize}
              title="Minimize"
              className="w-[46px] h-full flex items-center justify-center
                text-[#f0c878]/70 hover:bg-[#f0c878]/15 transition-colors"
            >
              <Minus size={16} />
            </button>
            <button
              onClick={handleMaximize}
              title={isMaximized ? 'Restore' : 'Maximize'}
              className="w-[46px] h-full flex items-center justify-center
                text-[#f0c878]/70 hover:bg-[#f0c878]/15 transition-colors"
            >
              {isMaximized ? <Copy size={14} /> : <Square size={14} />}
            </button>
            <button
              onClick={handleClose}
              title="Close"
              className="w-[46px] h-full flex items-center justify-center
                text-[#f0c878]/70 hover:bg-red-600 hover:text-white transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

export default TironaHeader;
