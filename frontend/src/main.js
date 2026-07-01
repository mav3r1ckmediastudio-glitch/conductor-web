import { mount } from 'svelte';
import './app.css';
import ClerkGate from './ClerkGate.svelte';
import { Clerk } from '@clerk/clerk-js';
import { showError } from './toast.js';

const clerk = new Clerk(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

// IMPORTANT: this was previously `navigate: () => {}` — a no-op. Clerk's
// redirect-based flows (including the OAuth dev-instance handshake hop
// through accounts.dev) call navigate() to actually move the browser to
// wherever it needs to go next. A no-op means Clerk *thinks* it navigated
// and proceeds as if the flow continued, but the browser never goes
// anywhere — so the flow dies silently with no error, no thrown
// exception, and no callback params ever landing back on this app. This
// matches every symptom seen in the OAuth sign-in investigation: Google
// completes fine, Clerk's own APIs return 200, but __client_uat stays 0
// and clerk.client.signIn stays at its default 'needs_identifier' state
// even after a full round-trip — because the round-trip's later hops
// were silently no-op'd by this stub.
await clerk.load({
  navigate: (to) => {
    window.location.href = to;
    return Promise.resolve();
  },
});

// Only process the OAuth callback when Clerk's handshake params are
// actually in the URL — otherwise normal loads would re-trigger it
// and loop. After processing, strip the params so a refresh is clean.
const params = new URLSearchParams(window.location.search);
const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
const isCallback =
  [...params.keys()].some((k) => k.startsWith('__clerk')) ||
  [...hashParams.keys()].some((k) => k.startsWith('__clerk'));

// TEMP DEBUG — remove once the silent-sign-in-failure is diagnosed.
console.log('[clerk-debug] full URL on load:', window.location.href);
console.log('[clerk-debug] search params:', [...params.entries()]);
console.log('[clerk-debug] hash params:', [...hashParams.entries()]);
console.log('[clerk-debug] isCallback:', isCallback);
// Check unconditionally — the Client object may already reflect a
// pending/completed sign-in attempt via cookies even if we never
// detected callback params in the URL at all.
console.log('[clerk-debug] clerk.client.signIn (unconditional):', clerk.client?.signIn);
console.log('[clerk-debug] clerk.client.signUp (unconditional):', clerk.client?.signUp);
console.log('[clerk-debug] clerk.user (unconditional):', clerk.user);
console.log('[clerk-debug] clerk.session (unconditional):', clerk.session);

if (isCallback) {
  try {
    const result = await clerk.handleRedirectCallback();
    console.log('[clerk-debug] handleRedirectCallback resolved:', result);
    console.log('[clerk-debug] clerk.user after callback:', clerk.user);
    console.log('[clerk-debug] clerk.session after callback:', clerk.session);
    console.log('[clerk-debug] signIn.status:', clerk.client?.signIn?.status);
    console.log('[clerk-debug] signIn full object:', clerk.client?.signIn);
  } catch (e) {
    console.error('[clerk-debug] handleRedirectCallback threw:', e, JSON.stringify(e?.errors));
    // signIn.authenticateWithRedirect() was called with transferable: false
    // (see SplashLogin.svelte) specifically so a "no matching account" OAuth
    // sign-in doesn't get silently, opaquely converted into a sign-up by
    // Clerk internally. With that flag set, the actual "no account" error
    // does NOT throw from the outbound authenticateWithRedirect() call — it
    // throws HERE, from handleRedirectCallback(), after the browser has
    // already been to Google and come back. (An earlier version of this
    // fix put the try/catch around the outbound call instead, in
    // SplashLogin.svelte — that catch could never fire, since
    // authenticateWithRedirect()'s job is just to start the navigation to
    // Google; the account-transfer outcome isn't known until this point.)
    // Per Clerk's own docs, the relevant error codes here are
    // external_account_not_found and account_transfer_invalid — both mean
    // "this Google account has no matching Clerk user", not a real failure.
    const code = e?.errors?.[0]?.code;
    const isNoAccount = code === 'external_account_not_found' || code === 'account_transfer_invalid';
    if (isNoAccount) {
      console.log('[clerk-debug] no matching account — falling through to sign-up:', code);
      try {
        await clerk.client.signUp.authenticateWithRedirect({
          strategy: 'oauth_google',
          redirectUrl: window.location.origin,
          redirectUrlComplete: window.location.origin,
        });
        // Page navigates to Google again — nothing after this line runs
        // until the browser comes back with a fresh callback.
      } catch (e2) {
        console.error('[clerk-debug] signUp.authenticateWithRedirect threw:', e2, JSON.stringify(e2?.errors));
        showError('Sign-up could not be started: ' + (e2?.message || e2) + '. Please try again.');
      }
    } else {
      showError('Sign-in could not be completed: ' + (e?.message || e) + '. Please try signing in again.');
    }
  }
  // Remove Clerk params from the URL without reloading
  window.history.replaceState({}, '', window.location.pathname);
}

mount(ClerkGate, {
  target: document.getElementById('app'),
  props: { clerk },
});
