<script>
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

  let projectName = '';
  let countryCode = 'SCOT';
  let buildCode = '';
  let error = '';

  function buildCodeInput(e) {
    buildCode = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  }

  $: areaId = countryCode && buildCode ? `${countryCode}-${buildCode}` : '';

  function create() {
    if (!projectName.trim()) { error = 'Project name is required.'; return; }
    if (!buildCode || buildCode.length < 2) { error = 'Build code must be 2–6 characters.'; return; }
    error = '';
    dispatch('create', {
      name: projectName.trim(),
      countryCode,
      buildCode,
      areaId,
    });
  }
</script>

<div class="overlay">
  <div class="modal">
    <div class="modal-hdr">
      <div class="logo">CONDUCTOR</div>
      <div class="logo-sub">FTTP DESIGN INTELLIGENCE</div>
    </div>

    <div class="modal-body">
      <div class="section-lbl">NEW PROJECT</div>

      <div class="field">
        <label>Project Name *</label>
        <input bind:value={projectName} placeholder="e.g. Tyndrum Rural FTTP" />
      </div>

      <div class="field">
        <label>Country *</label>
        <select bind:value={countryCode}>
          <option value="SCOT">Scotland</option>
          <option value="ENG">England</option>
          <option value="WAL">Wales</option>
          <option value="NIR">Northern Ireland</option>
        </select>
      </div>

      <div class="field">
        <label>Build Area Code * <span class="hint">2–6 chars, used in all asset IDs</span></label>
        <input value={buildCode} on:input={buildCodeInput} placeholder="e.g. TTY" maxlength="6" />
      </div>

      {#if areaId}
        <div class="preview">
          Asset IDs will use: <span class="preview-id">{areaId}-DUCT-001, {areaId}-CMBR-0001…</span>
        </div>
      {/if}

      {#if error}
        <div class="error">{error}</div>
      {/if}
    </div>

    <div class="modal-footer">
      <button class="btn-create" on:click={create}>Create Project →</button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed; inset: 0;
    background: #0a0f14ee;
    display: flex; align-items: center; justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(4px);
  }

  .modal {
    width: 480px;
    background: #0d1520;
    border: 1px solid #1a2d40;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 0 60px #00aaff11;
  }

  .modal-hdr {
    padding: 28px 28px 20px;
    border-bottom: 1px solid #1a2d40;
    text-align: center;
  }
  .logo { color: #4dc8ff; font-size: 22px; font-weight: 700; letter-spacing: 0.2em; text-shadow: 0 0 20px #00aaff66; font-family: 'Courier New', monospace; }
  .logo-sub { color: #3a5a70; font-size: 9px; letter-spacing: 0.2em; margin-top: 4px; font-family: 'Courier New', monospace; }

  .modal-body { padding: 20px 28px; display: flex; flex-direction: column; gap: 12px; }

  .section-lbl { font-size: 8px; color: #3a5a70; letter-spacing: 0.16em; text-transform: uppercase; margin-bottom: 4px; font-family: 'Courier New', monospace; }

  .field { display: flex; flex-direction: column; gap: 4px; }
  .field label { font-size: 8px; color: #6a8fa8; letter-spacing: 0.08em; text-transform: uppercase; font-family: 'Courier New', monospace; }
  .hint { color: #2a4050; font-size: 7px; }
  .field input, .field select {
    background: #080e14; border: 1px solid #1a2d40; color: #a0c4d8;
    font-family: 'Courier New', monospace; font-size: 11px;
    padding: 8px 10px; border-radius: 4px; outline: none;
    width: 100%; box-sizing: border-box;
  }
  .field input:focus, .field select:focus { border-color: #00aaff44; color: #4dc8ff; }
  .field input::placeholder { color: #2a4050; }

  .preview { font-size: 9px; color: #3a5a70; font-family: 'Courier New', monospace; padding: 8px 10px; background: #080e14; border-radius: 4px; border: 1px solid #1a2d40; }
  .preview-id { color: #4dc8ff; }

  .error { font-size: 9px; color: #ff5555; font-family: 'Courier New', monospace; }

  .modal-footer { padding: 16px 28px 24px; border-top: 1px solid #1a2d40; }
  .btn-create {
    width: 100%; padding: 12px;
    background: #00aaff14; border: 1px solid #00aaff44; color: #4dc8ff;
    font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase;
    border-radius: 4px; cursor: pointer;
  }
  .btn-create:hover { background: #00aaff22; box-shadow: 0 0 20px #00aaff11; }
</style>
