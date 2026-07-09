"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  VisemeKey,
  VisemeWeights,
  interpolateViseme,
  VisemeFrame,
} from "@/lib/avatar/viseme-map";

export { useAudioEnergy } from "@/lib/avatar/use-audio-energy";

export type AvatarExpression =
  | "neutral"
  | "smile"
  | "concern"
  | "thinking"
  | "encourage"
  | "celebrate";

const EXPRESSION_WEIGHTS: Record<AvatarExpression, Record<string, number>> = {
  neutral: { mouthSmile: 0.0 },
  smile: { mouthSmile: 0.55, mouthStretch: 0.25 },
  concern: { mouthStretch: 0.25, mouthClose: 0.15 },
  thinking: { mouthPucker: 0.1, mouthFunnel: 0.05 },
  encourage: { mouthSmile: 0.7, jawOpen: 0.15 },
  celebrate: { mouthSmile: 0.85, jawOpen: 0.25 },
};

const isVrmUrl = (url: string) => /\.vrm(\?|$)/i.test(url);

type InnerProps = {
  modelUrl: string;
  timeline?: VisemeFrame[];
  isPlaying?: boolean;
  audioRef?: React.RefObject<HTMLAudioElement>;
  currentExpression?: AvatarExpression;
  expressionIntensity?: number;
  lookAt?: { x: number; y: number; z: number } | null;
  energyRef?: React.MutableRefObject<number>;
  onLoaded?: () => void;
  onError?: (err: string) => void;
};

function VrmInner({
  modelUrl,
  timeline,
  isPlaying,
  audioRef,
  currentExpression = "neutral",
  expressionIntensity = 0.6,
  lookAt,
  energyRef,
  onLoaded,
  onError,
}: InnerProps) {
  const [model, setModel] = useState<{ vrm: import("@pixiv/three-vrm").VRM; scene: THREE.Object3D } | null>(null);
  const [loading, setLoading] = useState(true);
  const { camera } = useThree();
  const lastBlinkRef = useRef(0);
  const nextBlinkRef = useRef(2000 + Math.random() * 4000);
  const idlePhaseRef = useRef(Math.random() * Math.PI * 2);
  const exprTargetRef = useRef<Record<string, number>>({});
  const exprCurrentRef = useRef<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { VRMLoaderPlugin } = await import("@pixiv/three-vrm");
        const loader = new GLTFLoader();
        loader.register((parser) => new VRMLoaderPlugin(parser));
        loader.load(
          modelUrl,
          (gltf) => {
            if (cancelled) return;
            const vrm = (gltf as unknown as { userData: { vrm: import("@pixiv/three-vrm").VRM } }).userData.vrm;
            if (!vrm) {
              onError?.("VRM userData missing — model may not be a valid VRM file.");
              setLoading(false);
              return;
            }
            vrm.scene.rotation.y = 0;
            setModel({ vrm, scene: vrm.scene });
            setLoading(false);
            onLoaded?.();
          },
          undefined,
          (err) => {
            if (cancelled) return;
            const msg = err instanceof Error ? err.message : String(err);
            onError?.(msg);
            setLoading(false);
          },
        );
      } catch (err) {
        if (cancelled) return;
        onError?.(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [modelUrl, onLoaded, onError]);

  useEffect(() => {
    if (model?.vrm) {
      const head = model.vrm.humanoid?.getBoneNode("head");
      if (head) camera.lookAt(head.position);
    }
  }, [model, camera]);

  useEffect(() => {
    const target: Record<string, number> = { ...EXPRESSION_WEIGHTS[currentExpression] };
    for (const k in target) target[k] = (target[k] || 0) * Math.max(0, Math.min(1, expressionIntensity));
    exprTargetRef.current = target;
  }, [currentExpression, expressionIntensity]);

  useFrame((state, delta) => {
    if (!model?.vrm) return;
    const time = state.clock.getElapsedTime();
    const deltaMs = delta * 1000;

    if (timeline && isPlaying) {
      let t = 0;
      if (audioRef?.current && !isNaN(audioRef.current.currentTime)) {
        t = audioRef.current.currentTime * 1000;
      }
      const weights = interpolateViseme(timeline, t);
      applyVisemeWeights(model.vrm, weights);
    }

    const mgr = model.vrm.expressionManager;
    if (mgr) {
      const target = exprTargetRef.current;
      const current = exprCurrentRef.current;
      for (const k in target) {
        const want = target[k] || 0;
        const have = current[k] || 0;
        const next = have + (want - have) * Math.min(1, delta * 8);
        current[k] = next;
        try { mgr.setValue(k as never, next); } catch {}
      }
    }

    const head = model.vrm.humanoid?.getBoneNode("head");
    const neck = model.vrm.humanoid?.getBoneNode("neck");
    const energy = energyRef?.current ?? 0;
    const nod = energy * 0.12;
    if (head) {
      let targetY = Math.sin(time * 0.4 + idlePhaseRef.current) * 0.04;
      let targetX = Math.sin(time * 0.27 + idlePhaseRef.current) * 0.025 - nod;
      const targetZ = Math.sin(time * 0.18 + idlePhaseRef.current) * 0.02;
      if (lookAt) {
        const dx = lookAt.x - (head.position.x || 0);
        const dy = lookAt.y - (head.position.y || 1.5);
        const dz = lookAt.z - (head.position.z || 0);
        targetY += Math.atan2(dx, dz) * 0.3;
        targetX += -Math.atan2(dy, Math.sqrt(dx * dx + dz * dz)) * 0.2;
      }
      head.rotation.y += (targetY - head.rotation.y) * 0.06;
      head.rotation.x += (targetX - head.rotation.x) * 0.06;
      head.rotation.z += (targetZ - head.rotation.z) * 0.06;
    }
    if (neck) {
      neck.rotation.x = Math.sin(time * 0.5 + idlePhaseRef.current) * 0.02;
    }
    const torso = model.vrm.humanoid?.getBoneNode("chest") || model.vrm.humanoid?.getBoneNode("spine");
    if (torso) {
      torso.rotation.x = Math.sin(time * 0.6 + idlePhaseRef.current) * 0.015;
    }

    if (timeline && isPlaying) {
      lastBlinkRef.current += deltaMs;
      if (lastBlinkRef.current >= nextBlinkRef.current) {
        lastBlinkRef.current = 0;
        nextBlinkRef.current = 2500 + Math.random() * 4500;
      }
    }
    const blinkProgress = lastBlinkRef.current < 120 ? lastBlinkRef.current / 120 : lastBlinkRef.current < 240 ? 1 - (lastBlinkRef.current - 120) / 120 : 0;
    try {
      const curL = mgr?.getValue?.("blinkLeft" as never) ?? 0;
      const curR = mgr?.getValue?.("blinkRight" as never) ?? 0;
      mgr?.setValue?.("blinkLeft" as never, Math.max(curL, blinkProgress));
      mgr?.setValue?.("blinkRight" as never, Math.max(curR, blinkProgress));
    } catch {}

    model.vrm.update(delta);
  });

  if (loading) return null;
  if (!model) return null;
  return <primitive object={model.scene} />;
}

