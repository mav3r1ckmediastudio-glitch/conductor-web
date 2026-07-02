// PoleLayers.js — CustomLayerInterface for 3D pole rendering
// THREE.js + MapLibre GL JS 5.x
// Ported from the official MapLibre v5 "3D models on terrain" example.
//
// Architecture (matches official example EXACTLY):
//   - Scene is NOT rotated. All axis-swap lives in the origin matrix `l`.
//   - l = translate(originMercator) * scale(mpu, -mpu, mpu) * rotateX(π/2)
//   - Meshes positioned in metres as (x=east, y=altitude, z=-north).
//   - Each pole's base altitude = terrain elevation at its lng/lat, so it
//     sits ON the ground instead of buried at sea level (depth-occluded).
//   - render(): camera.projectionMatrix = m.multiply(l)
//       m = MapLibre's mainMatrix (mercator → clip space)
//
// ELEVATION REFRESH (the fix):
//   queryTerrainElevation returns a COARSE value from a low-zoom parent DEM
//   tile until the fine tile for that point loads — it does NOT return null in
//   that window. So we re-read elevation as DEM tiles stream in (the `data`
//   event). To avoid rebuilding the meshes on terrain's near-continuous data
//   chatter, each dirty frame does a CHEAP sample of pole elevations into a
//   signature and only does the EXPENSIVE mesh rebuild when that signature
//   actually changes (or terrain is still loading, or asset counts changed).
//   Per-span/drop geometries are disposed on each rebuild so we don't leak.
//
// BARBER POLE SHADER:
//   Spans and aerial drops whose UPRN (or connected CBT) is in the last
//   Validate Routes ROUTED set get a ShaderMaterial instead of the plain
//   MeshPhongMaterial. The shader draws a helical cyan-and-white stripe that
//   travels along the cylinder — a "live signal flowing" visual cue.
//   Call setLiveState(routedUprns, liveCbtIds) after a Validate Routes run
//   to switch assets between live and dead materials.
//
// SPLITTER RATIO HOLOGRAM (agreed 2 Jul 2026):
//   A rotating text plane above every CBT (always a splitter) and every UG
//   joint with has_splitter set, showing its split_ratio ("1:8", "1:4", ...).
//   Deliberately a real THREE.Mesh with rotation.y ticked over time, not a
//   THREE.Sprite or a flat 2D MapLibre icon with icon-rotate — a Sprite
//   always faces the camera (never rotates), and icon-rotate spins in the
//   screen plane like a coin, which for text reads as upside-down half the
//   time rather than a rotating sign. This rotates around its own vertical
//   axis instead: readable most of the way round, edge-on at 90°/270°.
//   Text is drawn to a canvas (same shadowBlur-glow technique as the 2D
//   icons in mapTools.js) and used as a THREE.CanvasTexture; geometry and
//   per-ratio-string materials are cached rather than rebuilt every frame
//   or every rebuild — see _makeSplitterTexture()/_getSplitterMaterial().

import * as THREE from 'three';
import maplibregl from 'maplibre-gl';

// ── Barber pole animation ──────────────────────────────────────────────────────
// PULSE_SPEED: lower = slower.  0.3 is lazy/natural.  Range: 0.1 (glacial) → 1.0 (fast).
const PULSE_SPEED = 0.3;
// STRIPE_DENSITY: higher = tighter coils.  8.0 is spring-like.  Range: 3.0 (wide) → 20.0 (very tight).
const STRIPE_DENSITY = 8.0;

const POLE_HEIGHT_M   = 6;
const POLE_RADIUS_M   = 0.15;
const POLE_COLOR    = 0x4dc8ff;
const POLE_OPACITY  = 0.85;
const POLE_EMISSIVE = 0x0d3a55;
const POLE_SEGMENTS = 8;

// Pole-top anchor disc — visible mount point at the top of every pole.
const ANCHOR_RADIUS_M = 0.4;
const ANCHOR_HEIGHT_M = 0.25;
const ANCHOR_COLOR    = 0x4dc8ff;

// CBT cabinet box — rendered at pole-top when a CBT is mounted on a pole.
const CBT_SIZE_M    = 0.5;
const CBT_COLOR     = 0xa0c4d8;
const CBT_EMISSIVE  = 0x1a5a7a;

// Aerial span — solid 3D line between CBT pole-tops (same cyan as UG duct).
const SPAN_COLOR    = 0x4dc8ff;
const SPAN_RADIUS_M = 0.12; // rendered as a thin cylinder (LineBasicMaterial can't do width)
const SPAN_DROP_M   = CBT_SIZE_M / 2; // attach at the CBT cube, just under the anchor

