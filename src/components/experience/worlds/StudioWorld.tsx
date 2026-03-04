'use client';

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface WorldProps {
    visibility: Float32Array;
    progress: Float32Array;
    index: number;
}

// Realistic film set — warm tungsten, visible rigs, camera on dolly, actor silhouette
export function StudioWorld({ visibility, progress, index }: WorldProps) {
    const groupRef = useRef<THREE.Group>(null);
    const floorRef = useRef<THREE.Mesh>(null);
    const keyLightRef = useRef<THREE.SpotLight>(null);
    const fillLightRef = useRef<THREE.PointLight>(null);
    const practicalLightRef = useRef<THREE.PointLight>(null);

    useFrame((state) => {
        const vis = visibility[index];
        if (!groupRef.current) return;

        if (vis <= 0) {
            groupRef.current.visible = false;
            return;
        }
        groupRef.current.visible = true;

        const time = state.clock.elapsedTime;

        // Floor reflectivity
        if (floorRef.current) {
            const floorMat = floorRef.current.material as THREE.MeshStandardMaterial;
            floorMat.opacity = vis * 0.95;
        }

        // Subtle key light flicker — practical lighting feel
        if (keyLightRef.current) {
            keyLightRef.current.intensity = (1.8 + Math.sin(time * 3.5) * 0.05 + Math.sin(time * 7.2) * 0.03) * vis;
        }

        // Fill light gentle pulse
        if (fillLightRef.current) {
            fillLightRef.current.intensity = (0.4 + Math.sin(time * 0.5) * 0.05) * vis;
        }

        // Practical light on set flickers more
        if (practicalLightRef.current) {
            practicalLightRef.current.intensity = (0.8 + Math.sin(time * 8) * 0.1 + Math.sin(time * 12.5) * 0.05) * vis;
        }
    });

    return (
        <group ref={groupRef}>
            {/* ═══ LIGHTING — Dramatic Cool Film Set ═══ */}

            {/* KEY light — cool striking cyan/white */}
            <spotLight
                ref={keyLightRef}
                position={[-8, 10, 5]}
                angle={0.5}
                penumbra={0.7}
                intensity={2.5}
                color="#e0f2fe"
                distance={40}
                castShadow={false}
                target-position={[0, 0, -5]}
            />

            {/* FILL light — deep moody blue */}
            <pointLight
                ref={fillLightRef}
                position={[10, 4, 2]}
                intensity={1.5}
                color="#1e3a8a"
                distance={25}
            />

            {/* RIM / back light — crisp edge separation */}
            <pointLight
                position={[0, 6, -12]}
                intensity={2.0}
                color="#38bdf8"
                distance={20}
            />

            {/* Practical light on set — stark white/blue */}
            <pointLight
                ref={practicalLightRef}
                position={[-5, 8, -3]}
                intensity={1.5}
                color="#bae6fd"
                distance={15}
            />

            {/* Deep cool ambient */}
            <ambientLight intensity={0.08} color="#020617" />

            {/* ═══ FLOOR — Concrete studio floor with tape marks ═══ */}
            <mesh
                ref={floorRef}
                position={[0, -4, -5]}
                rotation={[-Math.PI / 2, 0, 0]}
            >
                <planeGeometry args={[35, 25]} />
                <meshStandardMaterial
                    color="#020617"
                    metalness={0.6}
                    roughness={0.3}
                    transparent
                    opacity={0.95}
                />
            </mesh>

            {/* Floor tape marks — glowing cool blue */}
            {[[-2, 0], [2, 0], [0, -3], [0, 3]].map(([x, z], i) => (
                <group key={i} position={[x!, -3.98, z! - 5]}>
                    <mesh rotation={[-Math.PI / 2, 0, 0]}>
                        <planeGeometry args={[0.6, 0.05]} />
                        <meshBasicMaterial color="#38bdf8" transparent opacity={0.7} depthWrite={false} />
                    </mesh>
                    <mesh rotation={[-Math.PI / 2, 0, Math.PI / 2]}>
                        <planeGeometry args={[0.6, 0.05]} />
                        <meshBasicMaterial color="#38bdf8" transparent opacity={0.7} depthWrite={false} />
                    </mesh>
                </group>
            ))}

            {/* ═══ BACKDROP — Cyclorama wall ═══ */}
            <mesh position={[0, 3, -14]}>
                <planeGeometry args={[30, 16]} />
                <meshStandardMaterial
                    color="#020617"
                    roughness={0.7}
                    metalness={0.2}
                    transparent
                    opacity={0.9}
                    side={THREE.DoubleSide}
                />
            </mesh>

            {/* Side walls */}
            <mesh position={[-14, 3, -5]} rotation={[0, Math.PI / 2, 0]}>
                <planeGeometry args={[20, 16]} />
                <meshStandardMaterial color="#030712" roughness={0.8} transparent opacity={0.7} side={THREE.DoubleSide} />
            </mesh>
            <mesh position={[14, 3, -5]} rotation={[0, -Math.PI / 2, 0]}>
                <planeGeometry args={[20, 16]} />
                <meshStandardMaterial color="#030712" roughness={0.8} transparent opacity={0.7} side={THREE.DoubleSide} />
            </mesh>

            {/* ═══ KEY LIGHT RIG — C-stand with light ═══ */}
            {/* Stand pole */}
            <mesh position={[-7, 1, 3]}>
                <cylinderGeometry args={[0.04, 0.06, 10, 8]} />
                <meshStandardMaterial color="#1f2937" metalness={0.8} roughness={0.3} />
            </mesh>
            {/* Stand base */}
            <mesh position={[-7, -3.9, 3]}>
                <cylinderGeometry args={[0.6, 0.6, 0.08, 8]} />
                <meshStandardMaterial color="#0f172a" metalness={0.7} roughness={0.4} />
            </mesh>
            {/* Light head — Fresnel shape */}
            <mesh position={[-7, 6, 3]}>
                <cylinderGeometry args={[0.5, 0.35, 0.7, 8]} />
                <meshStandardMaterial color="#111827" metalness={0.6} roughness={0.4} />
            </mesh>
            {/* Light face — emissive */}
            <mesh position={[-7, 5.6, 3]} rotation={[Math.PI / 2, 0, 0]}>
                <circleGeometry args={[0.34, 16]} />
                <meshBasicMaterial color="#e0f2fe" transparent opacity={0.8} />
            </mesh>

            {/* ═══ FILL LIGHT RIG — C-stand with softbox ═══ */}
            <mesh position={[8, 0.5, 1]}>
                <cylinderGeometry args={[0.04, 0.06, 9, 8]} />
                <meshStandardMaterial color="#1f2937" metalness={0.8} roughness={0.3} />
            </mesh>
            <mesh position={[8, 5, 1]}>
                <boxGeometry args={[1.2, 0.8, 0.15]} />
                <meshStandardMaterial color="#0f172a" roughness={0.5} />
            </mesh>
            {/* Softbox face */}
            <mesh position={[8, 5, 1.08]}>
                <planeGeometry args={[1.1, 0.7]} />
                <meshBasicMaterial color="#1e3a8a" transparent opacity={0.3} />
            </mesh>

            {/* ═══ CAMERA ON DOLLY TRACK ═══ */}
            {/* Dolly track rails */}
            <mesh position={[-1, -3.85, 4]} rotation={[0, 0, 0]}>
                <boxGeometry args={[0.06, 0.06, 8]} />
                <meshStandardMaterial color="#1f2937" metalness={0.9} roughness={0.2} />
            </mesh>
            <mesh position={[1, -3.85, 4]} rotation={[0, 0, 0]}>
                <boxGeometry args={[0.06, 0.06, 8]} />
                <meshStandardMaterial color="#1f2937" metalness={0.9} roughness={0.2} />
            </mesh>
            {/* Track crossbars */}
            {[-2, 0, 2, 4, 6].map((z, i) => (
                <mesh key={`crossbar-${i}`} position={[0, -3.85, z]}>
                    <boxGeometry args={[1.2, 0.04, 0.08]} />
                    <meshStandardMaterial color="#1e293b" metalness={0.8} roughness={0.3} />
                </mesh>
            ))}
            {/* Dolly platform */}
            <mesh position={[0, -3.6, 3]}>
                <boxGeometry args={[1.4, 0.1, 1.4]} />
                <meshStandardMaterial color="#0f172a" metalness={0.6} roughness={0.4} />
            </mesh>
            {/* Camera body */}
            <mesh position={[0, -2.8, 3]}>
                <boxGeometry args={[0.6, 0.4, 0.8]} />
                <meshStandardMaterial color="#020617" metalness={0.7} roughness={0.3} />
            </mesh>
            {/* Camera lens */}
            <mesh position={[0, -2.8, 2.5]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.12, 0.15, 0.4, 12]} />
                <meshStandardMaterial color="#0f172a" metalness={0.9} roughness={0.1} />
            </mesh>
            {/* Tripod head */}
            <mesh position={[0, -3.2, 3]}>
                <cylinderGeometry args={[0.08, 0.15, 0.6, 8]} />
                <meshStandardMaterial color="#1e293b" metalness={0.7} roughness={0.3} />
            </mesh>

            {/* ═══ ACTOR SILHOUETTE — Standing figure ═══ */}
            {/* Body */}
            <mesh position={[0, -1, -5]}>
                <capsuleGeometry args={[0.3, 2.4, 4, 12]} />
                <meshStandardMaterial color="#050a1a" roughness={0.7} />
            </mesh>
            {/* Head */}
            <mesh position={[0, 1.0, -5]}>
                <sphereGeometry args={[0.25, 8, 8]} />
                <meshStandardMaterial color="#050a1a" roughness={0.7} />
            </mesh>

            {/* Second figure — slightly offset */}
            <mesh position={[3, -1.2, -6]}>
                <capsuleGeometry args={[0.25, 2.2, 4, 12]} />
                <meshStandardMaterial color="#0a0f1f" roughness={0.7} />
            </mesh>
            <mesh position={[3, 0.7, -6]}>
                <sphereGeometry args={[0.22, 8, 8]} />
                <meshStandardMaterial color="#0a0f1f" roughness={0.7} />
            </mesh>

            {/* ═══ PRACTICAL LIGHT — Visible bulb on stand ═══ */}
            <mesh position={[-5, 2, -3]}>
                <cylinderGeometry args={[0.03, 0.04, 6, 6]} />
                <meshStandardMaterial color="#1f2937" metalness={0.8} roughness={0.3} />
            </mesh>
            {/* Bulb */}
            <mesh position={[-5, 5, -3]}>
                <sphereGeometry args={[0.12, 8, 8]} />
                <meshBasicMaterial color="#bae6fd" transparent opacity={0.9} />
            </mesh>

            {/* ═══ RIM LIGHT STAND ═══ */}
            <mesh position={[5, 0.5, -10]}>
                <cylinderGeometry args={[0.04, 0.06, 9, 8]} />
                <meshStandardMaterial color="#1f2937" metalness={0.8} roughness={0.3} />
            </mesh>
            <mesh position={[5, 5, -10]}>
                <boxGeometry args={[1, 0.6, 0.12]} />
                <meshStandardMaterial color="#0f172a" roughness={0.5} />
            </mesh>
        </group>
    );
}
