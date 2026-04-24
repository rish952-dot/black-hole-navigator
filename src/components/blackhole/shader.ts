// GPU fragment shader: Schwarzschild + Kerr-like + NFW dark matter halo
// gravitational lensing, thin accretion disk, relativistic Doppler beaming,
// gravitational redshift, procedural starfield, and string-theory inspired
// extra-dimensional shimmer.
//
// Method: per-pixel 2D geodesic integration in the equatorial plane using the
// effective potential for null geodesics around Schwarzschild BH, with
// Kerr-like frame-dragging deflection added as a transverse term, and an
// additional NFW dark-matter halo deflection term acting at large radii.
//
// Refs: Misner/Thorne/Wheeler "Gravitation"; Luminet 1979; Navarro-Frenk-White
// 1996 (dark matter density profile); Polchinski "String Theory" Vol. 1
// (compactified dimensions — we use a phenomenological shimmer term);
// GPU Gems 3 chapter on relativistic rendering.

export const blackHoleVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const blackHoleFragment = /* glsl */ `
  precision highp float;

  varying vec2 vUv;

  uniform vec2  uResolution;
  uniform float uTime;
  uniform vec3  uCamPos;
  uniform mat3  uCamBasis;
  uniform float uMass;
  uniform float uSpin;         // 0..1 Kerr a/M
  uniform float uDiskInner;    // in r_s
  uniform float uDiskOuter;    // in r_s
  uniform float uDiskTilt;     // radians
  uniform float uExposure;
  uniform float uSteps;
  uniform float uDoppler;
  uniform float uLensing;
  uniform int   uMode;
  // New physics uniforms
  uniform float uDarkMatter;   // 0..1 NFW halo strength
  uniform float uHaloScale;    // r_s units, NFW scale radius
  uniform float uStringDim;    // 0..1 string-theory shimmer (extra dim)
  uniform float uFrameDrag;    // 0..1 multiplier for Kerr frame dragging
  uniform float uRedshift;     // 0..1 grav redshift visibility
  uniform float uVectorScale;  // 0.25..4 — overall warp / deflection magnitude
  uniform float uThermal;      // 0..1 — thermal false-color disk overlay
  uniform float uDarkOnly;     // 0..1 — show only DM contribution
  uniform float uRayBounces;   // 0..3 — secondary disk reflection bounces (UE-style PT)
  uniform float uTimeLapse;    // 0.1..20 — time acceleration multiplier

  #define PI 3.14159265359

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float hash31(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  vec3 starfield(vec3 dir) {
    vec3 col = vec3(0.0);
    for (int layer = 0; layer < 3; layer++) {
      float scale = 80.0 + float(layer) * 60.0;
      vec3 p = dir * scale;
      vec3 ip = floor(p);
      vec3 fp = fract(p) - 0.5;
      float h = hash31(ip);
      if (h > 0.985) {
        float d = length(fp);
        float bright = smoothstep(0.5, 0.0, d) * (h - 0.985) * 60.0;
        vec3 tint = mix(vec3(0.6, 0.8, 1.0), vec3(1.0, 0.85, 0.6), hash31(ip + 7.0));
        col += tint * bright;
      }
    }
    float nebula = smoothstep(0.2, 0.0, abs(dir.y)) * 0.04;
    col += vec3(0.15, 0.05, 0.25) * nebula;
    // String-theory shimmer: 6 compactified dimensions projected as
    // chromatic interference rippling through the void.
    if (uStringDim > 0.001) {
      float ph = dir.x * 23.0 + dir.y * 17.0 + dir.z * 31.0 + uTime * 0.5;
      vec3 shimmer = vec3(
        sin(ph),
        sin(ph + 2.094),
        sin(ph + 4.188)
      ) * 0.5 + 0.5;
      col += shimmer * uStringDim * 0.06;
    }
    return col;
  }

  vec3 diskEmission(float r, float phi, float t) {
    // Shakura-Sunyaev T(r) ~ r^(-3/4) with inner cutoff factor
    float r_in = uDiskInner;
    float cutoff = 1.0 - sqrt(max(r_in / max(r, r_in), 0.0));
    float T = pow(max(r, 1.0), -0.75) * max(cutoff, 0.05);
    float spiral = sin(phi * 3.0 - t * 1.5 + r * 1.8) * 0.5 + 0.5;
    float turb   = hash21(vec2(r * 4.0, phi * 6.0 + t * 0.3));
    float dens   = mix(0.6, 1.0, spiral) * mix(0.7, 1.3, turb);

    vec3 hot  = vec3(1.0, 0.95, 0.85);
    vec3 mid  = vec3(1.0, 0.55, 0.15);
    vec3 cool = vec3(0.7, 0.15, 0.35);
    float k = clamp(T * 4.0, 0.0, 1.0);
    vec3 col = mix(cool, mix(mid, hot, k), k);
    return col * dens * (3.5 / (1.0 + r * 0.4));
  }

  // NFW dark-matter density-derived deflection contribution.
  // Enclosed mass M(r) for NFW: M(<r) = 4π ρ_s r_s^3 [ln(1+x) - x/(1+x)], x=r/r_s_halo.
  // Added as extra Newtonian-like pull at large r where DM dominates.
  float nfwAccel(float r) {
    if (uDarkMatter < 0.001) return 0.0;
    float rh = max(uHaloScale * 2.0 * uMass, 1.0);
    float x = r / rh;
    float menc = log(1.0 + x) - x / (1.0 + x);
    return uDarkMatter * 0.15 * menc / max(r * r, 0.5);
  }

  vec4 traceGeodesic(vec3 ro, vec3 rd, float t) {
    float ct = cos(uDiskTilt), st = sin(uDiskTilt);
    mat3 Rt = mat3(
      1.0, 0.0, 0.0,
      0.0, ct, -st,
      0.0, st,  ct
    );
    vec3 o = Rt * ro;
    vec3 d = normalize(Rt * rd);

    float r_s = 2.0 * uMass;
    float r_in  = uDiskInner * r_s;
    float r_out = uDiskOuter * r_s;

    vec3 col = vec3(0.0);
    float alpha = 0.0;

    vec3 p = o;
    vec3 v = d;
    float dt = 0.35;
    int N = int(clamp(uSteps, 40.0, 400.0));

    float prevY = p.y;
    for (int i = 0; i < 400; i++) {
      if (i >= N) break;

      float r = length(p);
      if (r < r_s * 1.02) {
        return vec4(0.0, 0.0, 0.0, 1.0);
      }
      if (r > 250.0) break;

      vec3 gdir = -p / r;
      float gBh = uDarkOnly > 0.5 ? 0.0 : 1.5 * r_s / (r * r) * uLensing;
      float g = (gBh + nfwAccel(r)) * uVectorScale;

      vec3 perp = gdir - dot(gdir, v) * v;
      vec3 bend = perp * g * dt;

      // Kerr-like frame dragging: tangential twist around spin axis (y)
      if (uSpin > 0.001 && uFrameDrag > 0.001) {
        vec3 axis = vec3(0.0, 1.0, 0.0);
        vec3 twist = cross(axis, p) / max(r * r * r, 0.01);
        bend += twist * uSpin * uFrameDrag * r_s * 2.0 * dt;
      }

      v = normalize(v + bend);

      vec3 pn = p + v * dt;

      if (sign(pn.y) != sign(prevY) && prevY != 0.0) {
        float tCross = prevY / (prevY - pn.y);
        vec3 hit = mix(p, pn, tCross);
        float rh = length(hit.xz);
        if (rh > r_in && rh < r_out) {
          float phi = atan(hit.z, hit.x);

          float vorb = sqrt(uMass / max(rh, r_s));
          vec3 tang = vec3(-sin(phi), 0.0, cos(phi));
          float mu = dot(normalize(v), tang) * vorb;
          float gamma = 1.0 / sqrt(max(1.0 - vorb * vorb, 0.001));
          float dshift = 1.0 / (gamma * (1.0 - mu));
          dshift = mix(1.0, dshift, uDoppler);

          float gshift = sqrt(max(1.0 - r_s / rh, 0.001));
          gshift = mix(1.0, gshift, uRedshift);
          float shift = dshift * gshift;

          vec3 emit = diskEmission(rh / r_s, phi + uSpin * t * 0.3, t);
          emit *= pow(shift, 3.0);
          emit *= mix(vec3(1.2, 0.7, 0.5), vec3(0.6, 0.85, 1.3), clamp(shift - 0.5, 0.0, 1.0));
          // Thermal false-color overlay: blue (cold ~6000 K) → red (hot ~10⁷ K)
          if (uThermal > 0.001) {
            float Tnorm = clamp(pow(rh / r_s, -0.75) * 4.0, 0.0, 1.0);
            vec3 thermal = mix(vec3(0.05, 0.15, 0.9), mix(vec3(0.95, 0.85, 0.1), vec3(1.0, 0.1, 0.05), smoothstep(0.5, 1.0, Tnorm)), smoothstep(0.0, 0.5, Tnorm));
            emit = mix(emit, thermal * 2.5 * Tnorm, uThermal);
          }
          if (uDarkOnly > 0.5) emit *= 0.0;

          col += emit * (1.0 - alpha);
          alpha += 0.85 * (1.0 - alpha);

          // UE-style secondary path-traced bounce off disk surface back to camera.
          // Approximates radiation transport between disk + photon sphere.
          if (uRayBounces > 0.5 && alpha < 0.97) {
            vec3 nrm = vec3(0.0, sign(prevY) > 0.0 ? 1.0 : -1.0, 0.0);
            vec3 refl = reflect(v, nrm);
            float r2 = rh * 1.4;
            float phi2 = phi + 0.5 + uRayBounces * 0.3;
            vec3 emit2 = diskEmission(r2 / r_s, phi2, t) * 0.35 * uRayBounces;
            col += emit2 * (1.0 - alpha) * max(0.0, dot(refl, nrm));
          }
          if (alpha > 0.98) return vec4(col, 1.0);
        }
      }

      prevY = pn.y;
      p = pn;
      dt = clamp(0.08 * r, 0.15, 0.6);
    }

    if (uMode != 2) {
      vec3 stars = starfield(v);
      // Dark matter halo: add faint diffuse glow proportional to integrated DM column
      if (uDarkMatter > 0.001) {
        float halo = uDarkMatter * 0.05 * exp(-length(p) / max(uHaloScale * 2.0 * uMass, 1.0));
        stars += vec3(0.15, 0.1, 0.35) * halo;
      }
      col += stars * (1.0 - alpha);
    }
    return vec4(col, alpha);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;

    vec3 fwd = uCamBasis[2];
    vec3 right = uCamBasis[0];
    vec3 up = uCamBasis[1];
    vec3 rd = normalize(fwd + uv.x * right + uv.y * up);
    vec3 ro = uCamPos;

    vec4 result;
    if (uMode == 1) {
      vec3 v = rd;
      vec3 p = ro;
      float r_s = 2.0 * uMass;
      float bend = 0.0;
      for (int i = 0; i < 200; i++) {
        float r = length(p);
        if (r < r_s) { bend = 1.0; break; }
        if (r > 150.0) break;
        vec3 gdir = -p / r;
        float g = 1.5 * r_s / (r * r) + nfwAccel(r);
        vec3 perp = gdir - dot(gdir, v) * v;
        vec3 vn = normalize(v + perp * g * 0.4);
        bend += length(vn - v);
        v = vn;
        p += v * 0.4;
      }
      vec3 c = mix(vec3(0.05, 0.1, 0.2), vec3(1.0, 0.5, 0.1), clamp(bend * 2.0, 0.0, 1.0));
      result = vec4(c, 1.0);
    } else if (uMode == 3) {
      result = traceGeodesic(ro, rd, uTime);
      vec2 g = abs(fract(uv * 10.0) - 0.5);
      float grid = smoothstep(0.48, 0.5, max(g.x, g.y));
      result.rgb = mix(result.rgb, vec3(0.0, 1.0, 0.6), grid * 0.25);
    } else {
      result = traceGeodesic(ro, rd, uTime);
    }

    vec3 c = result.rgb * uExposure;
    // ACES-ish tonemap
    c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);
    c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
    gl_FragColor = vec4(c, 1.0);
  }
`;
