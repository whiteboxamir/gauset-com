'use client';

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface WorldProps {
    visibility: Float32Array;
    progress: Float32Array;
    index: number;
}

const PARTICLE_COUNT = 800;
const NEON_COLORS = ['#ff007f', '#00f0ff', '#ffaa00', '#cc00ff'];

export function PersistentShotWorld({ visibility, progress, index }: WorldProps) {
    const groupRef = useRef<THREE.Group>(null);
    const swarmRef = useRef<THREE.InstancedMesh>(null);
    const ringsRef = useRef<THREE.Group>(null);
    const coreRef = useRef<THREE.Mesh>(null);
    const dummy = useMemo(() => new THREE.Object3D(), []);

    // Create a dynamic, vibrant particle swarm
    const swarmData = useMemo(() => {
        const positions = new Float32Array(PARTICLE_COUNT * 3);
        const scales = new Float32Array(PARTICLE_COUNT);
        const speeds = new Float32Array(PARTICLE_COUNT);
        const offsets = new Float32Array(PARTICLE_COUNT);
        const axes = [];
        const colors = new Float32Array(PARTICLE_COUNT * 3);
        const colorObj = new THREE.Color();

        for (let i = 0; i < PARTICLE_COUNT; i++) {
            const i3 = i * 3;
            // Particles orbit around 0,0,-5
            const radius = 2.5 + Math.random() * 15;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos((Math.random() * 2) - 1);

            positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
            positions[i3 + 2] = radius * Math.cos(phi) - 5;

            scales[i] = Math.random() * 0.4 + 0.1;
            speeds[i] = (Math.random() * 0.5 + 0.2) * (Math.random() > 0.5 ? 1 : -1);
            offsets[i] = Math.random() * Math.PI * 2;

            const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
            axes.push(axis);

            colorObj.set(NEON_COLORS[Math.floor(Math.random() * NEON_COLORS.length)]);
            colors[i3] = colorObj.r * 1.5; // Overdrive for bloom
            colors[i3 + 1] = colorObj.g * 1.5;
            colors[i3 + 2] = colorObj.b * 1.5;
        }
        return { positions, scales, speeds, offsets, axes, colors };
    }, []);

    useFrame((state, delta) => {
        const vis = visibility[index];
        if (!groupRef.current) return;

        if (vis <= 0) {
            groupRef.current.visible = false;
            return;
        }
        groupRef.current.visible = true;

        const time = state.clock.elapsedTime;
        const prog = progress[index];

        // Animate the core
        if (coreRef.current) {
            coreRef.current.rotation.y = time * 0.5;
            coreRef.current.rotation.z = time * 0.3;
            const scale = 1 + Math.sin(time * 3) * 0.1;
            coreRef.current.scale.setScalar(scale);
            const coreMat = coreRef.current.material as THREE.MeshBasicMaterial;
            coreMat.opacity = vis * 0.8;
        }

        // Animate the orbital rings
        if (ringsRef.current) {
            ringsRef.current.rotation.x = time * 0.2;
            ringsRef.current.rotation.y = time * 0.4;
            ringsRef.current.children.forEach((child, i) => {
                const mesh = child as THREE.Mesh;
                mesh.rotation.x += delta * (0.5 + i * 0.2);
                mesh.rotation.y -= delta * (0.3 + i * 0.1);
                const mat = mesh.material as THREE.MeshBasicMaterial;
                mat.opacity = vis * 0.5;
            });
        }

        // Animate the swarm — wild, dramatic, alive
        if (swarmRef.current) {
            for (let i = 0; i < PARTICLE_COUNT; i++) {
                const i3 = i * 3;

                // Orbital math relative to center (0,0,-5)
                const cx = 0;
                const cy = 0;
                const cz = -5;

                const px = swarmData.positions[i3] - cx;
                const py = swarmData.positions[i3 + 1] - cy;
                const pz = swarmData.positions[i3 + 2] - cz;

                // Rotate around arbitrary axis
                dummy.position.set(px, py, pz);
                // Speed up as you scroll!
                const currentSpeed = swarmData.speeds[i] * delta * (1 + prog * 3);
                dummy.position.applyAxisAngle(swarmData.axes[i], currentSpeed);

                swarmData.positions[i3] = dummy.position.x + cx;
                swarmData.positions[i3 + 1] = dummy.position.y + cy;
                swarmData.positions[i3 + 2] = dummy.position.z + cz;

                dummy.position.set(swarmData.positions[i3], swarmData.positions[i3 + 1], swarmData.positions[i3 + 2]);

                // Add jitter/life
                dummy.position.x += Math.sin(time * 5 + swarmData.offsets[i]) * 0.05;
                dummy.position.y += Math.cos(time * 4 + swarmData.offsets[i]) * 0.05;

                // Rotate the shards themselves
                dummy.rotation.x += delta * 2;
                dummy.rotation.y += delta * 3;

                // Scale pulsing
                const pulse = 1 + Math.sin(time * 8 + swarmData.offsets[i]) * 0.3;
                dummy.scale.setScalar(swarmData.scales[i] * pulse * vis);

                dummy.updateMatrix();
                swarmRef.current.setMatrixAt(i, dummy.matrix);
            }
            swarmRef.current.instanceMatrix.needsUpdate = true;

            const swarmMat = swarmRef.current.material as THREE.MeshBasicMaterial;
            swarmMat.opacity = vis;
        }

        // Crossfade lights
        groupRef.current.traverse((child) => {
            if ((child as any).isLight) {
                const light = child as THREE.Light;
                if (light.userData.baseIntensity === undefined) {
                    light.userData.baseIntensity = light.intensity;
                }
                light.intensity = light.userData.baseIntensity * vis;
            }
        });
    });

    return (
        <group ref={groupRef}>
            {/* ═══ DRAMATIC ALIVE LIGHTING ═══ */}
            <pointLight position={[0, 0, -5]} intensity={8} color="#ffffff" distance={30} />
            <spotLight position={[-10, 10, 5]} angle={0.8} penumbra={1} intensity={10} color="#ff007f" distance={50} />
            <spotLight position={[10, -10, 5]} angle={0.8} penumbra={1} intensity={10} color="#00f0ff" distance={50} />
            <pointLight position={[0, 5, -15]} intensity={5} color="#cc00ff" distance={40} />
            <ambientLight intensity={0.5} color="#1a0033" />

            {/* ═══ THE CORE ═══ */}
            {/* Inner burning star */}
            <mesh ref={coreRef} position={[0, 0, -5]}>
                <icosahedronGeometry args={[1.5, 2]} />
                <meshBasicMaterial color="#ffffff" transparent opacity={0.8} blending={THREE.AdditiveBlending} />
            </mesh>

            {/* Outer wireframe shell */}
            <mesh position={[0, 0, -5]}>
                <icosahedronGeometry args={[1.7, 1]} />
                <meshBasicMaterial color="#00f0ff" wireframe transparent opacity={0.3} blending={THREE.AdditiveBlending} />
            </mesh>

            <group ref={ringsRef} position={[0, 0, -5]}>
                {/* ═══ ORBITAL RINGS ═══ */}
                <mesh rotation={[Math.PI / 2, 0, 0]}>
                    <torusGeometry args={[3.0, 0.05, 16, 100]} />
                    <meshBasicMaterial color="#ff007f" transparent opacity={0.5} blending={THREE.AdditiveBlending} />
                </mesh>
                <mesh rotation={[0, Math.PI / 2, 0]}>
                    <torusGeometry args={[4.5, 0.02, 16, 100]} />
                    <meshBasicMaterial color="#ffaa00" transparent opacity={0.5} blending={THREE.AdditiveBlending} />
                </mesh>
                <mesh rotation={[Math.PI / 4, 0, Math.PI / 4]}>
                    <torusGeometry args={[6.0, 0.08, 16, 100]} />
                    <meshBasicMaterial color="#00f0ff" transparent opacity={0.5} blending={THREE.AdditiveBlending} />
                </mesh>
            </group>

            {/* ═══ KINETIC SWARM ═══ */}
            <instancedMesh
                ref={swarmRef}
                args={[undefined, undefined, PARTICLE_COUNT]}
                frustumCulled={false}
            >
                <tetrahedronGeometry args={[1, 0]} />
                <instancedBufferAttribute attach="instanceColor" args={[swarmData.colors, 3]} />
                <meshBasicMaterial vertexColors transparent opacity={1} blending={THREE.AdditiveBlending} depthWrite={false} />
            </instancedMesh>
        </group>
    );
}
