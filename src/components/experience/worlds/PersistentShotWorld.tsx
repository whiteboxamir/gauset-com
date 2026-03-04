'use client';

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface WorldProps {
    visibility: Float32Array;
    progress: Float32Array;
    index: number;
}

/*
  PERSISTENT SHOT WORLD — THE reveal moment
  
  Same environment. Same lighting. Same geometry.
  Only the camera angle changes.
  
  As the user scrolls:
    0–25%: WIDE SHOT (establishing, full scene)
    25–50%: CLOSE-UP (tight on the main figure)
    50–75%: OVER-THE-SHOULDER (from behind figure B toward figure A)
    75–100%: TRACKING SHOT (lateral dolly move)
    
  This demonstrates the core concept:
  "Build a world once, direct inside it forever."
*/

const DUST_COUNT = 150;

export function PersistentShotWorld({ visibility, progress, index }: WorldProps) {
    const groupRef = useRef<THREE.Group>(null);
    const dustRef = useRef<THREE.InstancedMesh>(null);
    const dummy = useMemo(() => new THREE.Object3D(), []);

    // Atmospheric dust in the scene
    const dustData = useMemo(() => {
        const positions = new Float32Array(DUST_COUNT * 3);
        const sizes = new Float32Array(DUST_COUNT);
        const speeds = new Float32Array(DUST_COUNT);
        const phases = new Float32Array(DUST_COUNT);

        for (let i = 0; i < DUST_COUNT; i++) {
            const i3 = i * 3;
            positions[i3] = (Math.random() - 0.5) * 20;
            positions[i3 + 1] = -4 + Math.random() * 12;
            positions[i3 + 2] = -15 + Math.random() * 20;
            sizes[i] = 0.01 + Math.random() * 0.03;
            speeds[i] = 0.01 + Math.random() * 0.02;
            phases[i] = Math.random() * Math.PI * 2;
        }
        return { positions, sizes, speeds, phases };
    }, []);

    useFrame((state) => {
        const vis = visibility[index];
        if (!groupRef.current) return;

        if (vis <= 0) {
            groupRef.current.visible = false;
            return;
        }
        groupRef.current.visible = true;

        const time = state.clock.elapsedTime;

        // Animate dust particles — floating in tungsten light beams
        if (dustRef.current) {
            for (let i = 0; i < DUST_COUNT; i++) {
                const i3 = i * 3;
                const phase = dustData.phases[i];
                const speed = dustData.speeds[i];
                dummy.position.set(
                    dustData.positions[i3] + Math.sin(time * speed + phase) * 0.5,
                    dustData.positions[i3 + 1] + Math.sin(time * speed * 0.7 + phase) * 0.3,
                    dustData.positions[i3 + 2] + Math.cos(time * speed * 0.5 + phase) * 0.2
                );
                dummy.scale.setScalar(dustData.sizes[i]);
                dummy.updateMatrix();
                dustRef.current.setMatrixAt(i, dummy.matrix);
            }
            dustRef.current.instanceMatrix.needsUpdate = true;
            const dMat = dustRef.current.material as THREE.MeshBasicMaterial;
            dMat.opacity = vis * 0.3;
        }

        // SMOOTH SCENE CROSSFADE: dissolve room geometry and lighting
        groupRef.current.traverse((child) => {
            if ((child as any).isLight) {
                const light = child as THREE.Light;
                if (light.userData.baseIntensity === undefined) {
                    light.userData.baseIntensity = light.intensity;
                }
                light.intensity = light.userData.baseIntensity * vis;
            } else if ((child as any).isMesh && child !== dustRef.current) {
                const mesh = child as THREE.Mesh;
                const mat = mesh.material as THREE.Material;
                if (mat) {
                    if (mat.userData.baseOpacity === undefined) {
                        mat.userData.baseOpacity = mat.opacity !== undefined ? mat.opacity : 1.0;
                        mat.transparent = true;
                    }
                    mat.opacity = mat.userData.baseOpacity * vis;
                }
            }
        });
    });

    return (
        <group ref={groupRef}>
            {/* ═══ LIGHTING — Same as Production, consistent ═══ */}

            {/* Key light — warm tungsten */}
            <spotLight
                position={[-8, 10, 5]}
                angle={0.5}
                penumbra={0.7}
                intensity={1.6}
                color="#FFB347"
                distance={40}
                castShadow={false}
            />

            {/* Fill light */}
            <pointLight position={[10, 4, 2]} intensity={0.35} color="#E8C567" distance={25} />

            {/* Rim light */}
            <pointLight position={[0, 6, -12]} intensity={0.5} color="#D4A04A" distance={20} />

            {/* Practical */}
            <pointLight position={[-5, 8, -3]} intensity={0.6} color="#FFD700" distance={15} />

            <ambientLight intensity={0.04} color="#1a1208" />

            {/* ═══ THE PERSISTENT SET — Identical to Production ═══ */}

            {/* Floor */}
            <mesh position={[0, -4, -5]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[35, 25]} />
                <meshStandardMaterial color="#1a1a1a" metalness={0.3} roughness={0.6} transparent opacity={0.95} />
            </mesh>

            {/* Floor tape marks */}
            {[[-2, 0], [2, 0], [0, -3]].map(([x, z], i) => (
                <group key={i} position={[x!, -3.98, z! - 5]}>
                    <mesh rotation={[-Math.PI / 2, 0, 0]}>
                        <planeGeometry args={[0.6, 0.05]} />
                        <meshBasicMaterial color="#ff4444" transparent opacity={0.6} depthWrite={false} />
                    </mesh>
                    <mesh rotation={[-Math.PI / 2, 0, Math.PI / 2]}>
                        <planeGeometry args={[0.6, 0.05]} />
                        <meshBasicMaterial color="#ff4444" transparent opacity={0.6} depthWrite={false} />
                    </mesh>
                </group>
            ))}

            {/* Backdrop */}
            <mesh position={[0, 3, -14]}>
                <planeGeometry args={[30, 16]} />
                <meshStandardMaterial color="#1a1a1a" roughness={0.9} metalness={0} transparent opacity={0.9} side={THREE.DoubleSide} />
            </mesh>

            {/* Side walls */}
            <mesh position={[-14, 3, -5]} rotation={[0, Math.PI / 2, 0]}>
                <planeGeometry args={[20, 16]} />
                <meshStandardMaterial color="#151515" roughness={0.95} transparent opacity={0.7} side={THREE.DoubleSide} />
            </mesh>
            <mesh position={[14, 3, -5]} rotation={[0, -Math.PI / 2, 0]}>
                <planeGeometry args={[20, 16]} />
                <meshStandardMaterial color="#151515" roughness={0.95} transparent opacity={0.7} side={THREE.DoubleSide} />
            </mesh>

            {/* ═══ FIGURES — Same positions as Production ═══ */}
            {/* Main actor */}
            <mesh position={[0, -1, -5]}>
                <capsuleGeometry args={[0.3, 2.4, 4, 12]} />
                <meshStandardMaterial color="#0a0a0a" roughness={0.9} />
            </mesh>
            <mesh position={[0, 1.0, -5]}>
                <sphereGeometry args={[0.25, 8, 8]} />
                <meshStandardMaterial color="#0a0a0a" roughness={0.9} />
            </mesh>

            {/* Second figure */}
            <mesh position={[3, -1.2, -6]}>
                <capsuleGeometry args={[0.25, 2.2, 4, 12]} />
                <meshStandardMaterial color="#0d0d0d" roughness={0.9} />
            </mesh>
            <mesh position={[3, 0.7, -6]}>
                <sphereGeometry args={[0.22, 8, 8]} />
                <meshStandardMaterial color="#0d0d0d" roughness={0.9} />
            </mesh>

            {/* ═══ PRODUCTION EQUIPMENT (visible) ═══ */}

            {/* C-stand with key light */}
            <mesh position={[-7, 1, 3]}>
                <cylinderGeometry args={[0.04, 0.06, 10, 8]} />
                <meshStandardMaterial color="#222222" metalness={0.8} roughness={0.3} />
            </mesh>
            <mesh position={[-7, 6, 3]}>
                <cylinderGeometry args={[0.5, 0.35, 0.7, 8]} />
                <meshStandardMaterial color="#333333" metalness={0.6} roughness={0.4} />
            </mesh>
            <mesh position={[-7, 5.6, 3]} rotation={[Math.PI / 2, 0, 0]}>
                <circleGeometry args={[0.34, 16]} />
                <meshBasicMaterial color="#FFD700" transparent opacity={0.7} />
            </mesh>

            {/* Dolly track */}
            <mesh position={[-1, -3.85, 4]}>
                <boxGeometry args={[0.06, 0.06, 8]} />
                <meshStandardMaterial color="#333333" metalness={0.9} roughness={0.2} />
            </mesh>
            <mesh position={[1, -3.85, 4]}>
                <boxGeometry args={[0.06, 0.06, 8]} />
                <meshStandardMaterial color="#333333" metalness={0.9} roughness={0.2} />
            </mesh>

            {/* Camera on dolly */}
            <mesh position={[0, -3.6, 3]}>
                <boxGeometry args={[1.4, 0.1, 1.4]} />
                <meshStandardMaterial color="#1a1a1a" metalness={0.6} roughness={0.4} />
            </mesh>
            <mesh position={[0, -2.8, 3]}>
                <boxGeometry args={[0.6, 0.4, 0.8]} />
                <meshStandardMaterial color="#111111" metalness={0.7} roughness={0.3} />
            </mesh>
            <mesh position={[0, -2.8, 2.5]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.12, 0.15, 0.4, 12]} />
                <meshStandardMaterial color="#0a0a0a" metalness={0.9} roughness={0.1} />
            </mesh>

            {/* ═══ FLOATING DUST — Makes light beams visible ═══ */}
            <instancedMesh
                ref={dustRef}
                args={[undefined, undefined, DUST_COUNT]}
                frustumCulled={false}
            >
                <sphereGeometry args={[1, 3, 3]} />
                <meshBasicMaterial color="#FFD700" transparent opacity={0.3} depthWrite={false} />
            </instancedMesh>
        </group>
    );
}
