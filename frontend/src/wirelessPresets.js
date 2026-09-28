// wirelessPresets.js — starting values for new wireless assets.
//
// Gigaloch target: a 1 Gbps service to premises around the loch.
//   * Links (backhaul): licensed 11 GHz point-to-point microwave, the usual
//     choice for gigabit hops of several km in UK rain conditions.
//   * Sectors (customer access): 60 GHz point-to-multipoint, the usual
//     gigabit-to-the-home wireless band. Short range (typically hundreds of
//     metres to ~1 km) because oxygen absorbs ~15 dB/km near 60 GHz; that loss
//     is modelled (see wirelessSettings oxygen band).
//
// These are TYPICAL values for that class of equipment, not a specific product.
// Every field stays editable, and a qualified wireless engineer should replace
// them with the chosen equipment's datasheet figures before a design is built.

export const PRESETS = Object.freeze({
  site: {
    name: 'Default site',
    values: { mast_height_m: 15 },
  },
  link: {
    name: 'Gigabit backhaul (11 GHz licensed PtP)',
    values: {
      freq_ghz: 11, channel_width_mhz: 80,
      tx_power_a_dbm: 23, gain_a_dbi: 38, rx_sensitivity_a_dbm: -58, cable_loss_a_db: 0,
      tx_power_b_dbm: 23, gain_b_dbi: 38, rx_sensitivity_b_dbm: -58, cable_loss_b_db: 0,
    },
  },
  sector: {
    name: 'Gigabit access (60 GHz PtMP)',
    // Azimuth is deliberately not preset: it depends on where the premises are.
    values: {
      freq_ghz: 60, beamwidth_deg: 90, tx_power_dbm: 20, gain_dbi: 25, cable_loss_db: 0,
      antenna_height_m: 15, range_m: 1500,
      cpe_height_m: 6, cpe_gain_dbi: 36, cpe_min_rx_dbm: -65,
    },
  },
});

export function presetFor(kind) { return PRESETS[kind] || null; }
