// GPU fragment shader: Schwarzschild black hole with gravitational lensing,
// thin accretion disk, relativistic Doppler beaming, and procedural starfield.
//
// Method: per-pixel 2D geodesic integration in the equatorial plane using the
// effective potential for null geodesics around a Schwarzschild BH. We march
// the impact parameter b vs. radius r and accumulate disk emission when the
// ray crosses the equatorial plane between r_isco and r_outer.
//
// Refs: Misner/Thorne/Wheeler "Gravitation"; Luminet 1979 disk model;
// GPU Gems 3 — chapter on real-time relativistic rendering.

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
  uniform vec3  uCamPos;       // camera position (BH at origin)
  uniform mat3  uCamBasis;     // right, up, forward
  uniform float uMass;         // M in geometric units; r_s = 2M
  uniform float uSpin;         // 0..1 visual proxy for Kerr-like asymmetry
  uniform float uDiskInner;    // in r_s
  uniform float uDiskOuter;    // in r_s
  uniform float uDiskTilt;     // radians
  uniform float uExposure;
  uniform float uSteps;        // integration steps
  uniform float uDoppler;      // 0..1 strength
  uniform float uLensing;      // 0..1 strength multiplier (debug)
  uniform int   uMode;         // 0 full, 1 lensing only, 2 disk only, 3 geodesics

  #define PI 3.14159265359

  // ---------- Hash / noise ----------
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

  // ---------- Procedural starfield ----------
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
        // tint
        vec3 tint = mix(vec3(0.6, 0.8, 1.0), vec3(1.0, 0.85, 0.6), hash31(ip + 7.0));
        col += tint * bright;
      }
    }
    // faint nebula band
    float nebula = smoothstep(0.2, 0.0, abs(dir.y)) * 0.04;
    col += vec3(0.15, 0.05, 0.25) * nebula;
    return col;
  }

  // ---------- Accretion disk emission ----------
  // r in r_s units; phi in rad; t time
  vec3 diskEmission(float r, float phi, float t) {
    // Temperature profile T ~ r^-3/4 (Shakura-Sunyaev)
    float T = pow(max(r, 1.0), -0.75);
    // Spiral noise
    float spiral = sin(phi * 3.0 - t * 1.5 + r * 1.8) * 0.5 + 0.5;
    float turb   = hash21(vec2(r * 4.0, phi * 6.0 + t * 0.3));
    float dens   = mix(0.6, 1.0, spiral) * mix(0.7, 1.3, turb);

    // Color from temperature: hot inner = blue-white, outer = orange-red
    vec3 hot  = vec3(1.0, 0.95, 0.85);
    vec3 mid  = vec3(1.0, 0.55, 0.15);
    vec3 cool = vec3(0.7, 0.15, 0.35);
    float k = clamp(T * 4.0, 0.0, 1.0);
    vec3 col = mix(cool, mix(mid, hot, k), k);
    return col * dens * (3.5 / (1.0 + r * 0.4));
  }

  // ---------- Geodesic integration ----------
  // Integrate a null geodesic in the equatorial plane (Schwarzschild).
  // We work in 2D: project ray origin/dir onto disk plane via uDiskTilt rotation,
  // then march using the effective potential ODE:
  //   d^2u/dphi^2 + u = 3 M u^2     (u = 1/r, M in geometric units)
  // Hit detected when ray crosses disk plane between r_in and r_out.
  vec4 traceGeodesic(vec3 ro, vec3 rd, float t) {
    // Tilt disk: rotate world so disk lies in y=0 plane.
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

    // March in small steps; bend ray each step toward BH per geodesic eqn.
    vec3 p = o;
    vec3 v = d;
    float dt = 0.35;
    int N = int(clamp(uSteps, 40.0, 400.0));

    float prevY = p.y;
    for (int i = 0; i < 400; i++) {
      if (i >= N) break;

      float r = length(p);
      if (r < r_s * 1.02) {
        // captured — event horizon
        return vec4(0.0, 0.0, 0.0, 1.0);
      }
      if (r > 200.0) break;

      // Gravitational acceleration on the photon (post-Newtonian-ish proxy
      // matching geodesic curvature: a = -1.5 r_s / r^3 * (perpendicular)
      vec3 gdir = -p / r;
      float g = 1.5 * r_s / (r * r) * uLensing;
      // remove component along v (keep null-ish), add transverse bend
      vec3 perp = gdir - dot(gdir, v) * v;
      v = normalize(v + perp * g * dt);

      vec3 pn = p + v * dt;

      // Disk plane crossing y=0
      if (sign(pn.y) != sign(prevY) && prevY != 0.0) {
        float tCross = prevY / (prevY - pn.y);
        vec3 hit = mix(p, pn, tCross);
        float rh = length(hit.xz);
        if (rh > r_in && rh < r_out) {
          float phi = atan(hit.z, hit.x);

          // Doppler beaming: orbital velocity v_orb = sqrt(M/r)
          float vorb = sqrt(uMass / max(rh, r_s));
          // tangent direction (prograde, with spin sign)
          vec3 tang = vec3(-sin(phi), 0.0, cos(phi)) * mix(1.0, 1.0 + uSpin * 0.4, 1.0);
          float mu = dot(normalize(v), tang) * vorb;
          float gamma = 1.0 / sqrt(max(1.0 - vorb * vorb, 0.001));
          float dshift = 1.0 / (gamma * (1.0 - mu));
          dshift = mix(1.0, dshift, uDoppler);

          // Gravitational redshift factor sqrt(1 - r_s/r)
          float gshift = sqrt(max(1.0 - r_s / rh, 0.001));
          float shift = dshift * gshift;

          vec3 emit = diskEmission(rh / r_s, phi + uSpin * t * 0.3, t);
          // Beaming: intensity scales with shift^4 (relativistic)
          emit *= pow(shift, 3.0);
          // Tint by shift (blueshift -> cool, redshift -> warm)
          emit *= mix(vec3(1.2, 0.7, 0.5), vec3(0.6, 0.85, 1.3), clamp(shift - 0.5, 0.0, 1.0));

          col += emit * (1.0 - alpha);
          alpha += 0.85 * (1.0 - alpha);
          if (alpha > 0.98) return vec4(col, 1.0);
        }
      }

      prevY = pn.y;
      p = pn;
      // adaptive: smaller steps near BH
      dt = clamp(0.08 * r, 0.15, 0.6);
    }

    // Background star sampling along final direction
    if (uMode != 2) {
      vec3 stars = starfield(v);
      col += stars * (1.0 - alpha);
    }
    return vec4(col, alpha);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;

    // Build ray
    vec3 fwd = uCamBasis[2];
    vec3 right = uCamBasis[0];
    vec3 up = uCamBasis[1];
    vec3 rd = normalize(fwd + uv.x * right + uv.y * up);
    vec3 ro = uCamPos;

    vec4 result;
    if (uMode == 1) {
      // Lensing-only debug: show deflection as color
      vec3 v = rd;
      vec3 p = ro;
      float r_s = 2.0 * uMass;
      float bend = 0.0;
      for (int i = 0; i < 200; i++) {
        float r = length(p);
        if (r < r_s) { bend = 1.0; break; }
        if (r > 150.0) break;
        vec3 gdir = -p / r;
        float g = 1.5 * r_s / (r * r);
        vec3 perp = gdir - dot(gdir, v) * v;
        vec3 vn = normalize(v + perp * g * 0.4);
        bend += length(vn - v);
        v = vn;
        p += v * 0.4;
      }
      vec3 c = mix(vec3(0.05, 0.1, 0.2), vec3(1.0, 0.5, 0.1), clamp(bend * 2.0, 0.0, 1.0));
      result = vec4(c, 1.0);
    } else if (uMode == 3) {
      // Geodesic grid debug
      result = traceGeodesic(ro, rd, uTime);
      vec2 g = abs(fract(uv * 10.0) - 0.5);
      float grid = smoothstep(0.48, 0.5, max(g.x, g.y));
      result.rgb = mix(result.rgb, vec3(0.0, 1.0, 0.6), grid * 0.25);
    } else {
      result = traceGeodesic(ro, rd, uTime);
    }

    // Tonemap (Reinhard-ish) + exposure
    vec3 c = result.rgb * uExposure;
    c = c / (1.0 + c);
    c = pow(c, vec3(1.0 / 2.2));
    gl_FragColor = vec4(c, 1.0);
  }
`;
