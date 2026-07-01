import { mount } from 'svelte';
import './app.css';
import ClerkGate from './ClerkGate.svelte';
import { Clerk } from '@clerk/clerk-js';
import { showError } from './toast.js';

const clerk = new Clerk(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

await clerk.load({ navigate: () => {} });

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
    console.error('Clerk callback error:', e);
    // Fires before any UI exists yet — Toast now lives in ClerkGate (mounted
    // unconditionally, regardless of auth state) so this reliably surfaces
    // instead of being buffered forever behind a splash screen that never
    // mounts App.svelte. console.error above is a belt-and-braces fallback
    // in case that assumption ever breaks again.
    showError('Sign-in could not be completed: ' + (e?.message || e) + '. Please try signing in again.');
  }
  // Remove Clerk params from the URL without reloading
  window.history.replaceState({}, '', window.location.pathname);
}

mount(ClerkGate, {
  target: document.getElementById('app'),
  props: { clerk },
});
