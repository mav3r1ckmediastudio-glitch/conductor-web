// sessionConfirm.js — Save/Cancel confirmation for ending a continuous tool
// session (see startToolSession() in mapTools.js). Mirrors toast.js's
// plain-JS <-> Svelte pub/sub pattern, but request/response rather than
// fire-and-forget, since the caller (mapTools.js, on RMB) needs to know
// which button was pressed before it can end the session.
//
// Usage:
//   import { requestSessionConfirm } from './sessionConfirm.js';
//   const result = await requestSessionConfirm();   // 'save' | 'cancel'

let _listener = null; // set by SessionConfirm.svelte when mounted

// fn: (message: string) => Promise<'save'|'cancel'>
export function onSessionConfirmRequest(fn) {
  _listener = fn;
  return () => { if (_listener === fn) _listener = null; };
}

export function requestSessionConfirm(message) {
  if (!_listener) {
    // No popup UI mounted to ask (shouldn't normally happen — SessionConfirm
    // is mounted once at app root). Fail safe to Save rather than silently
    // discarding whatever the user placed/edited this session.
    return Promise.resolve('save');
  }
  return _listener(
    message || 'End this session? Save keeps everything done since you started; Cancel undoes it all.'
  );
}
