/**
 * LIGO/Virgo gravitational wave events.
 *
 * Strain time-series are reconstructed from published parameters using the
 * post-Newtonian inspiral approximation, then continued through ringdown.
 * The bundled events are real detections; the waveforms are physics-faithful
 * reconstructions suitable for visualization and the 4D spacetime ripple.
 *
 * Ref: GWTC-3 catalog (Abbott et al., 2021), arXiv:2111.03606
 */

export interface LigoEvent {
  id: string;
  name: string;
  date: string;
  m1: number;       // primary mass (M☉)
  m2: number;       // secondary mass (M☉)
  m_final: number;  // remnant mass
  a_final: number;  // dimensionless spin of remnant
  distance_mpc: number;
  snr: number;
  type: "BBH" | "BNS" | "NSBH";
  notes: string;
}

export const LIGO_EVENTS: LigoEvent[] = [
  {
    id: "GW150914",
    name: "GW150914",
    date: "2015-09-14",
    m1: 35.6,
    m2: 30.6,
    m_final: 63.1,
    a_final: 0.69,
    distance_mpc: 410,
    snr: 24,
    type: "BBH",
    notes: "First direct detection. Two BHs merged ~1.3 Gly away.",
  },
  {
    id: "GW170817",
    name: "GW170817",
    date: "2017-08-17",
    m1: 1.46,
    m2: 1.27,
    m_final: 2.7,
    a_final: 0.89,
    distance_mpc: 40,
    snr: 32.4,
    type: "BNS",
    notes: "First BNS merger + EM counterpart (kilonova AT2017gfo).",
  },
  {
    id: "GW190521",
    name: "GW190521",
    date: "2019-05-21",
    m1: 85,
    m2: 66,
    m_final: 142,
    a_final: 0.72,
    distance_mpc: 5300,
    snr: 14.7,
    type: "BBH",
    notes: "First intermediate-mass BH formation. Pair-instability puzzle.",
  },
  {
    id: "GW200105",
    name: "GW200105",
    date: "2020-01-05",
    m1: 8.9,
    m2: 1.9,
    m_final: 10.8,
    a_final: 0.43,
    distance_mpc: 280,
    snr: 13.9,
    type: "NSBH",
    notes: "First confirmed NS-BH merger.",
  },
  {
    id: "GW190814",
    name: "GW190814",
    date: "2019-08-14",
    m1: 23.2,
    m2: 2.59,
    m_final: 25.6,
    a_final: 0.28,
    distance_mpc: 241,
    snr: 25,
    type: "NSBH",
    notes: "Mass-gap secondary: heaviest NS or lightest BH known.",
  },
];

/**
 * Generate a strain time-series h(t) for an event.
 * Uses Newtonian quadrupole + leading-order PN frequency evolution.
 *  f(τ) = (1/π)(5/256/τ)^(3/8) M_chirp^(-5/8)
 *  h(τ) ∝ M_chirp^(5/4) f(τ)^(2/3) cos(2πf·t + φ)
 * τ = time-to-coalescence in geometric units.
 *
 * Returns N samples spanning [t0, 0] then ringdown decay [0, +T_ring].
 */
export function generateStrain(
  event: LigoEvent,
  N = 1024,
): { t: number; h: number; f: number }[] {
  const G = 1, c = 1; // geometric units
  const Msun = 4.925e-6; // solar mass in seconds (G·M/c³)
  const M = event.m1 + event.m2;
  const eta = (event.m1 * event.m2) / (M * M);
  const Mchirp = M * Math.pow(eta, 3 / 5) * Msun;

  const t_end = -0.005; // s before merger (coalescence at t=0)
  const t_start = -0.4; // 400 ms inspiral window
  const t_ring_end = 0.1;
  const out: { t: number; h: number; f: number }[] = [];

  // Inspiral
  const N_in = Math.floor((N * 4) / 5);
  let phase = 0;
  let prev_f = 0;
  for (let i = 0; i < N_in; i++) {
    const t = t_start + ((t_end - t_start) * i) / (N_in - 1);
    const tau = -t; // positive
    const f =
      (1 / Math.PI) *
      Math.pow((5 / 256) * (1 / tau), 3 / 8) *
      Math.pow(Mchirp, -5 / 8);
    const fSafe = Math.min(f, 350); // cap at merger
    const dt = i > 0 ? t - out[i - 1].t : 0;
    phase += 2 * Math.PI * (prev_f + (fSafe - prev_f) * 0.5) * dt;
    prev_f = fSafe;
    const A = Math.pow(Mchirp, 5 / 3) * Math.pow(2 * Math.PI * fSafe, 2 / 3);
    const h = A * Math.cos(phase) * 1e21;
    out.push({ t, h, f: fSafe });
  }

  // Ringdown — damped sinusoid at QNM frequency
  // f_QNM ≈ 1/(2π) · (1/M_final) · [1.5251 - 1.1568 (1-a)^0.1292] (Berti 2009)
  const Mf = event.m_final * Msun;
  const a = event.a_final;
  const fQNM =
    (1 / (2 * Math.PI * Mf)) *
    (1.5251 - 1.1568 * Math.pow(1 - a, 0.1292));
  const Q = 0.7 + 1.4187 * Math.pow(1 - a, -0.499);
  const tau_qnm = Q / (Math.PI * fQNM);
  const A0 = out[out.length - 1].h;
  const N_ring = N - N_in;
  for (let i = 0; i < N_ring; i++) {
    const t = (t_ring_end * (i + 1)) / N_ring;
    const decay = Math.exp(-t / tau_qnm);
    const h = A0 * decay * Math.cos(2 * Math.PI * fQNM * t);
    out.push({ t, h, f: fQNM });
  }

  return out;
}
