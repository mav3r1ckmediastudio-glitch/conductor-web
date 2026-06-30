// toast.test.js — Regression suite for the toast notification system itself.
//
// The buffering behaviour added tonight (toast.js) is genuinely new logic, not
// just wiring — it exists specifically to fix a real gap: a few call sites
// (projectStore.js's initial load, main.js's Clerk OAuth callback) fire before
// any UI has mounted, so there's no listener yet to show anything. Worth a
// direct test rather than trusting it by inspection, same as everything else
// tonight.
//
// Run with: npm test

import { describe, it, expect, beforeEach, vi } from 'vitest';

// toast.js holds module-level state (_listeners, _pending), so each test needs
// a fresh module instance — vi.resetModules() + dynamic import gives us that.
beforeEach(() => {
  vi.resetModules();
});

describe('toast.js — normal case, a listener already exists', () => {
  it('delivers a toast immediately to an already-subscribed listener', async () => {
    const { onToast, showToast } = await import('../toast.js');
    const received = [];
    onToast((t) => received.push(t));

    showToast('hello');

    expect(received).toHaveLength(1);
    expect(received[0].message).toBe('hello');
  });
});

describe('toast.js — buffering when no listener exists yet', () => {
  it('does not lose a toast fired before any listener has subscribed', async () => {
    const { onToast, showToast } = await import('../toast.js');

    // Fire BEFORE anyone is listening — this is the boot-time / pre-mount case.
    showToast('fired before mount');

    const received = [];
    onToast((t) => received.push(t));

    // The buffered toast should flush to this listener immediately on subscribe.
    expect(received).toHaveLength(1);
    expect(received[0].message).toBe('fired before mount');
  });

  it('buffers multiple pre-mount toasts in order and flushes all of them', async () => {
    const { onToast, showToast } = await import('../toast.js');

    showToast('first');
    showToast('second');
    showToast('third');

    const received = [];
    onToast((t) => received.push(t));

    expect(received.map(t => t.message)).toEqual(['first', 'second', 'third']);
  });

  it('only flushes the buffer once — a second listener does not get stale toasts replayed', async () => {
    const { onToast, showToast } = await import('../toast.js');

    showToast('only-once');

    const firstListenerReceived = [];
    onToast((t) => firstListenerReceived.push(t));
    expect(firstListenerReceived).toHaveLength(1);

    // A second listener subscribing later should NOT also receive the
    // already-flushed toast — otherwise every new component mount would
    // replay old notifications.
    const secondListenerReceived = [];
    onToast((t) => secondListenerReceived.push(t));
    expect(secondListenerReceived).toHaveLength(0);
  });
});

describe('toast.js — showError sets the right type and longer duration', () => {
  it('marks the toast as type "error" with an 8000ms duration', async () => {
    const { onToast, showError } = await import('../toast.js');
    const received = [];
    onToast((t) => received.push(t));

    showError('something failed');

    expect(received[0].type).toBe('error');
    expect(received[0].duration).toBe(8000);
  });
});

describe('toast.js — unsubscribe', () => {
  it('the function returned by onToast stops further delivery to that listener', async () => {
    const { onToast, showToast } = await import('../toast.js');
    const received = [];
    const unsubscribe = onToast((t) => received.push(t));

    showToast('one');
    unsubscribe();
    showToast('two');

    expect(received).toHaveLength(1);
    expect(received[0].message).toBe('one');
  });
});