// Aerial drop — 3D line from a CBT pole-top down to a premise at ground level.
const ADROP_COLOR    = 0x4dc8ff;
const ADROP_RADIUS_M = 0.08; // thinner than a span — it's a single subscriber drop
const ADROP_PREMISE_H = 0.3; // land the drop slightly above ground for a clean finish

// CBT tail — fibre tail riding the span line from a CBT, through its pole chain,
// then dropping to the parent underground joint. Thinnest of the aerial lines.
const TAIL_COLOR     = 0x7ab8d4; // muted cyan — reads as fibre, distinct from span
const TAIL_RADIUS_M  = 0.06;

// Scene origin — central Perthshire (matches map center [-3.77, 56.71]).
// All pole positions are computed as metre-offsets from this point.
// Elevation kept at 0; per-pole ground elevation is baked into mesh Y.
const SCENE_ORIGIN = { lng: -3.77, lat: 56.71 };

// ── Barber pole GLSL ──────────────────────────────────────────────────────────
// Helical stripe in UV space. vUv.x = circumference (0→1), vUv.y = length (0→1).
// Mixing both axes creates a diagonal helix; time offset drives forward motion.

const BARBER_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const BARBER_FRAG = `
  precision mediump float;
  uniform float time;
  uniform float density;
  varying vec2 vUv;

  void main() {
    float PI2 = 6.28318530718;

    // Helical stripe: 1.5 wraps around circumference, density cycles along length.
    // density is controlled by STRIPE_DENSITY constant — higher = tighter coils.
    // Subtract time to animate the stripe moving forward along the cylinder.
    float phase = (vUv.x * 1.5 + vUv.y * density - time) * PI2;

    // Smooth sinusoidal blend — no hard edges, looks like light through glass fibre.
    float t = 0.5 + 0.5 * sin(phase);

    // Brand cyan (#4dc8ff) <-> near-white with slight blue tint
    vec3 cyan  = vec3(0.302, 0.784, 1.000);
    vec3 white = vec3(0.900, 0.980, 1.000);
    vec3 col   = mix(cyan, white, t);

    // Glow: boost brightness on the white stripe for the "lit from within" feel.
    col += t * 0.55 * vec3(0.12, 0.55, 0.85);

    // Allow slight overexposure — MapLibre's WebGL context will clamp to display.
    col = min(col, vec3(1.6));

    gl_FragColor = vec4(col, 0.96);
  }
`;

// ── Splitter ratio hologram ──────────────────────────────────────────────────
// A rotating text plane above every CBT (always a splitter — that's what a
// CBT is) and every UG joint with has_splitter set, showing its split_ratio
// ("1:8", "1:4", ...). Requested 2 Jul 2026: a genuine 3D rotating sign
// rather than a flat 2D icon spinning face-on like a coin — readable most of
// the way round, edge-on at 90°/270°, which is what actually reads as a
// hologram rather than a spinning logo.
const HOLOGRAM_WIDTH_M      = 1.4;
const HOLOGRAM_HEIGHT_M     = 0.7;
const HOLOGRAM_CBT_GAP_M    = 0.5;   // above the CBT box
const HOLOGRAM_JOINT_HEIGHT_M = 2.2; // above ground level, joints have no existing vertical structure
const HOLOGRAM_ROTATE_PERIOD_S = 10; // one full rotation every 10s — "slowly"
const HOLOGRAM_TEXT_COLOR   = '#4dc8ff';
const HOLOGRAM_GLOW_COLOR   = '#00aaff';
const HOLOGRAM_FRAME_COLOR  = '#4dc8ff88';

// Matches fibreAssign.js's own tolerant has_splitter check exactly (it
// accepts true / 1 / 'true' — see buildSplitters() there) so this stays in
// sync with whatever the engine actually treats as a splitter, rather than
// silently drifting from it.
function jointHasSplitter(feature) {
  const v = feature?.properties?.has_splitter;
  return v === true || v === 1 || v === 'true';
}

// Same default fallback fibreAssign.js uses when split_ratio isn't set.
function splitterRatioFor(feature) {
  return feature?.properties?.split_ratio || '1:8';
}

