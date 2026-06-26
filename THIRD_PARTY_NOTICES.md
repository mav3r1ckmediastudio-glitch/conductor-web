# Third-Party Notices

Conductor Web includes or depends on third-party software and services. Conductor Web's own code remains proprietary to Paul Walker / Mav3r1ckmediastudio unless a separate written agreement says otherwise.

This notice is intended to preserve acknowledgement of important third-party components. It should be reviewed and updated whenever dependencies or map providers change.

## Direct frontend dependencies

| Component | Version seen in package files | Licence | Purpose |
|---|---:|---|---|
| MapLibre GL JS | 5.24.0 | BSD-3-Clause | Interactive map rendering. |
| shpjs | 6.2.0 | MIT | Reading/importing shapefile data in the browser. |
| Svelte | 5.56.x | MIT | Frontend framework/compiler. |
| Vite | 8.1.0 | MIT | Frontend build tooling. |
| @sveltejs/vite-plugin-svelte | 7.1.2 | MIT | Svelte integration for Vite. |

## Backend dependencies

The backend currently imports FastAPI and CORS middleware. If the backend is deployed or distributed, record the exact backend dependencies in a `requirements.txt` or `pyproject.toml` and keep this notice updated.

| Component | Licence | Purpose |
|---|---|---|
| FastAPI | MIT | Backend API framework. |
| Starlette | BSD-3-Clause | ASGI toolkit used by FastAPI. |
| Pydantic | MIT | Data validation commonly used with FastAPI. |
| Uvicorn | BSD-3-Clause | ASGI server commonly used with FastAPI. |

## Mapping services and data

| Provider / project | Notice |
|---|---|
| MapTiler | Hosted map styles, tiles, terrain, and related services are subject to MapTiler's own terms and attribution requirements. |
| OpenStreetMap contributors | Map data may include OpenStreetMap-derived data. Visible attribution must be preserved where required. |
| MapLibre | Open-source rendering library used for map display. |

## Important transitive dependency families observed in the frontend lockfile

The frontend lockfile also includes dependencies under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, MPL-2.0, 0BSD, and dual MIT/Apache-2.0 style licences. Examples include:

- `@mapbox/*` open-source packages used transitively by mapping libraries.
- `@maplibre/*` packages used by MapLibre GL JS.
- `lightningcss` and platform packages under MPL-2.0.
- Rollup/Rolldown/Vite-related build tooling under permissive licences.
- `proj4`, `pbf`, `geojson` and vector-tile-related tooling used for geospatial processing/rendering.

Do not remove third-party licence files from bundled dependencies. If you distribute compiled builds, keep a copy of this notice with the distributed product.

## Customer responsibility for third-party data/services

A customer's right to use background mapping, address datasets, Ordnance Survey data, OpenStreetMap data, MapTiler services, aerial imagery, or other external data/services is separate from their right to use Conductor Web. Customers may need their own subscriptions, API keys, data licences, or usage permissions.
