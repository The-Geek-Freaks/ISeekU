import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import './themes.css';
// The ICQ 5.1 skin is more than a palette — 16px rows, Win32 bevels and the
// absence of rounded corners cannot be expressed as CSS variables, so it ships
// as a stylesheet keyed off the data-skin attribute applySkin() sets.
import './skins/icq5.css';
import App from './App';
import ChatApp from './ChatApp';
import { applySavedSkin, applySkin } from './skins';

// Apply the saved skin before first paint so every window (contact list
// + each chat window) opens already wearing the right theme — no flash.
applySavedSkin();
// Live-sync skin changes made in any other window.
window.api?.onSkinChange?.((id) => applySkin(id));

const root = ReactDOM.createRoot(document.getElementById('root'));
const params = new URLSearchParams(window.location.search);

if (params.get('mode') === 'chat') {
  root.render(
    <React.StrictMode>
      <ChatApp
        chatId={params.get('chatId')}
        chatName={params.get('chatName')}
        service={params.get('service')}
        isGroup={params.get('isGroup') === '1'}
      />
    </React.StrictMode>
  );
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
