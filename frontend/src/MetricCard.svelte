<script>
  export let label = '';
  export let value = '0';
  export let color = '#e0e0e0';
</script>

<div class="card">
  <span class="value" style="color: {color}">{value}</span>
  <span class="label">{label}</span>
</div>

<style>
  .card {
    background: #0f1923;
    padding: 10px 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
  }

  .value {
    font-size: 20px;
    font-weight: 800;
  }

  .label {
    font-size: 9px;
    color: #5a7a8a;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
</style>