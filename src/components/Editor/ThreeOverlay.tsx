"use client";

import React, { Suspense, useMemo, useState } from "react";
import { Canvas, useLoader } from "@react-three/fiber";
import { ContactShadows, Environment, Grid, Html, OrbitControls, PivotControls } from "@react-three/drei";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

type TransformTuple = [number, number, number];

type SceneAsset = {
    instanceId: string;
    name: string;
    mesh?: string;
    position?: TransformTuple;
    rotation?: TransformTuple;
    scale?: TransformTuple;
};

function parseVector3(input: unknown, fallback: TransformTuple): TransformTuple {
    if (!Array.isArray(input) || input.length !== 3) return fallback;
    const parsed = input.map((value) => Number(value));
    if (parsed.some((value) => Number.isNaN(value))) return fallback;
    return [parsed[0], parsed[1], parsed[2]];
}

function LoadingLabel({ text }: { text: string }) {
    return (
        <Html center>
            <div className="text-xs px-3 py-1 rounded bg-neutral-950/80 border border-neutral-700 text-neutral-300">{text}</div>
        </Html>
    );
}

function EnvironmentSplat({ splatUrl }: { splatUrl: string }) {
    const geometry = useLoader(PLYLoader, splatUrl);

    const pointsMaterial = useMemo(() => {
        const hasColors = Boolean(geometry.getAttribute("color"));
        const material = new THREE.PointsMaterial({
            size: 0.03,
            sizeAttenuation: true,
            vertexColors: hasColors,
            color: hasColors ? "#ffffff" : "#8ad4ff",
            transparent: true,
            opacity: 0.95,
        });
        return material;
    }, [geometry]);

    return <points geometry={geometry} material={pointsMaterial} />;
}

function AssetFallbackMesh({
    asset,
    updateAssetTransform,
}: {
    asset: SceneAsset;
    updateAssetTransform: (instanceId: string, patch: Partial<SceneAsset>) => void;
}) {
    const [active, setActive] = useState(false);

    return (
        <PivotControls
            visible={active}
            scale={80}
            depthTest={false}
            lineWidth={3}
            anchor={[0, 0, 0]}
            onDrag={(local) => {
                const position = new THREE.Vector3();
                const quaternion = new THREE.Quaternion();
                const scale = new THREE.Vector3();
                local.decompose(position, quaternion, scale);

                const euler = new THREE.Euler().setFromQuaternion(quaternion);
                updateAssetTransform(asset.instanceId, {
                    position: [position.x, position.y, position.z],
                    rotation: [euler.x, euler.y, euler.z],
                    scale: [scale.x, scale.y, scale.z],
                });
            }}
        >
            <group
                position={parseVector3(asset.position, [0, 0, 0])}
                rotation={parseVector3(asset.rotation, [0, 0, 0])}
                scale={parseVector3(asset.scale, [1, 1, 1])}
                onClick={(event) => {
                    event.stopPropagation();
                    setActive((prev) => !prev);
                }}
            >
                <mesh castShadow receiveShadow>
                    <boxGeometry args={[1, 1, 1]} />
                    <meshStandardMaterial color={active ? "#60a5fa" : "#4ade80"} roughness={0.3} metalness={0.4} />
                </mesh>
            </group>
        </PivotControls>
    );
}

function GLBAsset({
    asset,
    updateAssetTransform,
}: {
    asset: SceneAsset;
    updateAssetTransform: (instanceId: string, patch: Partial<SceneAsset>) => void;
}) {
    const [active, setActive] = useState(false);
    const gltf = useLoader(GLTFLoader, asset.mesh || "");
    const scene = useMemo(() => clone(gltf.scene), [gltf.scene]);

    return (
        <PivotControls
            visible={active}
            scale={80}
            depthTest={false}
            lineWidth={3}
            anchor={[0, 0, 0]}
            onDrag={(local) => {
                const position = new THREE.Vector3();
                const quaternion = new THREE.Quaternion();
                const scale = new THREE.Vector3();
                local.decompose(position, quaternion, scale);

                const euler = new THREE.Euler().setFromQuaternion(quaternion);
                updateAssetTransform(asset.instanceId, {
                    position: [position.x, position.y, position.z],
                    rotation: [euler.x, euler.y, euler.z],
                    scale: [scale.x, scale.y, scale.z],
                });
            }}
        >
            <group
                position={parseVector3(asset.position, [0, 0, 0])}
                rotation={parseVector3(asset.rotation, [0, 0, 0])}
                scale={parseVector3(asset.scale, [1, 1, 1])}
                onClick={(event) => {
                    event.stopPropagation();
                    setActive((prev) => !prev);
                }}
            >
                <primitive object={scene} />
            </group>
        </PivotControls>
    );
}

function SceneAssetNode({
    asset,
    updateAssetTransform,
}: {
    asset: SceneAsset;
    updateAssetTransform: (instanceId: string, patch: Partial<SceneAsset>) => void;
}) {
    if (asset.mesh) {
        return (
            <Suspense fallback={<LoadingLabel text="Loading mesh..." />}>
                <GLBAsset asset={asset} updateAssetTransform={updateAssetTransform} />
            </Suspense>
        );
    }

    return <AssetFallbackMesh asset={asset} updateAssetTransform={updateAssetTransform} />;
}

export default function ThreeOverlay({ sceneGraph, setSceneGraph }: { sceneGraph: any; setSceneGraph: any }) {
    const environmentSplatUrl =
        typeof sceneGraph?.environment === "object" ? sceneGraph.environment?.urls?.splats ?? "" : "";

    const updateAssetTransform = (instanceId: string, patch: Partial<SceneAsset>) => {
        setSceneGraph((prev: any) => ({
            ...prev,
            assets: (prev.assets ?? []).map((asset: SceneAsset) =>
                asset.instanceId === instanceId ? { ...asset, ...patch } : asset,
            ),
        }));
    };

    return (
        <div className="absolute inset-0 pointer-events-auto z-20">
            <Canvas camera={{ position: [5, 4, 6], fov: 45 }} shadows>
                <color attach="background" args={["#0a0a0a"]} />
                <ambientLight intensity={0.65} />
                <directionalLight position={[8, 12, 6]} intensity={1.2} castShadow />

                <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
                <Environment preset="city" />

                <Grid
                    args={[30, 30]}
                    cellSize={1}
                    cellThickness={0.8}
                    cellColor="#3f3f46"
                    sectionSize={5}
                    sectionThickness={1.2}
                    sectionColor="#71717a"
                    fadeDistance={45}
                    fadeStrength={1}
                />

                <ContactShadows position={[0, -0.5, 0]} opacity={0.35} scale={30} blur={2.2} far={8} />

                {environmentSplatUrl ? (
                    <Suspense fallback={<LoadingLabel text="Loading environment splat..." />}>
                        <EnvironmentSplat splatUrl={environmentSplatUrl} />
                    </Suspense>
                ) : null}

                {(sceneGraph.assets ?? []).map((asset: SceneAsset, index: number) => (
                    <SceneAssetNode
                        key={asset.instanceId || `${asset.name}-${index}`}
                        asset={asset}
                        updateAssetTransform={updateAssetTransform}
                    />
                ))}
            </Canvas>
        </div>
    );
}
