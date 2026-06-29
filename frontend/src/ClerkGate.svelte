<script>
  import { onMount } from 'svelte';
  import App from './App.svelte';
  import SplashLogin from './SplashLogin.svelte';

  let { clerk } = $props();

  let user = $state(null);
  let ready = $state(false);
  let menuOpen = $state(false);

  onMount(() => {
    user = clerk.user ?? null;
    ready = true;

    const unsub = clerk.addListener(({ user: u }) => {
      user = u ?? null;
    });

    return unsub;
  });

  function signOut() {
    menuOpen = false;
    clerk.signOut();
  }
</script>

{#if !ready}
  <div style="position:fixed;inset:0;background:#060a12;"></div>
{:else if user}
  <App {clerk} />

  <!-- Floating user badge — top right, above app UI -->
  <div class="user-badge">
    <button class="avatar" onclick={() => menuOpen = !menuOpen} title="Account">
      {(user.firstName?.[0] ?? user.emailAddresses?.[0]?.emailAddress?.[0] ?? '?').toUpperCase()}
    </button>

    {#if menuOpen}
      <div class="menu">
        <p class="email">{user.emailAddresses?.[0]?.emailAddress ?? ''}</p>
        <hr />
        <button class="signout" onclick={signOut}>Sign out</button>
      </div>
    {/if}
  </div>
{:else}
  <SplashLogin {clerk} />
{/if}

<style>
  .user-badge {
    position: fixed;
    top: 12px;
    right: 14px;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    font-family: 'Inter', ui-sans-serif, sans-serif;
  }

  .avatar {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: rgba(77, 200, 255, 0.15);
    border: 1px solid rgba(77, 200, 255, 0.35);
    color: #4dc8ff;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, border-color 0.15s;
  }

  .avatar:hover {
    background: rgba(77, 200, 255, 0.25);
    border-color: rgba(77, 200, 255, 0.6);
  }

  .menu {
    margin-top: 6px;
    background: rgba(8, 14, 28, 0.95);
    border: 1px solid rgba(77, 200, 255, 0.2);
    border-radius: 10px;
    padding: 10px 14px;
    min-width: 200px;
    backdrop-filter: blur(16px);
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  }

  .email {
    font-size: 11px;
    color: rgba(255,255,255,0.45);
    margin: 0 0 8px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  hr {
    border: none;
    border-top: 1px solid rgba(77, 200, 255, 0.12);
    margin: 0 0 8px;
  }

  .signout {
    width: 100%;
    padding: 7px 10px;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 7px;
    color: rgba(255,255,255,0.75);
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s, color 0.15s;
  }

  .signout:hover {
    background: rgba(255, 80, 80, 0.12);
    border-color: rgba(255, 80, 80, 0.3);
    color: #ff9090;
  }
</style>
