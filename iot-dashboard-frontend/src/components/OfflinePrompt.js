// src/components/OfflinePrompt.js
import React from 'react';
import './OfflinePrompt.css'; // optional styling

const OfflinePrompt = ({ show }) => {
  if (!show) return null;

  return (
    <div className="offline-overlay">
      <div className="offline-box">
        <h2>🚫 You're Offline</h2>
        <p>Please check your internet or server connection.</p>
      </div>
    </div>
  );
};

export default OfflinePrompt;
