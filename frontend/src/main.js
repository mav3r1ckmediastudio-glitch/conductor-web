import { mount } from 'svelte';
import './app.css';
import AppGate from './AppGate.svelte';

// Clerk was removed as the app-level access gate on 1 Jul 2026, after a
// long, ultimately unproductive debugging session on its custom OAuth
// redirect flow. Access control now happens one layer down, at Netlify's
// edge: netlify/edge-functions/basic-auth.js gates every request.
// That's the actual security boundary — nothing unauthenticated ever
// reaches this JS at all. AppGate.svelte is kept as the splash/entry
// screen (branding + a "continue" step, not real authentication).
mount(AppGate, {
  target: document.getElementById('app'),
});
