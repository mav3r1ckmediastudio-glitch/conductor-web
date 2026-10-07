// wirelessPresets.js — starting values for new wireless assets.
//
// Each kind has selectable presets; the first is the default. Defaults follow
// the Gigaloch Loch Tay architecture: lower-band licensed PtP for the
// site-to-site backhaul trunk (tolerant of distance and rain), 60 GHz for the
// final PtMP hop to customers (short range, but gigabit-capable). The
// alternatives (60 GHz PtP, 5.8 GHz PtMP) stay selectable. Every value stays editable.
//
// SOURCES. Values marked (published) come from a datasheet or regulator
// document; everything else is a TYPICAL planning value for the equipment
// class, not a manufacturer figure. Replace them with the chosen equipment's
// datasheet before a design is built, and have a qualified wireless engineer
// review the result.
//
//  AF60-LR (published): 57-71 GHz, 2160/1080 MHz channels, PtP only, up to
//    12 km, 1.8 Gbps (Ubiquiti datasheet); 38 dBi dish and ~58.1-58.9 dBm EIRP
//    on 64.8/66.96/69.12 GHz (FCC test report, FCC ID SWX-AF60LR); 21 dBm max
//    Tx (reseller spec sheets). Dish diameter 413 mm (datasheet).
//  LTU-Rocket (published): 5 GHz, 29 dBm max conducted Tx, 900+ Mbps maximum
//    throughput shared by the sector, 100+ clients (Ubiquiti datasheet); used
//    with airMAX 5 GHz sectors of 16-22 dBi.
//  UK (published): 5725-5850 MHz fixed wireless access is capped at 4 W
//    (36 dBm) mean EIRP with DFS/TPC (Ofcom IR 2007). Conductor does NOT
//    enforce this; the 5.8 GHz sector preset is set to exactly 36 dBm EIRP.
//    One UK reseller states new 60 GHz PtP installations need an Ofcom
//    Spectrum Access EHF licence: confirm with Ofcom.

export const PRESETS = Object.freeze({
  site: {
    options: [
      { id: 'site-default', name: 'Default site', note: 'Mast or structure height above ground.', values: { mast_height_m: 15 } },
    ],
  },
  link: {
    options: [
      {
        id: 'ptp11',
        name: 'Gigabit backhaul (11 GHz licensed PtP) — default trunk',
        note: 'Typical licensed 11 GHz microwave: negligible air absorption, so much more tolerant of rain and distance than the 60 GHz alternative below — the right choice for the Boreland/Fearnan trunk toward Ardeonaig and Killin. '
          + 'Needs an Ofcom link licence. Values and the 800 Mbps rated capacity are typical for an 80 MHz-class 11 GHz PDH/Ethernet microwave, not a specific product: replace with your chosen radio\'s datasheet.',
        values: {
          freq_ghz: 11, channel_width_mhz: 80, rated_capacity_mbps: 800,
          tx_power_a_dbm: 23, gain_a_dbi: 38, rx_sensitivity_a_dbm: -58, cable_loss_a_db: 0,
          tx_power_b_dbm: 23, gain_b_dbi: 38, rx_sensitivity_b_dbm: -58, cable_loss_b_db: 0,
        },
      },
      {
        id: 'af60lr',
        name: '60 GHz PtP (airFiber 60 LR class)',
        note: 'Channel 69.12 GHz is the top channel, where oxygen absorption is lowest (about 0.6 dB/km; at 64.8 GHz it is 4.4 and at 60.5 GHz about 15). '
          + '38 dBi dish, 21 dBm Tx and 1.8 Gbps rated capacity are published (Ubiquiti datasheet; FCC report, reseller specs for Tx/gain). Rx sensitivity -70 dBm is a planning value for a mid data rate, not a datasheet figure: use the value for the rate you need. '
          + 'Rain fade is severe at 60-70 GHz: links are judged on rain availability (ITU-R P.530/P.838, Engineering thresholds), and distance is short compared with 11 GHz. Check UK licensing with Ofcom.',
        values: {
          freq_ghz: 69.12, channel_width_mhz: 2160, rated_capacity_mbps: 1800,
          tx_power_a_dbm: 21, gain_a_dbi: 38, rx_sensitivity_a_dbm: -70, cable_loss_a_db: 0,
          tx_power_b_dbm: 21, gain_b_dbi: 38, rx_sensitivity_b_dbm: -70, cable_loss_b_db: 0,
        },
      },
    ],
  },
  sector: {
    // Azimuth is deliberately not preset: it is aimed from the premises (or dragged on the map).
    options: [
      {
        id: 'ptmp60',
        name: '60 GHz PtMP access (short range, gigabit) — default customer link',
        note: 'Typical 60 GHz sector for gigabit to the home: reach is a few hundred metres and needs a clear view, because of 60 GHz oxygen absorption (modelled). Values are typical, not a specific product.',
        values: {
          freq_ghz: 60, beamwidth_deg: 90, tx_power_dbm: 20, gain_dbi: 18, cable_loss_db: 0,
          antenna_height_m: 15, range_m: 1500,
          cpe_height_m: 6, cpe_gain_dbi: 36, cpe_min_rx_dbm: -65,
        },
      },
      {
        id: 'ptmp5',
        name: '5.8 GHz PtMP access (LTU Rocket + sector class)',
        note: 'Radio: LTU Rocket class (29 dBm max Tx, 900+ Mbps shared across the whole sector, published). Tx is set to 19 dBm so that with a 17 dBi 90° sector (airMAX sectors are 16-22 dBi, published) the EIRP is 36 dBm, the UK 4 W limit for 5725-5850 MHz. '
          + 'Customer dish 24 dBi and -75 dBm minimum Rx are typical planning values. Reach is many km but customers share one sector, and far below gigabit: use this only where 60 GHz range or line-of-sight will not work.',
        values: {
          freq_ghz: 5.8, beamwidth_deg: 90, tx_power_dbm: 19, gain_dbi: 17, cable_loss_db: 0,
          antenna_height_m: 15, range_m: 5000,
          cpe_height_m: 6, cpe_gain_dbi: 24, cpe_min_rx_dbm: -75,
        },
      },
    ],
  },
});

/** All presets for a kind, default first. */
export function presetOptions(kind) { return PRESETS[kind]?.options || []; }

/** One preset: by id, or the kind's default. */
export function presetFor(kind, id) {
  const o = presetOptions(kind);
  return (id && o.find(p => p.id === id)) || o[0] || null;
}
