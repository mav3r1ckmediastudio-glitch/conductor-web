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

import * as THREE from 'three';
import maplibregl from 'maplibre-gl';

const POLE_HEIGHT_M   = 6;
const POLE_RADIUS_M   = 0.15;
const TERRAIN_EXAGGERATION = 1.5;  // must match map terrain exaggeration setting
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

// Scene origin — central Perthshire (matches map center [-3.77, 56.71]).
// All pole positions are computed as metre-offsets from this point.
// Elevation kept at 0; per-pole ground elevation is baked into mesh Y.
const SCENE_ORIGIN = { lng: -3.77, lat: 56.71 };

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
    this._originMatrix = null;   // matrix `l` — origin world transform (axis swap + scale)
    this._mpu          = 1;      // mercator units per metre at origin
    this._elevationApplied = false; // false until terrain elevation was readable
    this._debugged     = false;
    this._renderCount  = 0;        // force rebuild for first N frames to catch store race
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

    // Shared geometry + material
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

    // Pole-top anchor — small flat disc sitting on the very top of each pole.
    this._anchorGeometry = new THREE.CylinderGeometry(
      ANCHOR_RADIUS_M, ANCHOR_RADIUS_M, ANCHOR_HEIGHT_M, 12
    );
    this._anchorMaterial = new THREE.MeshPhongMaterial({
      color:    ANCHOR_COLOR,
      emissive: ANCHOR_COLOR,
      emissiveIntensity: 0.4,
      shininess: 40,
    });

    // CBT box — a small cabinet that mounts at the top of a pole.
    this._cbtGeometry = new THREE.BoxGeometry(CBT_SIZE_M, CBT_SIZE_M, CBT_SIZE_M * 0.6);
    this._cbtMaterial = new THREE.MeshPhongMaterial({
      color:    CBT_COLOR,
      emissive: CBT_EMISSIVE,
      emissiveIntensity: 0.5,
      shininess: 30,
    });

    this._renderer = new THREE.WebGLRenderer({
      canvas:    map.getCanvas(),
      context:   gl,
      antialias: true,
    });
    this._renderer.autoClear = false;

    this._rebuildMeshes();
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

  _rebuildMeshes() {
    if (this._group) {
      this._scene.remove(this._group);
      this._group = null;
    }

    const poles = this.projectStore.poles || [];
    const cbts  = this.projectStore.cbts  || [];
    this._poleCount = poles.length;
    this._cbtCount  = cbts.length;
    if (!poles.length && !cbts.length) {
      this._elevationApplied = true; // nothing to place
      return;
    }

    this._group = new THREE.Group();
    let elevationReady = true;

    // Cache each pole's ground elevation so CBTs can mount at the right height
    // without a second terrain query (keyed by pole_id).
    const poleElev = {};

    for (const pole of poles) {
      const [lng, lat] = pole.geometry.coordinates;
      const { east, north } = this._metresFromOrigin(lng, lat);

      // Ground elevation at the pole so it sits on the terrain, not at sea level.
      let groundElev = 0;
      if (this._map && typeof this._map.queryTerrainElevation === 'function') {
        const e = this._map.queryTerrainElevation([lng, lat]);
        if (e == null) elevationReady = false;
        else groundElev = e;
      }
      poleElev[pole.properties.pole_id] = groundElev;

      // Pole cylinder — base on terrain, centre lifted by half height.
      const mesh = new THREE.Mesh(this._geometry, this._material);
      mesh.position.set(east, groundElev + POLE_HEIGHT_M / 2, -north);
      this._group.add(mesh);

      // Pole-top anchor disc — sits flush on the very top of the pole.
      const anchor = new THREE.Mesh(this._anchorGeometry, this._anchorMaterial);
      anchor.position.set(east, groundElev + POLE_HEIGHT_M + ANCHOR_HEIGHT_M / 2, -north);
      this._group.add(anchor);
    }

    // CBT boxes — mounted just below the top of their parent pole.
    for (const cbt of cbts) {
      const [lng, lat] = cbt.geometry.coordinates;
      const { east, north } = this._metresFromOrigin(lng, lat);

      // Prefer the cached parent-pole elevation; fall back to a direct query.
      let groundElev = poleElev[cbt.properties.parent_pole_id];
      if (groundElev == null) {
        groundElev = 0;
        if (this._map && typeof this._map.queryTerrainElevation === 'function') {
          const e = this._map.queryTerrainElevation([lng, lat]);
          if (e == null) elevationReady = false;
          else groundElev = e;
        }
      }

      const cbtMesh = new THREE.Mesh(this._cbtGeometry, this._cbtMaterial);
      // Mount the cabinet on the pole, just under the anchor.
      cbtMesh.position.set(east, groundElev + POLE_HEIGHT_M - CBT_SIZE_M / 2, -north);
      this._group.add(cbtMesh);
    }

    this._scene.add(this._group);
    this._elevationApplied = elevationReady;
    console.log('[PoleLayer] rebuilt', poles.length, 'poles', cbts.length, 'cbts, elevationReady:', elevationReady);
  }

  render(gl, args) {
    // === DIAGNOSTIC: mainMatrix shape (fires once) ===
    if (!this._debugged) {
      const raw = args?.defaultProjectionData?.mainMatrix;
      console.log('=== MAINMATRIX DIAGNOSTIC ===');
      console.log('Type:', raw?.constructor?.name);
      console.log('Length:', raw?.length);
      console.log('First 4 elements:', raw?.[0], raw?.[1], raw?.[2], raw?.[3]);
      this._debugged = true;
    }

    try {
      this._renderCount++;
      const currentCount = (this.projectStore.poles || []).length;
      const currentCbtCount = (this.projectStore.cbts || []).length;
      const needsRebuild = currentCount !== this._poleCount
                        || currentCbtCount !== this._cbtCount
                        || !this._elevationApplied
                        || this._renderCount <= 30;
      if (needsRebuild) {
        this._rebuildMeshes();
        if (!this._elevationApplied) this._map.triggerRepaint();
      }

      if (!this._group) return;

      // m = MapLibre's projection matrix (mercator → clip space).
      // fromArray accepts Float64Array fine.
      const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
      this._camera.projectionMatrix = m.multiply(this._originMatrix);

      this._renderer.resetState();
      this._renderer.render(this._scene, this._camera);
    } catch (err) {
      console.error('[PoleLayer] render error:', err);
    }
  }

  onRemove() {
    if (this._group)         this._scene.remove(this._group);
    if (this._geometry)      this._geometry.dispose();
    if (this._material)      this._material.dispose();
    if (this._anchorGeometry) this._anchorGeometry.dispose();
    if (this._anchorMaterial) this._anchorMaterial.dispose();
    if (this._cbtGeometry)   this._cbtGeometry.dispose();
    if (this._cbtMaterial)   this._cbtMaterial.dispose();
    if (this._renderer)      this._renderer.dispose();
  }
}

export function createPoleLayer(projectStore) {
  return new PoleLayer(projectStore);
}
