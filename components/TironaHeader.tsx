'use client';

import { useState, useEffect, useRef } from 'react';

/**
 * TypeScript declarations for Electron window control API
 * These match the preload.ts exposed APIs
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
  icon?: React.ReactNode;
  href?: string;
  onClick?: () => void;
}

interface TironaHeaderProps {
  currentPage?: string;
  onNavigate?: (page: string) => void;
  userAvatar?: string;
  userName?: string;
}

/**
 * TironaHeader - Custom frameless window header for Tirona desktop app
 * 
 * Features:
 * - Dark gradient background with blur effect
 * - Gold typography matching game aesthetic
 * - Window drag region on title area
 * - Window controls (minimize, maximize, close)
 * - Navigation menu with icons
 * - User profile dropdown
 */
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

  // Navigation items based on screenshot
  const navItems: NavItem[] = [
    { id: 'adventure', label: 'Adventure', icon: <AdventureIcon /> },
    { id: 'village', label: 'Village', icon: <VillageIcon /> },
    { id: 'battlemap', label: 'Battlemap', icon: <BattlemapIcon /> },
    { id: 'character', label: 'Character Creation', icon: <CharacterIcon /> },
    { id: 'guide', label: 'Guide', icon: <GuideIcon /> },
    { id: 'admin', label: 'Admin', icon: <AdminIcon /> },
    { id: 'settings', label: 'Settings', icon: <SettingsIcon /> },
  ];

  // Check maximized state on mount
  useEffect(() => {
    if (isElectron) {
      window.electron?.window.isMaximized().then(setIsMaximized);
    }
  }, [isElectron]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Window control handlers
  const handleMinimize = () => window.electron?.window.minimize();
  const handleMaximize = () => {
    window.electron?.window.maximize();
    setIsMaximized(!isMaximized);
  };
  const handleClose = () => window.electron?.window.close();

  const handleNavClick = (item: NavItem) => {
    if (item.onClick) {
      item.onClick();
    } else if (onNavigate) {
      onNavigate(item.id);
    }
  };

  return (
    <header
      className="tirona-header"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        height: '56px',
        background: 'linear-gradient(to bottom, rgba(45, 31, 20, 0.95), rgba(26, 19, 14, 0.95))',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(240, 200, 120, 0.2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingLeft: '16px',
        paddingRight: '0',
        userSelect: 'none',
        fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Left section: Logo and Title (draggable) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          // @ts-expect-error - Electron-specific CSS property
          WebkitAppRegion: 'drag',
          cursor: 'move',
          paddingRight: '24px',
        }}
      >
        {/* Tirona Logo/Icon */}
        <div
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #8b6914 0%, #d4a84b 50%, #8b6914 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
          }}
        >
          <span style={{ fontSize: '18px', color: '#1a130e', fontWeight: 'bold' }}>T</span>
        </div>

        {/* Title */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <span
            style={{
              fontSize: '24px',
              fontWeight: '600',
              color: '#f0c878',
              fontFamily: "'Cinzel', 'Times New Roman', serif",
              textShadow: '0 0 10px rgba(240, 200, 120, 0.3)',
              letterSpacing: '0.05em',
            }}
          >
            Tirona
          </span>
          <span
            style={{
              fontSize: '11px',
              fontWeight: '500',
              color: '#d4a84b',
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              opacity: 0.9,
            }}
          >
            REBIRTH
          </span>
        </div>
      </div>

      {/* Center section: Navigation */}
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          flex: 1,
          justifyContent: 'center',
          // @ts-expect-error - Electron-specific CSS property
          WebkitAppRegion: 'no-drag',
        }}
      >
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => handleNavClick(item)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 14px',
              borderRadius: '20px',
              border: currentPage === item.id
                ? '1px solid rgba(240, 200, 120, 0.5)'
                : '1px solid transparent',
              background: currentPage === item.id
                ? 'rgba(240, 200, 120, 0.15)'
                : 'transparent',
              color: currentPage === item.id ? '#f0c878' : 'rgba(240, 200, 120, 0.7)',
              fontSize: '13px',
              fontWeight: '500',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => {
              if (currentPage !== item.id) {
                e.currentTarget.style.background = 'rgba(240, 200, 120, 0.1)';
                e.currentTarget.style.color = '#f0c878';
              }
            }}
            onMouseLeave={(e) => {
              if (currentPage !== item.id) {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'rgba(240, 200, 120, 0.7)';
              }
            }}
          >
            <span style={{ width: '16px', height: '16px', display: 'flex' }}>
              {item.icon}
            </span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Right section: User avatar and window controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          // @ts-expect-error - Electron-specific CSS property
          WebkitAppRegion: 'no-drag',
        }}
      >
        {/* User dropdown */}
        <div ref={dropdownRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              border: '2px solid rgba(240, 200, 120, 0.4)',
              background: userAvatar
                ? `url(${userAvatar}) center/cover`
                : 'linear-gradient(135deg, #3d2d1a 0%, #2d1f14 100%)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'border-color 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'rgba(240, 200, 120, 0.7)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'rgba(240, 200, 120, 0.4)';
            }}
          >
            {!userAvatar && (
              <span style={{ color: '#f0c878', fontSize: '16px' }}>
                {userName.charAt(0).toUpperCase()}
              </span>
            )}
          </button>

          {/* Dropdown menu */}
          {dropdownOpen && (
            <div
              style={{
                position: 'absolute',
                top: '48px',
                right: '0',
                minWidth: '180px',
                background: 'linear-gradient(to bottom, rgba(45, 31, 20, 0.98), rgba(26, 19, 14, 0.98))',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(240, 200, 120, 0.2)',
                borderRadius: '8px',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
                padding: '8px 0',
                zIndex: 10000,
              }}
            >
              <div
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid rgba(240, 200, 120, 0.1)',
                }}
              >
                <p style={{ color: '#f0c878', fontSize: '14px', fontWeight: '500', margin: 0 }}>
                  {userName}
                </p>
              </div>
              <button
                onClick={() => {
                  window.electron?.openSettings();
                  setDropdownOpen(false);
                }}
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  background: 'transparent',
                  border: 'none',
                  color: 'rgba(240, 200, 120, 0.8)',
                  fontSize: '13px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'background 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(240, 200, 120, 0.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                Settings (TODO)
              </button>
            </div>
          )}
        </div>

        {/* Window controls (only in Electron) */}
        {isElectron && (
          <div
            style={{
              display: 'flex',
              alignItems: 'stretch',
              height: '56px',
              marginLeft: '8px',
            }}
          >
            <WindowControlButton onClick={handleMinimize} title="Minimize">
              <MinimizeIcon />
            </WindowControlButton>
            <WindowControlButton onClick={handleMaximize} title={isMaximized ? 'Restore' : 'Maximize'}>
              {isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
            </WindowControlButton>
            <WindowControlButton onClick={handleClose} title="Close" isClose>
              <CloseIcon />
            </WindowControlButton>
          </div>
        )}
      </div>
    </header>
  );
}

