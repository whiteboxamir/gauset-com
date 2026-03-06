"use client";

import React, { useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment, PivotControls, Grid, ContactShadows } from "@react-three/drei";
import * as THREE from "three";

// Simple Asset Mesh to represent a dragged GLB model
function AssetMesh({ asset, index, updatePosition }: { asset: any, index: number, updatePosition: any }) {
    const [active, setActive] = useState(false);

    return (
        <PivotControls
            visible={active}
            scale={75}
            depthTest={false}
            lineWidth={4}
            anchor={[0, -1, 0]}
            onDragEnd={() => {
                // In a real app, read matrix and update scene graph
            }}
        >
            <group position={new THREE.Vector3(...(asset.position || [0, 0, 0]))}>
                <mesh
                    onClick={(e) => { e.stopPropagation(); setActive(!active); }}
                    castShadow
                    receiveShadow
                >
                    <boxGeometry args={[1, 1, 1]} />
                    <meshStandardMaterial color={active ? "#3b82f6" : "#4ade80"} roughness={0.2} metalness={0.8} />
                </mesh>

                {/* Helper text/label in a real implementation would go here */}
            </group>
        </PivotControls>
    );
}

export default function ThreeOverlay({ sceneGraph, setSceneGraph }: { sceneGraph: any, setSceneGraph: any }) {
    const updateAssetPosition = (id: string, newPos: [number, number, number]) => {
        setSceneGraph((prev: any) => ({
            ...prev,
            assets: prev.assets.map((a: any) => a.instanceId === id ? { ...a, position: newPos } : a)
        }));
    };

    return (
        <div className="absolute inset-0 pointer-events-none z-20">
            {/* We set pointer-events: auto only on the Canvas to let clicks pass through to the Splat viewer if no 3D object is hit */}
            <div className="w-full h-full pointer-events-auto">
                <Canvas camera={{ position: [5, 5, 5], fov: 50 }} shadows>
                    <ambientLight intensity={0.5} />
                    <directionalLight position={[10, 10, 5]} intensity={1} castShadow />

                    <Environment preset="city" />

                    <Grid
                        args={[20, 20]}
                        cellSize={1}
                        cellThickness={1}
                        cellColor="#404040"
                        sectionSize={5}
                        sectionThickness={1.5}
                        sectionColor="#6b7280"
                        fadeDistance={30}
                        fadeStrength={1}
                    />

                    <ContactShadows position={[0, -0.5, 0]} opacity={0.4} scale={20} blur={2} far={4} />

                    {sceneGraph.assets.map((asset: any, i: number) => (
                        <AssetMesh
                            key={asset.instanceId || i}
                            asset={asset}
                            index={i}
                            updatePosition={(pos: any) => updateAssetPosition(asset.instanceId, pos)}
                        />
                    ))}

                </Canvas>
            </div>
        </div>
    );
}
