<script>
  import { onMount } from 'svelte';
  import maplibregl from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';

  let map;

  onMount(() => {
    map = new maplibregl.Map({
      container: 'map',
      style: 'https://api.maptiler.com/maps/dataviz-dark/style.json?key=7DkZfFXHsvdG3ZMivAV6',
      center: [-2.89, 56.39],
      zoom: 12
    });
  });
</script>

<div id="map"></div>

<style>
  #map {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }
</style>