class PoleLayer {
  constructor(projectStore) {
    this.id            = 'poles-3d-layer';
    this.type          = 'custom';
    this.renderingMode = '3d';
    this.projectStore  = projectStore;
    this._scene        = null;
    this._camera       = null;
    this._renderer     = null;
    this._material     = null;
    this._geometry     = null;
    this._group        = null;
    this._poleCount    = -1;
    this._cbtCount     = -1;
    this._spanCount    = -1;
    this._adropCount   = -1;
    this._tailCount    = -1;
    this._originMatrix = null;   // matrix `l` — origin world transform (axis swap + scale)
    this._mpu          = 1;      // mercator units per metre at origin
    this._renderCount  = 0;      // short startup window to catch the store-population race

    this._terrainDirty = true;   // a terrain tile loaded → re-sample elevation
    this._lastElevSig  = null;   // signature of last sampled pole elevations
    this._dynamicGeoms = [];     // per-span/drop geometries to dispose each rebuild
    this._onData       = null;   // bound terrain `data` handler

    // Live validated state — set by setLiveState() after a Validate Routes run.
    // _liveUprns: Set of UPRN strings whose route status is ROUTED.
    // _liveNodeIds: Set of CBT/pole IDs reachable from a live drop (flood-filled in App.svelte).
    this._liveUprns   = new Set();
    this._liveNodeIds = new Set();

    // Shared barber-pole shader material — used by all live spans + drops.
    // Created in onAdd(); uniform `time` is ticked in render().
    this._pulseMaterial = null;

    // Splitter ratio holograms — rebuilt every _buildGroup() call like
    // everything else, but rotation is ticked per-instance in render() (each
    // mesh needs its own rotation.y, unlike the barber pole's single shared
    // time uniform). Textures/materials are cached per distinct ratio string
    // ("1:8", "1:4", ...) rather than regenerated per-asset — there are only
    // ever a handful of distinct values however many splitters exist.
    this._hologramMeshes   = [];
    this._splitterTexCache = new Map();
    this._splitterMatCache = new Map();
    this._splitterGeometry = null; // created in onAdd(), shared by every hologram mesh
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  // Called from App.svelte after a Validate Routes run.
  // routedUprns : Set<string>  — UPRNs with status ROUTED
  // liveNodeIds : Set<string>  — CBT + pole IDs reachable from a live drop (flood-filled)
  setLiveState(routedUprns, liveNodeIds) {
    this._liveUprns   = routedUprns  || new Set();
    this._liveNodeIds = liveNodeIds  || new Set();
    this._update(true);
    if (this._map) this._map.triggerRepaint();
  }

  onAdd(map, gl) {
    this._map = map;

    this._camera = new THREE.Camera();
    this._scene  = new THREE.Scene();

    // NO scene rotation. The axis-swap is handled entirely in _originMatrix below.

    // Lighting
    const light = new THREE.DirectionalLight(0xffffff, 0.9);
    light.position.set(50, 70, -30).normalize();
    this._scene.add(light);
    this._scene.add(new THREE.AmbientLight(0xffffff, 0.6));

    // Compute the scene origin's mercator transform (matrix `l`).
    const originMC = maplibregl.MercatorCoordinate.fromLngLat(SCENE_ORIGIN, 0);
    this._mpu = originMC.meterInMercatorCoordinateUnits();

    // l = translate to origin mercator position
    //     * scale (metres→mercator, Y negated for mercator's south-positive axis)
    //     * rotateX(π/2) to map THREE's Y-up geometry into mercator's Z-up
    this._originMatrix = new THREE.Matrix4()
      .makeTranslation(originMC.x, originMC.y, originMC.z)
      .scale(new THREE.Vector3(this._mpu, -this._mpu, this._mpu))
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));

    // Shared geometry + material (reused across every rebuild — never disposed
    // mid-life; only in onRemove).
    this._geometry = new THREE.CylinderGeometry(
      POLE_RADIUS_M, POLE_RADIUS_M, POLE_HEIGHT_M, POLE_SEGMENTS
    );
    this._material = new THREE.MeshPhongMaterial({
      color:       POLE_COLOR,
      emissive:    POLE_EMISSIVE,
      opacity:     POLE_OPACITY,
      transparent: true,
      shininess:   20,
    });

    this._anchorGeometry = new THREE.CylinderGeometry(
      ANCHOR_RADIUS_M, ANCHOR_RADIUS_M, ANCHOR_HEIGHT_M, 12
    );
    this._anchorMaterial = new THREE.MeshPhongMaterial({
      color:    ANCHOR_COLOR,
      emissive: ANCHOR_COLOR,
      emissiveIntensity: 0.4,
      shininess: 40,
    });

    this._cbtGeometry = new THREE.BoxGeometry(CBT_SIZE_M, CBT_SIZE_M, CBT_SIZE_M * 0.6);
    this._cbtMaterial = new THREE.MeshPhongMaterial({
      color:    CBT_COLOR,
      emissive: CBT_EMISSIVE,
      emissiveIntensity: 0.5,
      shininess: 30,
    });

