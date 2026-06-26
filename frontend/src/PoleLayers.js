// PoleLayers.js — CustomLayerInterface for 3D pole rendering
// THREE.js + MapLibre GL JS 5.x
// Ported from the official MapLibre v5 "3D models on terrain" example.
//
// Architecture:
//   - One scene, oriented so x=east, y=up, z=north (matches mercator)
//   - A scene origin (the build area) converted to a mercator matrix `l`
//   - Each pole positioned as a metre-offset from that origin
//   - render(): camera.projectionMatrix = m.multiply(l)
//       m = MapLibre's mainMatrix (mercator → clip space)
//       l = scene origin world matrix (metres → mercator, at origin)

import * as THREE from 'three';
import maplibregl from 'maplibre-gl';

const POLE_HEIGHT_M = 9;
const POLE_RADIUS_M = 0.15;
const POLE_COLOR    = 0x4dc8ff;
const POLE_OPACITY  = 0.85;
const POLE_EMISSIVE = 0x0d3a55;
const POLE_SEGMENTS = 8;

// Scene origin — central Perthshire (matches map center [-3.77, 56.71]).
// All pole positions are computed as metre-offsets from this point.
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
    this._originMatrix = null;  // matrix `l` — origin world transform
    this._mpu          = 1;     // mercator units per metre at origin
  }

  onAdd(map, gl) {
    this._map = map;

    this._camera = new THREE.Camera();
    this._scene  = new THREE.Scene();

    // Orient the scene so it matches MapLibre's coordinate space:
    //   three.js default: x=right, y=up, z=toward viewer
    //   we want:          x=east,  y=up, z=north
    this._scene.rotateX(Math.PI / 2);                            // y-up → mercator up
    this._scene.scale.multiply(new THREE.Vector3(1, 1, -1));     // z → north

    // Lighting
    const light = new THREE.DirectionalLight(0xffffff, 0.9);
    light.position.set(50, 70, -30).normalize();
    this._scene.add(light);
    this._scene.add(new THREE.AmbientLight(0xffffff, 0.6));

    // Compute the scene origin's mercator transform (matrix `l`)
    const originMC = maplibregl.MercatorCoordinate.fromLngLat(SCENE_ORIGIN, 0);
    this._mpu = originMC.meterInMercatorCoordinateUnits();

    // l = translate to origin mercator position, scale metres→mercator
    this._originMatrix = new THREE.Matrix4()
      .makeTranslation(originMC.x, originMC.y, originMC.z)
      .scale(new THREE.Vector3(this._mpu, this._mpu, this._mpu));

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
    this._poleCount = poles.length;
    if (!poles.length) return;

    this._group = new THREE.Group();

    for (const pole of poles) {
      const [lng, lat] = pole.geometry.coordinates;
      const { east, north } = this._metresFromOrigin(lng, lat);

      const mesh = new THREE.Mesh(this._geometry, this._material);
      // Scene space is (x=east, y=up, z=north), in metres.
      // CylinderGeometry is centred on its own origin, Y-axis = height.
      // Position base on ground: lift by half height.
      mesh.position.set(east, POLE_HEIGHT_M / 2, north);
      this._group.add(mesh);
    }

    this._scene.add(this._group);
    console.log('[PoleLayer] rebuilt', poles.length, 'poles');
  }

  render(gl, args) {
    const currentCount = (this.projectStore.poles || []).length;
    if (currentCount !== this._poleCount) {
      this._rebuildMeshes();
    }

    if (!this._group) return;

    // m = MapLibre's projection matrix (mercator → clip space)
    const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
    // l = scene origin world transform (metres → mercator at origin)
    const l = this._originMatrix;

    this._camera.projectionMatrix = m.multiply(l);

    this._renderer.resetState();
    this._renderer.render(this._scene, this._camera);
    this._map.triggerRepaint();
  }

  onRemove() {
    if (this._group)    this._scene.remove(this._group);
    if (this._geometry) this._geometry.dispose();
    if (this._material) this._material.dispose();
    if (this._renderer) this._renderer.dispose();
  }
}

export function createPoleLayer(projectStore) {
  return new PoleLayer(projectStore);
}
