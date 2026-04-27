'use client';

import React, { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

type Tile = {
  x: number;
  y: number;
  size: number;
  z: number;
  r: number;
};

function ringTiles(radius: number, count: number, size: number, offset = 0): Tile[] {
  const out: Tile[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2 + offset;
    out.push({
      x: Math.cos(a) * radius,
      y: Math.sin(a) * radius,
      size,
      z: 0.02 + (i % 3) * 0.02,
      r: a + Math.PI / 4,
    });
  }
  return out;
}

function coreGrid(range = 4, step = 0.6, size = 0.24): Tile[] {
  const out: Tile[] = [];
  for (let gx = -range; gx <= range; gx += 1) {
    for (let gy = -range; gy <= range; gy += 1) {
      const d = Math.abs(gx) + Math.abs(gy);
      if (d > range + 1) continue;
      out.push({
        x: gx * step,
        y: gy * step,
        size: size + ((gx + gy + 8) % 3) * 0.03,
        z: 0.05 + (d % 2) * 0.02,
        r: Math.PI / 4,
      });
    }
  }
  return out;
}

function brokenCluster(): Tile[] {
  const out: Tile[] = [];
  for (let i = 0; i < 36; i += 1) {
    const t = i / 35;
    out.push({
      x: -6.8 + t * 3.0 + Math.sin(i * 0.8) * 0.25,
      y: -4.6 + t * 4.8 + Math.cos(i * 0.6) * 0.3,
      size: 0.12 + (i % 6) * 0.035,
      z: 0.16 + (i % 4) * 0.03,
      r: (i % 7) * 0.22,
    });
  }
  return out;
}

function rosetteLines(radius: number, spokes: number): Float32Array {
  const pts: number[] = [];
  const rings = [0.8, 1.35, 2.05, 2.95, 3.85, radius];
  const steps = 150;

  for (const r of rings) {
    for (let i = 0; i < steps; i += 1) {
      const a1 = (i / steps) * Math.PI * 2;
      const a2 = ((i + 1) / steps) * Math.PI * 2;
      pts.push(
        Math.cos(a1) * r,
        Math.sin(a1) * r,
        0.18,
        Math.cos(a2) * r,
        Math.sin(a2) * r,
        0.18,
      );
    }
  }

  for (let i = 0; i < spokes; i += 1) {
    const a = (i / spokes) * Math.PI * 2;
    pts.push(0, 0, 0.18, Math.cos(a) * radius, Math.sin(a) * radius, 0.18);
  }

  return new Float32Array(pts);
}

function TileCloud({ tiles }: { tiles: Tile[] }) {
  return (
    <>
      {tiles.map((tile, idx) => (
        <group
          key={idx}
          position={[tile.x, tile.y, tile.z]}
          rotation={[0, 0, tile.r]}
          scale={[tile.size, tile.size, tile.size * 0.26]}
        >
          <mesh castShadow receiveShadow>
            <boxGeometry args={[1, 1, 0.26]} />
            <meshStandardMaterial color="#f3efe7" roughness={0.52} metalness={0.08} />
          </mesh>
          <mesh position={[0, 0, 0.16]}>
            <planeGeometry args={[0.6, 0.6]} />
            <meshBasicMaterial color="#d6cfbe" transparent opacity={0.5} />
          </mesh>
        </group>
      ))}
    </>
  );
}

function RosetteWire({ positions }: { positions: Float32Array }) {
  return (
    <lineSegments>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color="#efe9de" transparent opacity={0.45} />
    </lineSegments>
  );
}

function Mosaic() {
  const coreRef = useRef<THREE.Group>(null);
  const fragmentsRef = useRef<THREE.Group>(null);

  const tiles = useMemo(
    () => [
      ...ringTiles(0.95, 10, 0.42),
      ...ringTiles(1.8, 16, 0.34, 0.08),
      ...ringTiles(2.7, 22, 0.28, 0.14),
      ...ringTiles(3.55, 30, 0.22, 0.18),
      ...coreGrid(4, 0.6, 0.24),
    ],
    [],
  );

  const fragments = useMemo(() => brokenCluster(), []);
  const wire = useMemo(() => rosetteLines(4.55, 28), []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (coreRef.current) {
      coreRef.current.rotation.z = Math.sin(t * 0.12) * 0.03;
      coreRef.current.rotation.x = Math.cos(t * 0.09) * 0.012;
    }
    if (fragmentsRef.current) {
      fragmentsRef.current.position.x = Math.sin(t * 0.3) * 0.09;
      fragmentsRef.current.position.y = Math.cos(t * 0.22) * 0.08;
      fragmentsRef.current.rotation.z = -0.12 + Math.sin(t * 0.18) * 0.04;
    }
  });

  return (
    <group position={[-1.8, 0.12, 0]}>
      <group ref={coreRef}>
        <TileCloud tiles={tiles} />
        <RosetteWire positions={wire} />
      </group>
      <group ref={fragmentsRef}>
        <TileCloud tiles={fragments} />
      </group>
    </group>
  );
}

export function GeometryMosaicCanvas() {
  return (
    <div className="h-full w-full">
      <Canvas
        dpr={[1, 1.8]}
        camera={{ position: [0, 0, 14], fov: 34 }}
        gl={{ antialias: true, alpha: true }}
        shadows
      >
        <ambientLight intensity={0.86} />
        <directionalLight position={[5, 6, 8]} intensity={1.04} color="#fff8ee" castShadow />
        <directionalLight position={[-4, -3, 5]} intensity={0.44} color="#d2dbef" />
        <Mosaic />
      </Canvas>
    </div>
  );
}
