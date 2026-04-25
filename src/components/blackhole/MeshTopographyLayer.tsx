import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

export interface TopoField {
  /** Spacetime curvature (0..1+). Drives radial warp depth. */
  curvature: number;
  /** Energy density (0..1+). Drives ripple amplitude + glow. */
  energyDensity: number;
  /** Stability (1 = stable, 0 = chaotic). Modulates noise and color hue. */
  stability: number;
  /** Flow direction in radians (0..2π). Rotates the directional band. */
  flowAngle: number;
  /** Anomaly count — bursts overlaid as red hotspots. */
  anomalies: number;
}

interface Props {
  /** Side length in world units (default 60 — covers the 24-radius tapestry). */
  size?: number;
  /** Tessellation per axis. Adaptive: 64 mobile, 128 desktop is typical. */
  resolution?: number;
  /** Live field readout — typically derived from BlackHoleParams + node state. */
  field: TopoField;
  /** Show wireframe instead of filled surface. */
  wireframe?: boolean;
  /** Visual layer position offset on Y (default -8 — below the tapestry). */
  yOffset?: number;
}

/**
 * MeshTopographyLayer
 *
 * A continuous, GPU-deformed surface that sits below the NeuralTapestry and
 * encodes the live black-hole field as a topology:
 *
 *   - curvature  → radial well depth (Schwarzschild-like funnel)
 *   - energy     → traveling wave amplitude + emissive glow
 *   - stability  → high-freq noise + hue shift (cyan ↔ magenta)
 *   - flowAngle  → directional band sweeping across the surface
 *   - anomalies  → red bursts at quasi-random hotspots
 *
 * One PlaneGeometry (~16 K verts at res=128), one ShaderMaterial, one draw
 * call. All deformation happens in the vertex shader — CPU does nothing per
 * frame except push five uniforms.
 *
 * Drop-in additive: it does not interact with the existing instanced node
 * mesh or edge LineSegments. Render order is set so it always sits behind.
 */
export function MeshTopographyLayer({
  size = 60,
  resolution = 128,
  field,
  wireframe = false,
  yOffset = -8,
}: Props) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.ShaderMaterial>(null);

  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(size, size, resolution, resolution);
    g.rotateX(-Math.PI / 2);
    return g;
  }, [size, resolution]);

  const material = useMemo(() => {
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      wireframe,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uCurvature: { value: field.curvature },
        uEnergy: { value: field.energyDensity },
        uStability: { value: field.stability },
        uFlowAngle: { value: field.flowAngle },
        uAnomalies: { value: field.anomalies },
        uSize: { value: size },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uCurvature;
        uniform float uEnergy;
        uniform float uStability;
        uniform float uFlowAngle;
        uniform float uAnomalies;
        uniform float uSize;

        varying float vHeight;
        varying float vRadial;
        varying float vFlow;
        varying float vAnomaly;
        varying vec2  vUv;

        // Cheap hash noise — no textures, GPU friendly.
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }

        void main() {
          vec3 pos = position;
          vUv = uv;

          // Radial distance from center (XZ plane after rotation).
          float r = length(pos.xz);
          float rNorm = r / (uSize * 0.5);

          // 1) CURVATURE — Schwarzschild-style funnel.  z(r) = -k / (r + e)
          float well = -uCurvature * 4.0 / (r * 0.18 + 0.4);
          well = max(well, -8.0); // clamp to avoid singular spikes

          // 2) ENERGY — traveling wave outward from center.
          float wave = uEnergy * 0.6 *
            sin(r * 0.6 - uTime * 1.4) *
            exp(-rNorm * 1.2);

          // 3) STABILITY — high-freq turbulence inversely proportional to it.
          float chaos = (1.0 - clamp(uStability, 0.0, 1.0)) * 0.7;
          float n = noise(pos.xz * 0.6 + uTime * 0.3) - 0.5;
          float turb = n * chaos;

          // 4) FLOW — directional band sweeping across the surface.
          vec2 dir = vec2(cos(uFlowAngle), sin(uFlowAngle));
          float along = dot(pos.xz, dir);
          float flow = sin(along * 0.4 - uTime * 2.0) * 0.25;
          vFlow = 0.5 + 0.5 * sin(along * 0.4 - uTime * 2.0);

          // 5) ANOMALIES — red bursts at fixed hash hotspots.
          float anomaly = 0.0;
          if (uAnomalies > 0.5) {
            for (int i = 0; i < 6; i++) {
              if (float(i) >= uAnomalies) break;
              float fi = float(i);
              vec2 cp = vec2(
                (hash(vec2(fi, 1.7)) - 0.5) * uSize * 0.7,
                (hash(vec2(fi, 4.3)) - 0.5) * uSize * 0.7
              );
              float d = length(pos.xz - cp);
              float pulse = exp(-d * 0.6) * (0.6 + 0.4 * sin(uTime * 4.0 + fi));
              anomaly += pulse;
            }
          }

          pos.y += well + wave + turb + flow + anomaly * 1.2;

          vHeight = pos.y;
          vRadial = rNorm;
          vAnomaly = anomaly;

          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;

        uniform float uEnergy;
        uniform float uStability;
        uniform float uTime;

        varying float vHeight;
        varying float vRadial;
        varying float vFlow;
        varying float vAnomaly;
        varying vec2  vUv;

        void main() {
          // Base — deep cyan tissue.
          vec3 base = vec3(0.04, 0.10, 0.18);

          // Height-driven glow: cyan in valleys → orange on peaks.
          float h = clamp((vHeight + 6.0) / 8.0, 0.0, 1.0);
          vec3 cool = vec3(0.18, 0.60, 1.00);
          vec3 warm = vec3(1.00, 0.55, 0.20);
          vec3 glow = mix(cool, warm, smoothstep(0.4, 0.95, h));

          // Stability hue shift toward magenta when chaotic.
          vec3 chaos = vec3(0.95, 0.20, 0.80);
          glow = mix(chaos, glow, clamp(uStability, 0.0, 1.0));

          // Flow band lightens with phase.
          float band = smoothstep(0.6, 1.0, vFlow) * 0.6;

          // Anomaly hotspots — bright red.
          vec3 anomalyC = vec3(1.0, 0.15, 0.20) * vAnomaly * 1.6;

          // Radial vignette so edges fade out.
          float vignette = smoothstep(1.05, 0.55, vRadial);

          // Energy adds overall emissive.
          float emissive = uEnergy * 0.4;

          vec3 col = base + glow * (0.6 + h * 0.9) + band * cool + anomalyC;
          col *= vignette;
          col += emissive * cool * vignette;

          // Alpha — additive blending, so this is intensity not opacity.
          float alpha = (0.20 + h * 0.55 + vAnomaly * 0.4 + band * 0.3) * vignette;

          gl_FragColor = vec4(col, alpha);
        }
      `,
    });
    return m;
  }, [wireframe, size]);

  matRef.current = material;

  useFrame((state, dt) => {
    const u = material.uniforms;
    u.uTime.value += dt;
    // Smooth uniforms toward current field — avoids visual jumps when params change.
    u.uCurvature.value += (field.curvature - u.uCurvature.value) * 0.08;
    u.uEnergy.value += (field.energyDensity - u.uEnergy.value) * 0.08;
    u.uStability.value += (field.stability - u.uStability.value) * 0.08;
    u.uFlowAngle.value += (field.flowAngle - u.uFlowAngle.value) * 0.08;
    u.uAnomalies.value += (field.anomalies - u.uAnomalies.value) * 0.12;
  });

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      position={[0, yOffset, 0]}
      renderOrder={-1}
      frustumCulled={false}
    />
  );
}
