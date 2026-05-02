// blackhole-physics — server-side analytic readouts for the current
// black-hole parameters. Keeps heavy or shareable physics math off the
// client and gives a stable surface that future features (logging,
// aggregation, AI prompts) can consume.
//
// Inputs (all optional, sane defaults):
//   { mass, spin, diskInner, diskOuter, darkMatter, haloScale }
//
// Returns analytic quantities in geometrized units (G = c = 1) plus a few
// derived dimensionful values assuming M is in solar masses:
//   r_s, r_isco (prograde Kerr), r_photon, omega_ISCO, hawkingTemp_K,
//   bekensteinHawkingEntropy, gwRingdownHz, nfwEnclosedMass,
//   diskLuminosityFraction.

import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

interface Input {
  mass?: number;        // in M_sun
  spin?: number;        // 0..1
  diskInner?: number;   // r_s units
  diskOuter?: number;   // r_s units
  darkMatter?: number;  // 0..1 strength
  haloScale?: number;   // r_s units
}

const G = 6.67430e-11;
const C = 2.998e8;
const HBAR = 1.0545718e-34;
const KB = 1.380649e-23;
const MSUN = 1.98847e30;

function num(x: unknown, d: number, lo: number, hi: number): number {
  const n = typeof x === "number" && Number.isFinite(x) ? x : d;
  return Math.min(hi, Math.max(lo, n));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const inp = body as Input;

    const M = num(inp.mass, 1, 0.1, 1e10);                 // solar masses
    const a = num(inp.spin, 0.6, 0, 0.999);                // dimensionless
    const diskInner = num(inp.diskInner, 3, 1.5, 50);      // r_s
    const diskOuter = num(inp.diskOuter, 12, diskInner + 0.1, 200);
    const darkMatter = num(inp.darkMatter, 0, 0, 1);
    const haloScale = num(inp.haloScale, 20, 1, 200);      // r_s

    // ----- Schwarzschild basics -----
    const r_s_m = (2 * G * M * MSUN) / (C * C);  // metres
    const r_s = 2;                               // in mass units (G = c = 1)
    const r_photon = 3;                          // photon sphere in M

    // ----- Kerr ISCO (prograde) — Bardeen, Press, Teukolsky 1972 -----
    const Z1 = 1 + Math.cbrt(1 - a * a) * (Math.cbrt(1 + a) + Math.cbrt(1 - a));
    const Z2 = Math.sqrt(3 * a * a + Z1 * Z1);
    const r_isco = 3 + Z2 - Math.sign(1) * Math.sqrt((3 - Z1) * (3 + Z1 + 2 * Z2));

    // ----- ISCO orbital angular velocity (geodesic, equatorial) -----
    const omega_isco = 1 / (Math.pow(r_isco, 1.5) + a);

    // ----- Hawking temperature (Schwarzschild approx) -----
    // T_H = ħc³ / (8π G M k_B)
    const hawkingTemp_K = (HBAR * C ** 3) / (8 * Math.PI * G * M * MSUN * KB);

    // ----- Bekenstein-Hawking entropy: S = A k_B c³ / (4 ħ G) -----
    const A = 4 * Math.PI * r_s_m * r_s_m;
    const bekensteinHawkingEntropy = (A * KB * C ** 3) / (4 * HBAR * G);

    // ----- Ringdown dominant l=m=2 mode frequency (Kerr fit, Berti+ 2006) -----
    // f ≈ (1 / 2π M) · [1.5251 - 1.1568 (1 - a)^0.1292]  in geometric units
    // Convert to Hz: f_Hz = f_geom · c³ / (G M)
    const fGeom = 1.5251 - 1.1568 * Math.pow(1 - a, 0.1292);
    const gwRingdownHz = (fGeom * C ** 3) / (2 * Math.PI * G * M * MSUN);

    // ----- Ringdown damping time τ -----
    const QGeom = 0.7 + 1.4187 * Math.pow(1 - a, -0.4990); // Berti fit
    const tauSec = QGeom / (Math.PI * gwRingdownHz);

    // ----- Disk radiative efficiency at given inner radius -----
    // η = 1 - sqrt(1 - 2/(3 r_isco_M))  (Novikov-Thorne, schematic)
    const diskEfficiency = 1 - Math.sqrt(Math.max(0, 1 - 2 / (3 * r_isco)));

    // Eddington luminosity (W) for reference
    const L_edd = (4 * Math.PI * G * M * MSUN * 1.673e-27 * C) / 6.652e-29;

    // ----- NFW enclosed mass at r = haloScale * r_s (dimensionless) -----
    // M(<r) ∝ ln(1+x) - x/(1+x)
    const x = haloScale * r_s / Math.max(haloScale * r_s, 1e-3);
    const nfwEnclosedDimless = Math.log(1 + x) - x / (1 + x);
    const nfwContribution = darkMatter * nfwEnclosedDimless;

    const out = {
      ok: true,
      ts: Date.now(),
      input: { mass: M, spin: a, diskInner, diskOuter, darkMatter, haloScale },
      geometric: {
        r_s,
        r_isco,
        r_photon,
        omega_isco,
        diskInner,
        diskOuter,
      },
      dimensionful: {
        r_s_m,
        r_s_km: r_s_m / 1000,
        hawkingTemp_K,
        bekensteinHawkingEntropy,
        gwRingdownHz,
        ringdownDampingSec: tauSec,
        eddingtonLuminosity_W: L_edd,
      },
      disk: {
        radiativeEfficiency: diskEfficiency,
        luminosityFractionOfEdd: diskEfficiency * 0.1, // schematic
      },
      darkMatter: {
        nfwEnclosedDimless,
        contribution: nfwContribution,
      },
      notes: [
        "Geometric units: G = c = 1, lengths in M.",
        "Hawking + entropy use Schwarzschild approximation.",
        "Ringdown via Berti, Cardoso, Will (2006) fits.",
        "ISCO via Bardeen-Press-Teukolsky (1972) prograde.",
      ],
    };

    return new Response(JSON.stringify(out), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("blackhole-physics error", e);
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