// Window control button component
function WindowControlButton({
  children,
  onClick,
  title,
  isClose = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  isClose?: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '46px',
        height: '100%',
        border: 'none',
        background: hovered
          ? isClose
            ? '#e81123'
            : 'rgba(240, 200, 120, 0.15)'
          : 'transparent',
        color: hovered && isClose ? '#fff' : 'rgba(240, 200, 120, 0.7)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background 0.15s ease, color 0.15s ease',
      }}
    >
      {children}
    </button>
  );
}

// Icon components (simple SVG icons)
function AdventureIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  );
}

function VillageIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 21h18" />
      <path d="M5 21V7l7-4 7 4v14" />
      <path d="M9 21v-6h6v6" />
    </svg>
  );
}

function BattlemapIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" />
      <path d="M3 15h18" />
      <path d="M9 3v18" />
      <path d="M15 3v18" />
    </svg>
  );
}

function CharacterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="5" />
      <path d="M20 21a8 8 0 1 0-16 0" />
    </svg>
  );
}

function GuideIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function AdminIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// Window control icons
function MinimizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
      <rect x="0" y="4.5" width="10" height="1" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
      <rect x="0.5" y="0.5" width="9" height="9" />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
      <rect x="0.5" y="2.5" width="7" height="7" />
      <path d="M2.5 2.5V0.5H9.5V7.5H7.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
      <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export default TironaHeader;
