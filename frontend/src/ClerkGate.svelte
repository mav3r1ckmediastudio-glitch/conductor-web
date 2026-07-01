<script>
  import { onMount } from 'svelte';
  import App from './App.svelte';
  import SplashLogin from './SplashLogin.svelte';
  import Toast from './Toast.svelte';

  let { clerk } = $props();

  let user = $state(null);
  let ready = $state(false);

  onMount(() => {
    user = clerk.user ?? null;
    ready = true;

    const unsub = clerk.addListener(({ user: u }) => {
      user = u ?? null;
    });

    return unsub;
  });
</script>

<Toast />

{#if !ready}
  <div style="position:fixed;inset:0;background:#060a12;"></div>
{:else if user}
  <App {clerk} {user} />
{:else}
  <SplashLogin {clerk} />
{/if}
