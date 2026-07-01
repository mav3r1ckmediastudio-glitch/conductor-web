// htmlEscape.js — Shared HTML-escaping helper for Conductor Web's document
// generators (bom.js, sld.js, splicePlan.js).
//
// WHY THIS EXISTS: those three files each independently define a null-safe
// stringifier, conventionally called S(v), and use it when interpolating
// project data (addresses, notes, closure types, IDs — all ultimately
// sourced from user input or CSV import) directly into HTML strings via
// template literals. S(v) coerces null/undefined to '' but does NOT escape
// HTML special characters, so a CSV-imported address containing e.g. `<` or
// `&` would be inserted into the generated splice plan / BoM / SLD document
// unescaped. Flagged in the 1 Jul independent audit (§3.4).
//
// Practical risk is low — these are locally-generated HTML files opened by
// the same user who imported the data, not served over a network to other
// users — but splice plans specifically are meant to be handed to a
// build/splice team, a real distribution path outside the importing user's
// own browser, so it's worth closing properly rather than leaving as a
// known gap.
//
// escapeHtml(v) is a drop-in replacement for S(v) SPECIFICALLY at the point
// a value is embedded into an HTML string (H.push/B.push/L.push template
// literals, or any string that ends up as the .html document itself). It is
// NOT a replacement for S(v) everywhere — S(v) remains correct and should
// stay unescaped for:
//   - non-HTML uses: filenames (`${S(uprn)}.html` as an actual filename
//     value, not displayed text), object keys, lookup-map keys, comparisons
//   - values returned in a result object for the CALLER to use elsewhere
//     (e.g. generateRouteSplicePlan's returned `address` field) — Svelte's
//     own {expression} template bindings already auto-escape text content,
//     so pre-escaping a value that's also handed back as data would risk
//     double-escaping (a literal "&amp;" appearing on screen instead of "&")
//     wherever the caller uses the raw value outside this module's own HTML.
//
// Escapes the five characters that matter for both HTML text content and
// double-quoted attribute values: & < > " '
export function escapeHtml(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
