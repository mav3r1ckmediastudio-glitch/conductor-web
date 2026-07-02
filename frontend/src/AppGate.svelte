<script>
  import App from './App.svelte';
  import SplashLogin from './SplashLogin.svelte';
  import Toast from './Toast.svelte';
  import SessionConfirm from './SessionConfirm.svelte';

  // No real auth here — see main.js's comment. Basic Auth (frontend/public/
  // _headers) is the actual gate, enforced before this code ever loads.
  // `entered` just tracks whether the person has clicked through the splash
  // screen this session; it's UI state, not a security boundary.
  let entered = $state(false);
</script>

<Toast />
<SessionConfirm />

{#if !entered}
  <SplashLogin onContinue={() => entered = true} />
{:else}
  <App />
{/if}
