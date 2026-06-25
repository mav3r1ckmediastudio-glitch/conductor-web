<script>
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

  export let pending = null;  // { lng, lat, pop_id, area_id }

  // Identity
  let popName = '';
  let popType = 'CABINET';
  let operator = 'Gigaloch';
  let status = 'PROPOSED';

  // Location
  let address = '';
  let postcode = '';
  let powerSupply = '';
  let leaseExpiry = '';

  // Calix equipment — installed
  let duxShelves = 1;
  let calixShelves = 0;
  let gponCards = 0;
  let gponOptics = 0;
  let batterySets = 1;
  let patchPanels = 0;
  let hasAggregRouter = false;

  // Notes / misc
  let photoRef = '';
  let notes = '';

  $: maxCustomers = gponOptics * 32;

  function onCalixChange() {
    if (gponCards > calixShelves * 2) gponCards = calixShelves * 2;
  }
  function onCardsChange() {
    if (gponOptics > gponCards * 8) gponOptics = gponCards * 8;
  }

  function save() {
    if (!popName.trim()) { alert('Site Name is required.'); return; }

    if (status === 'ACTIVE' && gponOptics === 0) {
      if (!confirm('Status is ACTIVE but no GPON optics recorded. Save anyway?')) return;
    }

    dispatch('save', {
      lng: pending.lng, lat: pending.lat,
      pop_id: pending.pop_id, area_id: pending.area_id,
      pop_name: popName.trim(),
      pop_type: popType,
      operator: operator.trim(),
      status,
      address: address.trim(),
      postcode: postcode.trim().toUpperCase(),
      power_supply: powerSupply,
      lease_expiry: leaseExpiry.trim(),
      dux_shelves: duxShelves,
      calix_shelves: calixShelves,
      gpon_cards: gponCards,
      gpon_optics: gponOptics,
      battery_sets: batterySets,
      patch_panels: patchPanels,
      has_aggreg_router: hasAggregRouter,
      max_customers: maxCustomers,
      photo_ref: photoRef.trim(),
      notes: notes.trim(),
    });
    reset();
  }

  function cancel() { dispatch('cancel'); reset(); }

  function reset() {
    popName = ''; popType = 'CABINET'; operator = 'Gigaloch'; status = 'PROPOSED';
    address = ''; postcode = ''; powerSupply = ''; leaseExpiry = '';
    duxShelves = 1; calixShelves = 0; gponCards = 0; gponOptics = 0;
    batterySets = 1; patchPanels = 0; hasAggregRouter = false;
    photoRef = ''; notes = '';
  }
</script>

