import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { blackHoleFragment, blackHoleVertex } from "./shader";

export interface BlackHoleParams {
  mass: number;
  spin: number;
  diskInner: number;
  diskOuter: number;
  diskTilt: number;
  exposure: number;
  steps: number;
  doppler: number;
  lensing: number;
  mode: 0 | 1 | 2 | 3;
  cameraDistance: number;
  cameraOrbit: number;
  cameraElevation: number;
  autoRotate: boolean;
  // New physics
  darkMatter: number;
  haloScale: number;
  stringDim: number;
  frameDrag: number;
  redshift: number;
}

export const defaultParams: BlackHoleParams = {
  mass: 1.0,
  spin: 0.6,
  diskInner: 3.0,
  diskOuter: 12.0,
  diskTilt: 1.05,
  exposure: 1.4,
  steps: 180,
  doppler: 1.0,
  lensing: 1.0,
  mode: 0,
  cameraDistance: 22,
  cameraOrbit: 0.6,
  cameraElevation: 0.25,
  autoRotate: true,
  darkMatter: 0.4,
  haloScale: 20.0,
  stringDim: 0.3,
  frameDrag: 1.0,
  redshift: 1.0,
};

interface Props {
  params: BlackHoleParams;
}

export function BlackHoleQuad({ params }: Props) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const { size } = useThree();

  const uniforms = useMemo(
    () => ({
      uResolution: { value: new THREE.Vector2(size.width, size.height) },
      uTime: { value: 0 },
      uCamPos: { value: new THREE.Vector3() },
      uCamBasis: { value: new THREE.Matrix3() },
      uMass: { value: params.mass },
      uSpin: { value: params.spin },
      uDiskInner: { value: params.diskInner },
      uDiskOuter: { value: params.diskOuter },
      uDiskTilt: { value: params.diskTilt },
      uExposure: { value: params.exposure },
      uSteps: { value: params.steps },
      uDoppler: { value: params.doppler },
      uLensing: { value: params.lensing },
      uMode: { value: params.mode },
      uDarkMatter: { value: params.darkMatter },
      uHaloScale: { value: params.haloScale },
      uStringDim: { value: params.stringDim },
      uFrameDrag: { value: params.frameDrag },
      uRedshift: { value: params.redshift },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const u = uniforms;
    u.uTime.value = t;
    u.uResolution.value.set(size.width, size.height);
    u.uMass.value = params.mass;
    u.uSpin.value = params.spin;
    u.uDiskInner.value = params.diskInner;
    u.uDiskOuter.value = params.diskOuter;
    u.uDiskTilt.value = params.diskTilt;
    u.uExposure.value = params.exposure;
    u.uSteps.value = params.steps;
    u.uDoppler.value = params.doppler;
    u.uLensing.value = params.lensing;
    u.uMode.value = params.mode;
    u.uDarkMatter.value = params.darkMatter;
    u.uHaloScale.value = params.haloScale;
    u.uStringDim.value = params.stringDim;
    u.uFrameDrag.value = params.frameDrag;
    u.uRedshift.value = params.redshift;

    const azim = params.cameraOrbit + (params.autoRotate ? t * 0.08 : 0);
    const elev = params.cameraElevation;
    const d = params.cameraDistance;
    const cx = Math.cos(elev) * Math.cos(azim) * d;
    const cy = Math.sin(elev) * d;
    const cz = Math.cos(elev) * Math.sin(azim) * d;
    const pos = new THREE.Vector3(cx, cy, cz);
    u.uCamPos.value.copy(pos);

    const fwd = pos.clone().multiplyScalar(-1).normalize();
    const worldUp = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(fwd, worldUp).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    u.uCamBasis.value.set(
      right.x, up.x, fwd.x,
      right.y, up.y, fwd.y,
      right.z, up.z, fwd.z,
    );
  });

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={blackHoleVertex}
        fragmentShader={blackHoleFragment}
        uniforms={uniforms}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}
