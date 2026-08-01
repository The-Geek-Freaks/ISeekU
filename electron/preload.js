const { contextBridge, ipcRenderer, webUtils } = require('electron');

/**
 * Listen on a push channel and hand back the unsubscribe.
 *
 * Returning the teardown matters more than it looks: a chat window that closes
 * without removing its listener leaves the handler attached, and the next
 * window on the same channel then fires every callback twice.
 */
function subscribe(channel, cb) {
  const handler = (_, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('api', {
  // WhatsApp
  wa: {
    getQR:       ()              => ipcRenderer.invoke('wa:get-qr'),
    getChats:    ()              => ipcRenderer.invoke('wa:get-chats'),
    getMessages: (chatId, opts)  => ipcRenderer.invoke('wa:get-messages', chatId, opts),
    sendMessage: (chatId, text, quotedMessageId)  => ipcRenderer.invoke('wa:send-message', chatId, text, quotedMessageId),
    sendFile:    (chatId, path)  => ipcRenderer.invoke('wa:send-file', chatId, path),
    sendSticker: (chatId, path)  => ipcRenderer.invoke('wa:send-sticker', chatId, path),
    sendVoice:   (chatId, base64, mime) => ipcRenderer.invoke('wa:send-voice', chatId, base64, mime),
    getParticipants: (chatId) => ipcRenderer.invoke('wa:get-participants', chatId),
    editMessage: (chatId, messageId, newText) => ipcRenderer.invoke('wa:edit-message', chatId, messageId, newText),
    deleteMessage: (chatId, messageId, forEveryone = true) => ipcRenderer.invoke('wa:delete-message', chatId, messageId, forEveryone),
    markRead:    (chatId)        => ipcRenderer.invoke('wa:mark-read', chatId),
    getStatus:   ()              => ipcRenderer.invoke('wa:status'),
    getMyProfile:()              => ipcRenderer.invoke('wa:get-my-profile'),
    getAvatar:   (id)            => ipcRenderer.invoke('wa:get-avatar', id),
    logout:      ()              => ipcRenderer.invoke('wa:logout'),
    reconnect:   ()              => ipcRenderer.invoke('wa:reconnect'),
    onQR:        (cb)            => ipcRenderer.on('wa:qr', (_, data) => cb(data)),
    onReady:     (cb)            => ipcRenderer.on('wa:ready', (_, data) => cb(data)),
    onMessage:   (cb)            => {
      const handler = (_, data) => cb(data);
      ipcRenderer.on('wa:message', handler);
      return () => ipcRenderer.removeListener('wa:message', handler);
    },
    onAvatar:    (cb)            => {
      const handler = (_, data) => cb(data);
      ipcRenderer.on('wa:avatar', handler);
      return () => ipcRenderer.removeListener('wa:avatar', handler);
    },
    onChatUpdate: (cb)            => {
      const handler = (_, data) => cb(data);
      ipcRenderer.on('wa:chat-update', handler);
      return () => ipcRenderer.removeListener('wa:chat-update', handler);
    },
    onMedia:     (cb)            => {
      const handler = (_, data) => cb(data);
      ipcRenderer.on('wa:media', handler);
      return () => ipcRenderer.removeListener('wa:media', handler);
    },
    showContactContext: (info) => ipcRenderer.invoke('show-contact-context', info),
    showMessageContext: (info) => ipcRenderer.invoke('show-message-context', info),
    onMessageContextAction: (cb) => {
      const handler = (_, d) => cb(d);
      ipcRenderer.on('message-context-action', handler);
      return () => ipcRenderer.removeListener('message-context-action', handler);
    },
    onAck:       (cb)            => {
      const handler = (_, data) => cb(data);
      ipcRenderer.on('wa:ack', handler);
      return () => ipcRenderer.removeListener('wa:ack', handler);
    },
    onTyping:    (cb)            => {
      const handler = (_, data) => cb(data);
      ipcRenderer.on('wa:typing', handler);
      return () => ipcRenderer.removeListener('wa:typing', handler);
    },
  },
  // Telegram
  tg: {
    requestCode:  (phone)            => ipcRenderer.invoke('tg:request-code', phone),
    signIn:       (phone, code, hash)=> ipcRenderer.invoke('tg:sign-in', phone, code, hash),
    startQRLogin: ()                 => ipcRenderer.invoke('tg:start-qr-login'),
    submit2FA:    (password)         => ipcRenderer.invoke('tg:2fa-password', password),
    getDialogs:   ()                 => ipcRenderer.invoke('tg:get-dialogs'),
    getMessages:  (chatId, opts)     => ipcRenderer.invoke('tg:get-messages', chatId, opts),
    sendMessage:  (chatId, text, quotedMessageId)     => ipcRenderer.invoke('tg:send-message', chatId, text, quotedMessageId),
    sendFile:     (chatId, path)     => ipcRenderer.invoke('tg:send-file', chatId, path),
    sendSticker:  (chatId, path)     => ipcRenderer.invoke('tg:send-sticker', chatId, path),
    sendVoice:    (chatId, base64, mime) => ipcRenderer.invoke('tg:send-voice', chatId, base64, mime),
    getParticipants: (chatId) => ipcRenderer.invoke('tg:get-participants', chatId),
    editMessage:  (chatId, messageId, newText) => ipcRenderer.invoke('tg:edit-message', chatId, messageId, newText),
    deleteMessage:(chatId, messageId, revoke = true) => ipcRenderer.invoke('tg:delete-message', chatId, messageId, revoke),
    getRecentStickers: (limit)       => ipcRenderer.invoke('tg:get-recent-stickers', limit),
    markRead:     (chatId)           => ipcRenderer.invoke('tg:mark-read', chatId),
    getStatus:    ()                 => ipcRenderer.invoke('tg:status'),
    getMe:        ()                 => ipcRenderer.invoke('tg:get-me'),
    getAvatar:    (id)               => ipcRenderer.invoke('tg:get-avatar', id),
    logout:       ()                 => ipcRenderer.invoke('tg:logout'),
    setCredentials: (id, hash)       => ipcRenderer.invoke('tg:set-credentials', id, hash),
    onMessage:    (cb)               => {
      const handler = (_, d) => cb(d);
      ipcRenderer.on('tg:message', handler);
      return () => ipcRenderer.removeListener('tg:message', handler);
    },
    onAvatar:     (cb)               => {
      const handler = (_, d) => cb(d);
      ipcRenderer.on('tg:avatar', handler);
      return () => ipcRenderer.removeListener('tg:avatar', handler);
    },
    onChatUpdate: (cb)               => {
      const handler = (_, d) => cb(d);
      ipcRenderer.on('tg:chat-update', handler);
      return () => ipcRenderer.removeListener('tg:chat-update', handler);
    },
    onQR:         (cb)               => ipcRenderer.on('tg:qr',       (_, d) => cb(d)),
    onReady:      (cb)               => ipcRenderer.on('tg:ready',    (_, d) => cb(d)),
    on2FANeeded:  (cb)               => ipcRenderer.on('tg:2fa-needed',(_, d) => cb(d)),
  },
  // ICQ — the native account, over XMPP.
  //
  // Note what is deliberately absent: there is no getPassword. The password
  // travels renderer -> main once, at connect, and never comes back. Storing
  // and decrypting it is the main process's business alone (ADR 0002).
  icq: {
    connect:      (options)          => ipcRenderer.invoke('icq:connect', options),
    disconnect:   ()                 => ipcRenderer.invoke('icq:disconnect'),
    register:     (options)          => ipcRenderer.invoke('icq:register', options),
    registrationFields: (options)    => ipcRenderer.invoke('icq:registration-fields', options),
    getStatus:    ()                 => ipcRenderer.invoke('icq:status'),
    getContacts:  ()                 => ipcRenderer.invoke('icq:get-contacts'),
    getChats:     ()                 => ipcRenderer.invoke('icq:get-chats'),
    getMessages:  (jid, opts)        => ipcRenderer.invoke('icq:get-messages', jid, opts),
    sendMessage:  (jid, body)        => ipcRenderer.invoke('icq:send-message', jid, body),
    sendTyping:   (jid, isTyping)    => ipcRenderer.invoke('icq:send-typing', jid, isTyping),
    markRead:     (jid)              => ipcRenderer.invoke('icq:mark-read', jid),
    setStatus:    (status, text)     => ipcRenderer.invoke('icq:set-status', status, text),
    setAwayMessage: (text)           => ipcRenderer.invoke('icq:set-away-message', text),
    addContact:   (uin, nick, group) => ipcRenderer.invoke('icq:add-contact', uin, nick, group),
    removeContact:(jid)              => ipcRenderer.invoke('icq:remove-contact', jid),
    answerAuthorization: (jid, granted, reason) => ipcRenderer.invoke('icq:answer-authorization', jid, granted, reason),
    setAlert:     (jid, on)          => ipcRenderer.invoke('icq:set-alert', jid, on),
    searchHistory:(query, opts)      => ipcRenderer.invoke('icq:search-history', query, opts),
    serverFeatures: ()               => ipcRenderer.invoke('icq:server-features'),
    // Themes the Owner installed. Validated in the main process before they
    // get here — see electron/lib/icq-theme.js.
    getThemes:    ()                 => ipcRenderer.invoke('icq:get-themes'),
    openThemesFolder: ()             => ipcRenderer.invoke('icq:open-themes-dir'),
    // Every listener returns its own unsubscribe, so a chat window that closes
    // does not leave a handler behind for the next one to double-fire on.
    onReady:      (cb) => subscribe('icq:ready', cb),
    onStatusChanged: (cb) => subscribe('icq:status-changed', cb),
    onMessage:    (cb) => subscribe('icq:message', cb),
    onPresence:   (cb) => subscribe('icq:presence', cb),
    onTyping:     (cb) => subscribe('icq:typing', cb),
    onAck:        (cb) => subscribe('icq:ack', cb),
    onContacts:   (cb) => subscribe('icq:contacts', cb),
    onAlert:      (cb) => subscribe('icq:alert', cb),
    onAuthorizationRequest: (cb) => subscribe('icq:authorization-request', cb),
    onAuthorizationAnswer:  (cb) => subscribe('icq:authorization-answer', cb),
    onInsecure:   (cb) => subscribe('icq:insecure', cb),
    onError:      (cb) => subscribe('icq:error', cb),
  },
  // Chat windows
  openChat: (params) => ipcRenderer.invoke('open-chat', params),
  getStoredAvatar: (id) => ipcRenderer.invoke('get-stored-avatar', id),
  notifySent: (msg) => ipcRenderer.send('chat:sent', msg),
  notifyRead: (msg) => ipcRenderer.send('chat:read', msg),
  onSent: (cb) => {
    const handler = (_, d) => cb(d);
    ipcRenderer.on('chat:sent-broadcast', handler);
    return () => ipcRenderer.removeListener('chat:sent-broadcast', handler);
  },
  onRead: (cb) => {
    const handler = (_, d) => cb(d);
    ipcRenderer.on('chat:read-broadcast', handler);
    return () => ipcRenderer.removeListener('chat:read-broadcast', handler);
  },
  // Native context menu helpers (top-level for convenience)
  showContactContext: (info) => ipcRenderer.invoke('show-contact-context', info),
  showMessageContext: (info) => ipcRenderer.invoke('show-message-context', info),
  onMessageContextAction: (cb) => {
    const handler = (_, d) => cb(d);
    ipcRenderer.on('message-context-action', handler);
    return () => ipcRenderer.removeListener('message-context-action', handler);
  },
  // Window controls
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close:    () => ipcRenderer.send('window:close'),
  },
  openExternal: (url) => ipcRenderer.send('open-external', url),
  openGame: (url, title) => ipcRenderer.invoke('open-game', url, title),
  // Skins — broadcast a chosen skin to every other window so all
  // open chat windows + the contact list re-theme together.
  setSkin: (id) => ipcRenderer.send('skin:set', id),
  onSkinChange: (cb) => {
    const handler = (_, id) => cb(id);
    ipcRenderer.on('skin:changed', handler);
    return () => ipcRenderer.removeListener('skin:changed', handler);
  },
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  saveTempImage: (base64, ext) => ipcRenderer.invoke('app:save-temp-image', base64, ext),
  readFileDataUrl: (filePath) => ipcRenderer.invoke('app:read-file-dataurl', filePath),
  setStoredAvatar: (id, dataUrl) => ipcRenderer.invoke('set-stored-avatar', id, dataUrl),
  setStoredParticipants: (chatId, participants) => ipcRenderer.invoke('set-stored-participants', chatId, participants),
  getStoredParticipants: (chatId) => ipcRenderer.invoke('get-stored-participants', chatId),
  appVersion: process.env.npm_package_version || require('../package.json').version,
  // Get real file system path from a dropped File object (Electron 29+)
  getFilePath: (file) => {
    try { return webUtils.getPathForFile(file); } catch (e) { return file?.path || null; }
  },
});
