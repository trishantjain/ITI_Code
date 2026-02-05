import React from 'react';
import './PasswordPrompt.css';

const PasswordPrompt = ({ onSubmit, onCancel }) => {
  const [password, setPassword] = React.useState('');

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      onSubmit(password);
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div className="password-modal-overlay">
      <div className="password-modal">
        <h3>🔒 Enter Admin Password</h3>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Admin password"
        />
        <div className="password-modal-buttons">
          <button onClick={() => onSubmit(password)}>✅ Confirm</button>
          <button onClick={onCancel}>❌ Cancel</button>
        </div>
      </div>
    </div>
  );
};

export default PasswordPrompt;