function GlbInner({
  modelUrl,
  isPlaying,
  audioRef,
  currentExpression = "neutral",
  expressionIntensity = 0.6,
  lookAt,
  energyRef,
  onLoaded,
  onError,
}: InnerProps) {
  const [scene, setScene] = useState<THREE.Object3D | null>(null);
  const [loading, setLoading] = useState(true);
  const { camera } = useThree();
  const idlePhaseRef = useRef(Math.random() * Math.PI * 2);
  const groupRef = useRef<THREE.Group>(null);
  const baseYRef = useRef<number | null>(null);
  const exprColorRef = useRef<{ smile: number }>({ smile: 0 });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const loader = new GLTFLoader();
    loader.load(
      modelUrl,
      (gltf) => {
        if (cancelled) return;
        const s = gltf.scene;
        s.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[];
            if (m) {
              const apply = (mm: THREE.Material) => {
                mm.transparent = false;
                if ("envMapIntensity" in mm) (mm as unknown as { envMapIntensity: number }).envMapIntensity = 0.9;
              };
              if (Array.isArray(m)) m.forEach(apply);
              else apply(m);
            }
          }
        });
        const box = new THREE.Box3().setFromObject(s);
        const size = box.getSize(new THREE.Vector3());
        const targetHeight = 0.5;
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const scale = targetHeight / maxDim;
        s.scale.setScalar(scale);
        const newBox = new THREE.Box3().setFromObject(s);
        const center = newBox.getCenter(new THREE.Vector3());
        s.position.x -= center.x;
        s.position.z -= center.z;
        baseYRef.current = -newBox.min.y;
        s.position.y -= newBox.min.y;
        setScene(s);
        setLoading(false);
        onLoaded?.();
      },
      undefined,
      (err) => {
        if (cancelled) return;
        onError?.(err instanceof Error ? err.message : String(err));
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [modelUrl, onLoaded, onError]);

  useEffect(() => {
    if (scene) {
      camera.position.set(0, 0.35, 1.0);
      camera.lookAt(0, 0.25, 0);
    }
  }, [scene, camera]);

  useFrame((state, delta) => {
    if (!scene || !groupRef.current) return;
    const time = state.clock.getElapsedTime();
    const energy = energyRef?.current ?? 0;

    const breath = Math.sin(time * 0.9 + idlePhaseRef.current) * 0.008;
    groupRef.current.position.y = breath;

    const headBob = Math.sin(time * 0.5 + idlePhaseRef.current) * 0.015;
    const targetY = Math.sin(time * 0.4 + idlePhaseRef.current) * 0.25 + headBob + (energy * 0.18);
    const targetX = Math.sin(time * 0.27 + idlePhaseRef.current) * 0.12;
    groupRef.current.rotation.y += (targetY - groupRef.current.rotation.y) * 0.06;
    groupRef.current.rotation.x += (targetX - groupRef.current.rotation.x) * 0.06;
    if (lookAt) {
      const dx = lookAt.x;
      const dy = lookAt.y - 0.25;
      const dz = lookAt.z;
      groupRef.current.rotation.y += (Math.atan2(dx, dz) - groupRef.current.rotation.y) * 0.04;
      groupRef.current.rotation.x += (-Math.atan2(dy, Math.sqrt(dx * dx + dz * dz)) * 0.4 - groupRef.current.rotation.x) * 0.04;
    }

    const targetSmile = (EXPRESSION_WEIGHTS[currentExpression]?.mouthSmile || 0) * expressionIntensity;
    exprColorRef.current.smile += (targetSmile - exprColorRef.current.smile) * Math.min(1, delta * 6);
    const smile = exprColorRef.current.smile;
    if (smile > 0.02) {
      scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          const mesh = o as THREE.Mesh;
          const m = mesh.material as THREE.Material | THREE.Material[];
          if (!m) return;
          const tint = (mm: THREE.Material) => {
            if ((mm as THREE.MeshStandardMaterial).color) {
              const mat = mm as THREE.MeshStandardMaterial;
              if (!mat.userData._origColor) mat.userData._origColor = mat.color.clone();
              const orig = mat.userData._origColor as THREE.Color;
              mat.color.copy(orig).lerp(new THREE.Color(1.0, 0.85, 0.78), smile * 0.35);
              mat.emissive = mat.emissive || new THREE.Color();
              mat.emissive.setRGB(smile * 0.06, smile * 0.03, 0);
            }
          };
          if (Array.isArray(m)) m.forEach(tint);
          else tint(m);
        }
      });
    }

    if (isPlaying) {
      const audioT = audioRef?.current && !isNaN(audioRef.current.currentTime) ? audioRef.current.currentTime : 0;
      const pulse = Math.abs(Math.sin(audioT * Math.PI * 3 + idlePhaseRef.current)) * Math.min(1, energy * 1.4);
      groupRef.current.scale.setScalar(1 + pulse * 0.02);
    } else {
      groupRef.current.scale.setScalar(1);
    }
  });

  if (loading) return null;
  if (!scene) return null;
  return (
    <group ref={groupRef}>
      <primitive object={scene} />
    </group>
  );
}

