# Attribution

Conductor Web uses MapLibre GL JS for interactive map rendering and MapTiler-hosted map services for map styles, tiles, terrain, and related map resources.

## Required visible map attribution

Where a map is displayed, the map attribution must remain visible to the user. At minimum, the map should display:

```text
© MapTiler © OpenStreetMap contributors
```

Depending on the selected MapTiler style, region, dataset, or account type, additional attribution may be required and may be provided automatically by the map style or map library. Do not remove, hide, obscure, or restyle attribution in a way that makes it difficult to read.

## MapTiler

MapTiler provides hosted map styles, tiles, terrain resources, and related map services used by Conductor Web. MapTiler usage remains subject to MapTiler's own terms, account limits, attribution rules, and API-key controls.

## OpenStreetMap

Map data may include OpenStreetMap-derived data. OpenStreetMap contributors must be credited where required.

## MapLibre GL JS

MapLibre GL JS is used as the client-side map renderer. It is an open-source rendering library and is separate from the hosted map-data provider.

## Mapbox

This project currently uses MapLibre GL JS and MapTiler services. It does not currently use Mapbox-hosted map services, Mapbox access tokens, Mapbox styles, or Mapbox GL JS directly. Some MapLibre and mapping-library notices may still reference historical Mapbox-origin code or Mapbox-authored open-source packages. Those notices are retained in THIRD_PARTY_NOTICES.md where applicable.
