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
const isCallback = [...params.keys()].some((k) => k.startsWith('__clerk'));

if (isCallback) {
  try {
    await clerk.handleRedirectCallback();
  } catch (e) {
    console.error('Clerk callback error:', e);
    // Fires before any UI exists yet — toast.js buffers this and shows it
    // the moment Toast.svelte mounts inside App.svelte, a few lines below.
    showError('Sign-in could not be completed: ' + (e?.message || e) + '. Please try signing in again.');
  }
  // Remove Clerk params from the URL without reloading
  window.history.replaceState({}, '', window.location.pathname);
}

mount(ClerkGate, {
  target: document.getElementById('app'),
  props: { clerk },
});