    this._spanMaterial = new THREE.MeshPhongMaterial({
      color:    SPAN_COLOR,
      emissive: SPAN_COLOR,
      emissiveIntensity: 0.35,
      shininess: 20,
    });

    this._adropMaterial = new THREE.MeshPhongMaterial({
      color:    ADROP_COLOR,
      emissive: ADROP_COLOR,
      emissiveIntensity: 0.3,
      shininess: 20,
    });

    this._tailMaterial = new THREE.MeshPhongMaterial({
      color:    TAIL_COLOR,
      emissive: TAIL_COLOR,
      emissiveIntensity: 0.25,
      shininess: 15,
    });

    // Shared by every splitter-ratio hologram mesh — only the material
    // (texture) differs per distinct ratio string, cached in
    // _getSplitterMaterial() below.
    this._splitterGeometry = new THREE.PlaneGeometry(HOLOGRAM_WIDTH_M, HOLOGRAM_HEIGHT_M);

    // Barber pole shader material — shared by all live spans + drops.
    // time uniform is ticked every render() call so the stripe animates.
    this._pulseMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time:    { value: 0.0 },
        density: { value: STRIPE_DENSITY },
      },
      vertexShader:   BARBER_VERT,
      fragmentShader: BARBER_FRAG,
      transparent: true,
      side: THREE.FrontSide,
    });

    this._renderer = new THREE.WebGLRenderer({
      canvas:    map.getCanvas(),
      context:   gl,
      antialias: true,
    });
    this._renderer.autoClear = false;

    // Mark dirty when terrain DEM tiles load/refine. The render loop then does a
    // cheap elevation sample; an unchanged sample costs almost nothing.
    this._onData = (e) => {
      const isTerrain =
        e && (e.sourceId === 'terrain' ||
              (e.source && e.source.type === 'raster-dem'));
      if (isTerrain && e.tile) {
        this._terrainDirty = true;
        this._map.triggerRepaint();
      }
    };
    map.on('data', this._onData);

    this._update(true);
  }

  // Convert a lng/lat to metre-offset (east, north) from SCENE_ORIGIN
  _metresFromOrigin(lng, lat) {
    const origin = maplibregl.MercatorCoordinate.fromLngLat(SCENE_ORIGIN, 0);
    const point  = maplibregl.MercatorCoordinate.fromLngLat({ lng, lat }, 0);
    const mpu = origin.meterInMercatorCoordinateUnits();
    // mercator x: west→east (+).  mercator y: north→south (+), so north = origin.y - point.y
    const east  = (point.x - origin.x) / mpu;
    const north = (origin.y - point.y) / mpu;
    return { east, north };
  }

  // Read ground elevation at a coordinate. Returns a number, or null if terrain
  // isn't ready for that point yet.
  _elevAt(lng, lat) {
    if (this._map && typeof this._map.queryTerrainElevation === 'function') {
      const e = this._map.queryTerrainElevation([lng, lat]);
      return (e == null) ? null : e;
    }
    return null;
  }

  // Canvas-drawn text texture for a split-ratio hologram ("1:8", "1:4", ...).
  // Same glow-via-shadowBlur technique as the 2D icons in mapTools.js
  // (addPinIcon/addSquareIcon), just feeding a THREE.CanvasTexture instead of
  // a MapLibre map.addImage(). Cached per distinct ratio string.
  _makeSplitterTexture(ratioText) {
    if (this._splitterTexCache.has(ratioText)) return this._splitterTexCache.get(ratioText);

    const W = 256, H = 128;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, W, H);

    ctx.shadowColor = HOLOGRAM_GLOW_COLOR;
    ctx.shadowBlur = 22;
    ctx.fillStyle = HOLOGRAM_TEXT_COLOR;
    ctx.font = 'bold 60px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ratioText, W / 2, H / 2);

    // Thin frame — reads as a holographic sign rather than bare floating
    // text. No glow on the frame itself so it doesn't compete with the text.
    ctx.shadowBlur = 0;
    ctx.strokeStyle = HOLOGRAM_FRAME_COLOR;
    ctx.lineWidth = 3;
    ctx.strokeRect(6, 6, W - 12, H - 12);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    this._splitterTexCache.set(ratioText, texture);
    return texture;
  }

  // MeshBasicMaterial (not Phong — this should read as self-lit/glowing, not
  // reflecting the scene's directional light like the poles/CBTs do).
  // DoubleSide + depthWrite:false so it doesn't vanish edge-on mid-rotation
  // or cause z-fighting with other transparent meshes nearby.
  _getSplitterMaterial(ratioText) {
    if (this._splitterMatCache.has(ratioText)) return this._splitterMatCache.get(ratioText);
    const material = new THREE.MeshBasicMaterial({
      map: this._makeSplitterTexture(ratioText),
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this._splitterMatCache.set(ratioText, material);
    return material;
  }

  // CHEAP pass: query pole elevations into a cache + change-signature. No THREE
  // objects allocated. `pending` is true if any pole's DEM tile isn't loaded.
  _samplePoleElevations() {
    const poles = this.projectStore.poles || [];
    const poleElev = {};
    let pending = false;
    let sig = '';
    for (const pole of poles) {
      const [lng, lat] = pole.geometry.coordinates;
      let g = this._elevAt(lng, lat);
      if (g == null) { g = 0; pending = true; }
      poleElev[pole.properties.pole_id] = g;
      sig += g.toFixed(1) + ';';
    }
    // Splitter state folded into the same signature — an edit to
    // has_splitter/split_ratio on an existing joint/CBT (via the asset edit
    // panel, not a count change) needs to trigger a hologram rebuild too,
    // and this is the cheapest way to catch that without a second detection
    // path alongside the elevation one.
    for (const cbt of (this.projectStore.cbts || [])) {
      sig += 'C' + cbt.properties.cbt_id + ':' + splitterRatioFor(cbt) + ';';
    }
    for (const j of (this.projectStore.joints || [])) {
      if (jointHasSplitter(j)) sig += 'J' + j.properties.joint_id + ':' + splitterRatioFor(j) + ';';
    }
    return { poleElev, sig, pending };
  }

  // EXPENSIVE pass: (re)build the THREE group from the pole-elevation cache.
  _buildGroup(poleElev) {
    // Dispose the per-span/drop geometries from the previous build first — they
    // are created fresh every rebuild and would otherwise leak GPU memory.
    for (const g of this._dynamicGeoms) g.dispose();
    this._dynamicGeoms = [];

    // Hologram mesh instances aren't disposed here — geometry/materials are
    // shared/cached (see _splitterGeometry, _getSplitterMaterial) and the
    // meshes themselves get garbage-collected with the old _group below.
    // Just drop the tracking array so render()'s rotation loop doesn't tick
    // stale instances that no longer belong to the current group.
    this._hologramMeshes = [];

    if (this._group) {
      this._scene.remove(this._group);
      this._group = null;
    }

    const poles  = this.projectStore.poles || [];
    const cbts   = this.projectStore.cbts  || [];
    const spans  = this.projectStore.spans || [];
    const adrops = this.projectStore.aerialDrops || [];
    const tails  = this.projectStore.cbtTails || [];

    this._poleCount  = poles.length;
    this._cbtCount   = cbts.length;
    this._spanCount  = spans.length;
    this._adropCount = adrops.length;
    this._tailCount  = tails.length;

    if (!poles.length && !cbts.length && !spans.length && !adrops.length && !tails.length) {
      return; // nothing to place
    }

    this._group = new THREE.Group();
    let elevMin = Infinity, elevMax = -Infinity;

    // pole_id → Vector3 at the pole-top attach height (same level CBTs/spans use).
    // Lets a CBT tail ride the aerial route through intermediate poles.
    const poleTop = {};

    for (const pole of poles) {
      const [lng, lat] = pole.geometry.coordinates;
      const { east, north } = this._metresFromOrigin(lng, lat);
      const groundElev = poleElev[pole.properties.pole_id] ?? 0;
      elevMin = Math.min(elevMin, groundElev);
      elevMax = Math.max(elevMax, groundElev);

      // Pole cylinder — base on terrain, centre lifted by half height.
      const mesh = new THREE.Mesh(this._geometry, this._material);
      mesh.position.set(east, groundElev + POLE_HEIGHT_M / 2, -north);
      this._group.add(mesh);

      // Pole-top anchor disc — sits flush on the very top of the pole.
      const anchor = new THREE.Mesh(this._anchorGeometry, this._anchorMaterial);
      anchor.position.set(east, groundElev + POLE_HEIGHT_M + ANCHOR_HEIGHT_M / 2, -north);
      this._group.add(anchor);

      poleTop[pole.properties.pole_id] =
        new THREE.Vector3(east, groundElev + POLE_HEIGHT_M - SPAN_DROP_M, -north);
    }

    // CBT boxes — mounted just below the top of their parent pole.
    const cbtTop = {}; // cbt_id → THREE.Vector3 at the cube/attach height
    for (const cbt of cbts) {
      const [lng, lat] = cbt.geometry.coordinates;
      const { east, north } = this._metresFromOrigin(lng, lat);

      // Prefer the cached parent-pole elevation; fall back to a direct query.
      let groundElev = poleElev[cbt.properties.parent_pole_id];
      if (groundElev == null) {
        groundElev = this._elevAt(lng, lat);
        if (groundElev == null) groundElev = 0;
      }

      const attachY = groundElev + POLE_HEIGHT_M - SPAN_DROP_M;
      const cbtMesh = new THREE.Mesh(this._cbtGeometry, this._cbtMaterial);
      cbtMesh.position.set(east, attachY, -north);
      this._group.add(cbtMesh);

      cbtTop[cbt.properties.cbt_id] = new THREE.Vector3(east, attachY, -north);

      // Splitter ratio hologram — every CBT is a splitter, no has_splitter
      // check needed (see jointHasSplitter() for why joints differ).
      const holoMesh = new THREE.Mesh(this._splitterGeometry, this._getSplitterMaterial(splitterRatioFor(cbt)));
      holoMesh.position.set(east, attachY + CBT_SIZE_M / 2 + HOLOGRAM_CBT_GAP_M, -north);
      this._group.add(holoMesh);
      this._hologramMeshes.push(holoMesh);
    }

    // Splitter ratio holograms for UG joints — only where has_splitter is
    // set (unlike CBTs, most joints are plain splice/through joints, not
    // splitters). Ground-level position, same terrain-sampling pattern the
    // JOINT case in resolve() below uses for span/tail endpoints.
    for (const joint of (this.projectStore.joints || [])) {
      if (!jointHasSplitter(joint)) continue;
      const [lng, lat] = joint.geometry.coordinates;
      const { east, north } = this._metresFromOrigin(lng, lat);
      let groundElev = this._elevAt(lng, lat);
      if (groundElev == null) groundElev = 0;

      const holoMesh = new THREE.Mesh(this._splitterGeometry, this._getSplitterMaterial(splitterRatioFor(joint)));
      holoMesh.position.set(east, groundElev + HOLOGRAM_JOINT_HEIGHT_M, -north);
      this._group.add(holoMesh);
      this._hologramMeshes.push(holoMesh);
    }

    // Allow spans/drops to attach to the cabinet/POP.
    let popTop = null;
    const cabinet = this.projectStore.cabinet;
    if (cabinet) {
      const [lng, lat] = cabinet.geometry.coordinates;
      const { east, north } = this._metresFromOrigin(lng, lat);
      let groundElev = this._elevAt(lng, lat);
      if (groundElev == null) groundElev = 0;
      popTop = new THREE.Vector3(east, groundElev + POLE_HEIGHT_M - SPAN_DROP_M, -north);
      this._popId = cabinet.properties.pop_id;
    }

    // Aerial spans — solid cyan 3D lines between aerial/UG attach points.
    // Live spans (endpoint is a validated live CBT) get the barber pole shader.
    for (const span of spans) {
      const fromId   = span.properties.from_node;
      const toId     = span.properties.to_node;
      const fromType = span.properties.from_type || 'CBT';
      const toType   = span.properties.to_type   || 'CBT';

      const resolve = (id, type) => {
        // CBT — pole-top attach point (cached)
        if (type === 'CBT' && cbtTop[id]) return cbtTop[id];
        // Bare pole — pole-top (cached)
        if (type === 'POLE' && poleTop[id]) return poleTop[id];
        // POP cabinet
        if (type === 'POP' && popTop && id === this._popId) return popTop;
        // JOINT — ground level at joint's 2D coordinates
        if (type === 'JOINT') {
          const jFeature = (this.projectStore.joints || []).find(j => j.properties.joint_id === id);
          if (jFeature) {
            const [lng, lat] = jFeature.geometry.coordinates;
            const { east, north } = this._metresFromOrigin(lng, lat);
            let g = this._elevAt(lng, lat);
            if (g == null) g = 0;
            return new THREE.Vector3(east, g, -north);
          }
        }
        // Fallback: try all caches
        if (cbtTop[id])  return cbtTop[id];
        if (poleTop[id]) return poleTop[id];
        if (popTop && id === this._popId) return popTop;
        return null;
      };

      const a = resolve(fromId, fromType);
      const b = resolve(toId,   toType);
      if (!a || !b) continue; // endpoint deleted → skip

      const dir = new THREE.Vector3().subVectors(b, a);
      const len = dir.length();
      if (len === 0) continue;

      // Live if either endpoint is a validated live node (CBT or pole).
      const isLive = this._liveNodeIds.has(fromId) || this._liveNodeIds.has(toId);
      const mat = isLive ? this._pulseMaterial : this._spanMaterial;

      const spanGeom = new THREE.CylinderGeometry(SPAN_RADIUS_M, SPAN_RADIUS_M, len, 6);
      this._dynamicGeoms.push(spanGeom);
      const spanMesh = new THREE.Mesh(spanGeom, mat);
      spanMesh.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        dir.clone().normalize()
      );
      spanMesh.position.copy(a).add(b).multiplyScalar(0.5);
      this._group.add(spanMesh);
    }

    // Aerial drops — 3D cylinder from a CBT pole-top DOWN to a premise.
    // Live drops (UPRN in ROUTED set) get the barber pole shader.
    for (const adrop of adrops) {
      const coords = adrop.geometry.coordinates; // [[lng,lat](CBT), [lng,lat](premise)]
      if (!coords || coords.length < 2) continue;

      let a = cbtTop[adrop.properties.from_cbt];
      if (!a) {
        const [lng, lat] = coords[0];
        const { east, north } = this._metresFromOrigin(lng, lat);
        let g = this._elevAt(lng, lat);
        if (g == null) g = 0;
        a = new THREE.Vector3(east, g + POLE_HEIGHT_M - SPAN_DROP_M, -north);
      }

      const [plng, plat] = coords[coords.length - 1];
      const { east: peast, north: pnorth } = this._metresFromOrigin(plng, plat);
      let pelev = this._elevAt(plng, plat);
      if (pelev == null) pelev = 0;
      const b = new THREE.Vector3(peast, pelev + ADROP_PREMISE_H, -pnorth);

      const dir = new THREE.Vector3().subVectors(b, a);
      const len = dir.length();
      if (len === 0) continue;

      // Live if the drop's UPRN is in the validated ROUTED set.
      const uprn = String(adrop.properties.uprn || '');
      const isLive = uprn && this._liveUprns.has(uprn);
      const mat = isLive ? this._pulseMaterial : this._adropMaterial;

      const dropGeom = new THREE.CylinderGeometry(ADROP_RADIUS_M, ADROP_RADIUS_M, len, 6);
      this._dynamicGeoms.push(dropGeom);
      const dropMesh = new THREE.Mesh(dropGeom, mat);
      dropMesh.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        dir.clone().normalize()
      );
      dropMesh.position.copy(a).add(b).multiplyScalar(0.5);
      this._group.add(dropMesh);
    }

    // CBT tails — fibre tail riding the aerial route from a CBT, through its
    // pole chain (at pole-top height, on the span line), then dropping to the
    // parent underground joint at ground level. Rendered as a chain of thin
    // cylinders so it follows the poles instead of cutting a straight line.
    for (const tail of tails) {
      const coords = tail.geometry.coordinates;            // [[lng,lat], …] CBT→…→JOINT
      const chain  = tail.properties.node_chain || [];     // ids, same order
      const types  = tail.properties.node_types || [];     // 'CBT'|'POLE'|'JOINT'
      if (!coords || coords.length < 2) continue;

      // Resolve every vertex to a 3D attach point.
      const pts = [];
      for (let i = 0; i < coords.length; i++) {
        const id   = chain[i];
        const type = types[i];
        let p = null;

        if (type === 'CBT')  p = cbtTop[id]  || null;
        if (type === 'POLE') p = poleTop[id] || null;

        if (!p) {
          // JOINT (ground level), or a CBT/pole whose cache miss we recover from
          // by sampling terrain at the stored 2D coordinate.
          const [lng, lat] = coords[i];
          const { east, north } = this._metresFromOrigin(lng, lat);
          let g = this._elevAt(lng, lat);
          if (g == null) g = 0;
          // Joints land at ground; a recovered CBT/pole rides pole-top height.
          const y = (type === 'JOINT')
            ? g + ADROP_PREMISE_H
            : g + POLE_HEIGHT_M - SPAN_DROP_M;
          p = new THREE.Vector3(east, y, -north);
        }
        pts.push(p);
      }

      // One thin cylinder per segment.
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const dir = new THREE.Vector3().subVectors(b, a);
        const len = dir.length();
        if (len === 0) continue;

        const tailGeom = new THREE.CylinderGeometry(TAIL_RADIUS_M, TAIL_RADIUS_M, len, 6);
        this._dynamicGeoms.push(tailGeom);
        const tailMesh = new THREE.Mesh(tailGeom, this._tailMaterial);
        tailMesh.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          dir.clone().normalize()
        );
        tailMesh.position.copy(a).add(b).multiplyScalar(0.5);
        this._group.add(tailMesh);
      }
    }

    this._scene.add(this._group);

    const elevRange = (elevMin === Infinity) ? 'n/a' : `${elevMin.toFixed(1)}–${elevMax.toFixed(1)}m`;
    console.log('[PoleLayer] rebuilt', poles.length, 'poles', cbts.length, 'cbts',
      spans.length, 'spans', adrops.length, 'adrops', tails.length, 'tails',
      this._hologramMeshes.length, 'splitter holograms · ground elev', elevRange);
  }

  // Sample elevations (cheap) and rebuild the meshes only if something changed.
  // `force` rebuilds unconditionally (initial add / asset count change).
  _update(force) {
    const { poleElev, sig, pending } = this._samplePoleElevations();
    const changed = sig !== this._lastElevSig;
    if (changed) this._lastElevSig = sig;

    if (force || changed || pending) {
      this._buildGroup(poleElev);
    }

    // Keep retrying only while terrain is still loading for some pole.
    this._terrainDirty = pending;
    if (pending) this._map.triggerRepaint();
  }

  render(gl, args) {
    try {
      this._renderCount++;
      const poleCount  = (this.projectStore.poles || []).length;
      const cbtCount   = (this.projectStore.cbts || []).length;
      const spanCount  = (this.projectStore.spans || []).length;
      const adropCount = (this.projectStore.aerialDrops || []).length;
      const tailCount  = (this.projectStore.cbtTails || []).length;

      const countsChanged = poleCount  !== this._poleCount
                         || cbtCount   !== this._cbtCount
                         || spanCount  !== this._spanCount
                         || adropCount !== this._adropCount
                         || tailCount  !== this._tailCount;

      if (countsChanged) {
        this._update(true);
      } else if (this._terrainDirty || this._renderCount <= 3) {
        this._update(false);
      }

      if (!this._group) return;

      // Tick the barber pole time uniform.
      // PULSE_SPEED controls animation rate — see constant at top of file.
      if (this._pulseMaterial) {
        this._pulseMaterial.uniforms.time.value =
          (performance.now() / 1000) * PULSE_SPEED;
      }

      // Tick splitter hologram rotation. Absolute-time-based (not delta-
      // accumulated) so every hologram stays in sync with every other one
      // regardless of when each was created, same reasoning as the barber
      // pole's time uniform above.
      if (this._hologramMeshes.length) {
        const angle = (performance.now() / 1000 / HOLOGRAM_ROTATE_PERIOD_S) * Math.PI * 2;
        for (const mesh of this._hologramMeshes) mesh.rotation.y = angle;
      }

      // m = MapLibre's projection matrix (mercator → clip space).
      // fromArray accepts Float64Array fine.
      const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
      this._camera.projectionMatrix = m.multiply(this._originMatrix);

      this._renderer.resetState();
      this._renderer.render(this._scene, this._camera);

      // Keep repainting continuously while live pulsing assets exist, or any
      // splitter hologram needs its rotation animated.
      // Without this, MapLibre only repaints on interaction and the stripe/
      // rotation freezes.
      if (this._liveUprns.size > 0 || this._liveNodeIds.size > 0 || this._hologramMeshes.length > 0) {
        this._map.triggerRepaint();
      }
    } catch (err) {
      console.error('[PoleLayer] render error:', err);
    }
  }

  onRemove() {
    if (this._map && this._onData) this._map.off('data', this._onData);
    for (const g of this._dynamicGeoms) g.dispose();
    this._dynamicGeoms = [];
    if (this._group)          this._scene.remove(this._group);
    if (this._geometry)       this._geometry.dispose();
    if (this._material)       this._material.dispose();
    if (this._anchorGeometry) this._anchorGeometry.dispose();
    if (this._anchorMaterial) this._anchorMaterial.dispose();
    if (this._cbtGeometry)    this._cbtGeometry.dispose();
    if (this._cbtMaterial)    this._cbtMaterial.dispose();
    if (this._spanMaterial)   this._spanMaterial.dispose();
    if (this._adropMaterial)  this._adropMaterial.dispose();
    if (this._tailMaterial)   this._tailMaterial.dispose();
    if (this._pulseMaterial)  this._pulseMaterial.dispose();
    if (this._splitterGeometry) this._splitterGeometry.dispose();
    for (const tex of this._splitterTexCache.values()) tex.dispose();
    for (const mat of this._splitterMatCache.values()) mat.dispose();
    this._splitterTexCache.clear();
    this._splitterMatCache.clear();
    this._hologramMeshes = [];
    if (this._renderer)       this._renderer.dispose();
  }
}

export function createPoleLayer(projectStore) {
  return new PoleLayer(projectStore);
}