{#if pending}
<div class="form">
  <div class="form-hdr">
    <span class="form-title">Place Cabinet / POP</span>
    <span class="form-id">{pending.pop_id}</span>
  </div>
  <div class="form-coords">{pending.lng.toFixed(5)}, {pending.lat.toFixed(5)}</div>

  <div class="form-body">

    <!-- IDENTITY -->
    <div class="section-lbl">IDENTITY</div>

    <div class="field">
      <label>Site Name *</label>
      <input bind:value={popName} placeholder="e.g. Tyndrum Cabinet 1" />
    </div>
    <div class="field">
      <label>POP Type</label>
      <select bind:value={popType}>
        <option>CABINET</option>
        <option>EXCHANGE</option>
        <option>DATACENTRE</option>
        <option>ROOFTOP</option>
      </select>
    </div>
    <div class="field">
      <label>Operator</label>
      <input bind:value={operator} />
    </div>
    <div class="field">
      <label>Status</label>
      <select bind:value={status}>
        <option>PROPOSED</option>
        <option>SURVEY</option>
        <option>ACTIVE</option>
        <option>DECOMMISSIONED</option>
      </select>
    </div>

    <div class="divider"></div>

    <!-- LOCATION -->
    <div class="section-lbl">LOCATION</div>

    <div class="field">
      <label>Address</label>
      <input bind:value={address} placeholder="Street address (optional)" />
    </div>
    <div class="field">
      <label>Postcode</label>
      <input bind:value={postcode} placeholder="e.g. FK20 8RU" maxlength="8" />
    </div>
    <div class="field">
      <label>Power Supply</label>
      <select bind:value={powerSupply}>
        <option value="">— not yet set —</option>
        <option>MAINS</option>
        <option>GENERATOR</option>
        <option>UPS</option>
        <option>SOLAR</option>
      </select>
    </div>
    <div class="field">
      <label>Lease Expiry</label>
      <input bind:value={leaseExpiry} placeholder="e.g. 2030-03-31 (optional)" />
    </div>

    <div class="divider"></div>

    <!-- CALIX EQUIPMENT -->
    <div class="section-lbl">CALIX EQUIPMENT</div>
    <div class="equip-note">Leave at 0 if not yet ordered — update later.</div>

    <div class="equip-grid">
      <span class="eg-hdr">Item</span>
      <span class="eg-hdr" style="text-align:center;">Qty</span>
      <span class="eg-hdr" style="text-align:right;">Max</span>

      <span class="eg-lbl">DU-X Rectifier Shelf</span>
      <input class="eg-num" type="number" bind:value={duxShelves} min="0" max="2" />
      <span class="eg-max">max 2</span>

      <span class="eg-lbl">Calix E7-2 Shelves</span>
      <input class="eg-num" type="number" bind:value={calixShelves} min="0" max="2"
        on:change={onCalixChange} />
      <span class="eg-max">max 2</span>

      <span class="eg-lbl">GPON Cards</span>
      <input class="eg-num" type="number" bind:value={gponCards} min="0" max="4"
        on:change={onCardsChange} />
      <span class="eg-max">max 4</span>

      <span class="eg-lbl">GPON Optics</span>
      <input class="eg-num" type="number" bind:value={gponOptics} min="0" max="32" />
      <span class="eg-max">max 32</span>

      <span class="eg-lbl">Battery Sets</span>
      <input class="eg-num" type="number" bind:value={batterySets} min="0" max="4" />
      <span class="eg-max">max 4</span>

      <span class="eg-lbl">Patch Panels</span>
      <input class="eg-num" type="number" bind:value={patchPanels} min="0" max="16" />
      <span class="eg-max">max 16</span>
    </div>

    <div class="calc-row">
      <span class="calc-lbl">Max customers (installed optics)</span>
      <span class="calc-val">{maxCustomers}</span>
    </div>

    <div class="check-row">
      <input type="checkbox" bind:checked={hasAggregRouter} id="aggr" />
      <label for="aggr" style="font-size:9px;color:#6a8fa8;cursor:pointer;">Aggregation router present</label>
    </div>

    <div class="divider"></div>

    <!-- NOTES -->
    <div class="section-lbl">NOTES & REFS</div>

    <div class="field">
      <label>Photo Reference</label>
      <input bind:value={photoRef} placeholder="Photo filename or URL (optional)" />
    </div>
    <div class="field">
      <label>Notes</label>
      <input bind:value={notes} placeholder="Equipment orders, site access, survey findings…" />
    </div>

  </div>

  <div class="form-actions">
    <button class="btn-cancel" on:click={cancel}>Cancel</button>
    <button class="btn-save" on:click={save}>Place Cabinet</button>
  </div>
</div>
{/if}

<style>
  .form { display: flex; flex-direction: column; height: 100%; background: #0d1520; }

  .form-hdr { padding: 12px 14px 6px; border-bottom: 1px solid #1a2d40; display: flex; justify-content: space-between; align-items: baseline; flex-shrink: 0; }
  .form-title { font-size: 9px; color: #a0c4d8; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 600; }
  .form-id { font-size: 12px; color: #4dc8ff; font-weight: 700; letter-spacing: 0.06em; font-family: 'Courier New', monospace; text-shadow: 0 0 8px #00aaff44; }
  .form-coords { padding: 4px 14px 8px; font-size: 8px; color: #3a5a70; letter-spacing: 0.06em; font-family: 'Courier New', monospace; border-bottom: 1px solid #1a2d40; flex-shrink: 0; }

  .form-body { flex: 1; overflow-y: auto; padding: 10px 14px; display: flex; flex-direction: column; gap: 6px; }

  .section-lbl { font-size: 7.5px; color: #3a5a70; letter-spacing: 0.14em; text-transform: uppercase; margin-top: 4px; }
  .divider { height: 1px; background: #1a2d40; margin: 4px 0; }
  .equip-note { font-size: 8px; color: #2a4050; letter-spacing: 0.04em; }

  .field { display: flex; flex-direction: column; gap: 3px; }
  .field label { font-size: 8px; color: #6a8fa8; letter-spacing: 0.06em; text-transform: uppercase; }
  .field input, .field select {
    background: #080e14; border: 1px solid #1a2d40; color: #a0c4d8;
    font-family: 'Courier New', monospace; font-size: 10px;
    padding: 6px 8px; border-radius: 4px; outline: none;
    width: 100%; box-sizing: border-box;
  }
  .field input:focus, .field select:focus { border-color: #00aaff44; color: #4dc8ff; }
  .field input::placeholder { color: #2a4050; }

  /* Equipment grid: label | number input | max */
  .equip-grid {
    display: grid;
    grid-template-columns: 1fr 56px 40px;
    gap: 4px 8px;
    align-items: center;
  }
  .eg-hdr { font-size: 7.5px; color: #3a5a70; letter-spacing: 0.1em; text-transform: uppercase; }
  .eg-lbl { font-size: 9px; color: #6a8fa8; }
  .eg-num {
    background: #080e14; border: 1px solid #1a2d40; color: #a0c4d8;
    font-family: 'Courier New', monospace; font-size: 10px;
    padding: 4px 6px; border-radius: 4px; outline: none;
    width: 100%; box-sizing: border-box; text-align: center;
  }
  .eg-num:focus { border-color: #00aaff44; color: #4dc8ff; }
  .eg-max { font-size: 8px; color: #2a4050; text-align: right; }

  .calc-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0 2px; }
  .calc-lbl { font-size: 8px; color: #6a8fa8; text-transform: uppercase; letter-spacing: 0.06em; }
  .calc-val { font-size: 16px; font-weight: 700; color: #4dc8ff; font-family: 'Courier New', monospace; text-shadow: 0 0 8px #00aaff44; }

  .check-row { display: flex; align-items: center; gap: 8px; padding: 2px 0; }

  .form-actions { display: flex; gap: 6px; padding: 10px 14px; border-top: 1px solid #1a2d40; flex-shrink: 0; }
  .btn-cancel { flex: 1; background: #0a1018; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; padding: 8px; border-radius: 4px; cursor: pointer; }
  .btn-cancel:hover { border-color: #2a4a5e; color: #a0c4d8; }
  .btn-save { flex: 2; background: #00aaff14; border: 1px solid #00aaff44; color: #4dc8ff; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; padding: 8px; border-radius: 4px; cursor: pointer; }
  .btn-save:hover { background: #00aaff22; }
</style>