function applyVisemeWeights(vrm: import("@pixiv/three-vrm").VRM, weights: VisemeWeights) {
  const mgr = vrm.expressionManager;
  if (!mgr) return;
  for (const k in weights) {
    const v = weights[k as VisemeKey];
    if (typeof v !== "number") continue;
    try {
      mgr.setValue(k as never, Math.max(0, Math.min(1, v)));
    } catch {}
  }
}

type SceneProps = InnerProps & {
  height?: number | string;
  className?: string;
  backgroundColor?: string;
  forcePipeline?: "auto" | "vrm" | "glb";
};

export function HyperrealAvatar(props: SceneProps) {
  const { height = 480, className, backgroundColor = "#0a0f1f" } = props;
  const [err, setErr] = useState<string | null>(null);
  const dpr = useMemo(() => (typeof window !== "undefined" ? Math.min(2, window.devicePixelRatio || 1) : 1), []);

  const useVrm = props.forcePipeline === "vrm" || (props.forcePipeline !== "glb" && isVrmUrl(props.modelUrl));

  return (
    <div className={`relative overflow-hidden rounded-[14px] ${className || ""}`} style={{ height, backgroundColor }}>
      {err ? (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-white/80">
          <div>
            <p className="font-semibold text-danger">Avatar failed to load</p>
            <p className="mt-1 text-xs text-white/60">{err}</p>
            <p className="mt-3 text-[10px] text-white/40">Try a .vrm (with ARKit blendshapes) or .glb model.</p>
          </div>
        </div>
      ) : null}
      <Canvas
        dpr={dpr}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        camera={{ position: [0, 1.55, 1.1], fov: 28, near: 0.05, far: 50 }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
      >
        <color attach="background" args={[backgroundColor]} />
        <ambientLight intensity={0.4} />
        <directionalLight position={[2, 2.5, 1.5]} intensity={1.6} color={"#ffe6c4"} castShadow />
        <directionalLight position={[-1.5, 1.2, 1]} intensity={0.6} color={"#cfd9ff"} />
        <pointLight position={[0, 0.5, 1.5]} intensity={0.4} color={"#ffffff"} />
        <Environment files="/hdri/city.exr" background={false} environmentIntensity={0.5} />
        {useVrm ? (
          <VrmInner
            modelUrl={props.modelUrl}
            timeline={props.timeline}
            isPlaying={props.isPlaying}
            audioRef={props.audioRef}
            currentExpression={props.currentExpression}
            expressionIntensity={props.expressionIntensity}
            lookAt={props.lookAt}
            energyRef={props.energyRef}
            onLoaded={props.onLoaded}
            onError={(m) => setErr(m)}
          />
        ) : (
          <GlbInner
            modelUrl={props.modelUrl}
            timeline={props.timeline}
            isPlaying={props.isPlaying}
            audioRef={props.audioRef}
            currentExpression={props.currentExpression}
            expressionIntensity={props.expressionIntensity}
            lookAt={props.lookAt}
            energyRef={props.energyRef}
            onLoaded={props.onLoaded}
            onError={(m) => setErr(m)}
          />
        )}
        <OrbitControls
          target={[0, 0.25, 0]}
          enablePan={false}
          minDistance={0.4}
          maxDistance={3}
          minPolarAngle={Math.PI * 0.25}
          maxPolarAngle={Math.PI * 0.65}
          enableDamping
          dampingFactor={0.08}
        />
      </Canvas>
    </div>
  );
}

type DropProps = Omit<SceneProps, "modelUrl"> & {
  initialModelUrl?: string;
  defaultModelUrl?: string;
  allowDrop?: boolean;
};

export function AvatarWithDrop({
  initialModelUrl,
  defaultModelUrl = "/models/avatar.glb",
  allowDrop = true,
  ...rest
}: DropProps) {
  const [modelUrl, setModelUrl] = useState(initialModelUrl || defaultModelUrl);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [customLoaded, setCustomLoaded] = useState(false);

  useEffect(() => {
    if (initialModelUrl) {
      setModelUrl(initialModelUrl);
      setCustomLoaded(false);
    }
  }, [initialModelUrl]);

  const onFile = useCallback((file: File) => {
    if (!/\.(vrm|glb|gltf)$/i.test(file.name)) return;
    const url = URL.createObjectURL(file);
    setModelUrl(url);
    setCustomLoaded(true);
  }, []);

  return (
    <div
      className="relative"
      onDragOver={(e) => {
        if (!allowDrop) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (!allowDrop) return;
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
    >
      <HyperrealAvatar {...rest} modelUrl={modelUrl} />
      {allowDrop ? (
        <>
          <div className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-medium text-white backdrop-blur">
            {customLoaded ? "Custom model" : defaultModelUrl.includes("avatar.glb") ? "Stylized fallback" : "Default"}
          </div>
          <div className="absolute right-2 top-2 flex gap-1.5">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-semibold text-slate-900 shadow hover:bg-white"
            >
              Upload .vrm / .glb
            </button>
            {customLoaded ? (
              <button
                type="button"
                onClick={() => {
                  setModelUrl(defaultModelUrl);
                  setCustomLoaded(false);
                }}
                className="rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-black/70"
              >
                Reset
              </button>
            ) : null}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".vrm,.glb,.gltf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = "";
            }}
          />
          {dragOver ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[14px] border-2 border-dashed border-white/70 bg-blue-500/10">
              <p className="rounded-full bg-blue-600 px-4 py-2 text-xs font-semibold text-white">Drop .vrm or .glb to load</p>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
