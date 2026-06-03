import React from 'react';

const labels = {
  home:     'Холл',
  play:     'ПВП',
  shop:     'МАГАЗИН',
  clans:    'КЛАНЫ',
  profile:  'ПРОФИЛЬ'
};

// SVG-глифы вместо эмодзи — гравюрная эстетика
function Icon({ name }) {
  if (name === 'home') {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 11.2 12 3l9 8.2" />
        <path d="M5 10v10h14V10" />
        <path d="M10 20v-6h4v6" />
      </svg>
    );
  }
  if (name === 'play') {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <circle cx="12" cy="12" r="3.4" />
        <circle cx="12" cy="12" r="1" fill="currentColor" />
      </svg>
    );
  }
  if (name === 'shop') {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 8h16l-1.4 11.2A2 2 0 0 1 16.6 21H7.4a2 2 0 0 1-2-1.8L4 8Z" />
        <path d="M8 8V6a4 4 0 0 1 8 0v2" />
      </svg>
    );
  }
  if (name === 'clans') {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 21V8l7-4 7 4v13" />
        <path d="M9 21v-6h6v6" />
        <path d="M5 11h14" />
      </svg>
    );
  }
  if (name === 'profile') {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="10" r="3" />
        <path d="M6.4 19.2c.8-2.6 3-4.2 5.6-4.2s4.8 1.6 5.6 4.2" />
      </svg>
    );
  }
  return null;
}

export default function BottomBar({ items, tab, onTabChange }) {
  return (
    <nav className="bottom-bar">
      {items.map((id) => (
        <button
          key={id}
          onClick={() => onTabChange(id)}
          className={`bottom-item ${tab === id ? 'active' : ''}`}
        >
          <span className="bottom-icon"><Icon name={id} /></span>
          <span>{labels[id]}</span>
        </button>
      ))}
    </nav>
  );
}
