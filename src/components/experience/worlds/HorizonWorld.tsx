'use client';

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface WorldProps {
    visibility: Float32Array;
    progress: Float32Array;
    index: number;
}

// Variables for fine-tuning the Sentient Swarm effect
const SHADER_SPEED = 0.8;
const SWARM_SPREAD = 150.0; // Initial chaotic particle spread area
const FORMATION_RADIUS = 25.0; // Radius of the target cylindrical tunnel structure
const BASE_COLOR = new THREE.Color('#4cd1e0'); // Neon cyan
const CORE_COLOR = new THREE.Color('#ffffff'); // High heat white for center particles

const vertexShader = `
    precision highp float;
    attribute vec3 targetPosition;
    attribute vec3 randomOffset;
    attribute float sizeOffset;
    
    uniform float uProgress;
    uniform float uTime;
    
    varying float vDistance;
    varying vec2 vUv;
    varying float vFadeOpacity;
    
    void main() {
        vUv = uv;
        
        // Chaotic motion based on time and local random offsets
        vec3 chaoticPos = randomOffset + vec3(
            sin(uTime * 1.2 + randomOffset.x) * 10.0,
            cos(uTime * 1.5 + randomOffset.y) * 10.0,
            sin(uTime * 0.8 + randomOffset.z) * 10.0
        );
        
        // Implosion/snap feel between 10% and 70% progress
        float smoothProg = smoothstep(0.1, 0.7, uProgress);
        
        // Mix position based on exact scroll progress
        vec3 finalPos = mix(chaoticPos, targetPosition, smoothProg);
        
        // Distance from center of the tunnel to drop-off brightness
        vDistance = length(finalPos.xy); 
        
        // SMOOTH ENTRANCE FIX: Scale grows from 0 to full size over the first 0% to 15% of the scene progress
        float entranceScale = smoothstep(0.0, 0.15, uProgress);
        
        // Particles form massive blurry blobs in the void, shrink to fine points, but multiply by entrance scale
        float baseScale = mix(1.0 + sizeOffset * 4.0, 1.0 + sizeOffset * 0.5, smoothProg);
        float currentScale = baseScale * entranceScale;
        
        // Pass entrance opacity to fragment shader so alpha fades up cleanly instead of popping
        vFadeOpacity = entranceScale;
        
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position * currentScale, 1.0);
        mvPosition.xyz += finalPos;
        
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const fragmentShader = `
    precision highp float;
    uniform vec3 uBaseColor;
    uniform vec3 uCoreColor;
    uniform float uOpacity; // Global visibility multiplier from Drei
    
    varying float vDistance;
    varying vec2 vUv;
    varying float vFadeOpacity; // Local fade-in from vertex shader progress
    
    void main() {
        // Circular soft particle
        vec2 centerUv = vUv - 0.5;
        float distToCenter = length(centerUv);
        if (distToCenter > 0.5) discard;
        
        // Soft glow edge
        float glow = smoothstep(0.5, 0.1, distToCenter);
        
        // Color mixes to intense white near the core of the structure
        vec3 finalColor = mix(uCoreColor, uBaseColor, clamp(vDistance / 15.0, 0.0, 1.0));
        
        // Combine global scroll visibility (uOpacity) with the local entrance fade (vFadeOpacity)
        float finalAlpha = uOpacity * vFadeOpacity * glow * mix(0.4, 1.0, glow);
        
        gl_FragColor = vec4(finalColor, finalAlpha);
        
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`;

export function HorizonWorld({ visibility, progress, index }: WorldProps) {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const materialRef = useRef<THREE.ShaderMaterial>(null);
    const groupRef = useRef<THREE.Group>(null);
    const ambientLightRef = useRef<THREE.AmbientLight>(null);

    // Dynamic scaling for mobile to prevent WebGL crash and fix narrow aspect ratio
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    const particleCount = isMobile ? 12000 : 30000;

    // Generate massive particle dataset safely once on mount
    const { targetPositions, randomOffsets, sizeOffsets } = useMemo(() => {
        const targetPositions = new Float32Array(particleCount * 3);
        const randomOffsets = new Float32Array(particleCount * 3);
        const sizeOffsets = new Float32Array(particleCount);

        for (let i = 0; i < particleCount; i++) {
            // Target structure: A dense, infinite geometric tunnel/cathedral
            const angle = Math.random() * Math.PI * 2;
            const radius = 5 + Math.pow(Math.random(), 2) * FORMATION_RADIUS; // Dense center
            const depth = (Math.random() - 0.5) * 120; // Exceptionally long Z distribution

            // Tweak aspect ratio for mobile: squish the horizontal distribution so it fits narrow screens
            const widthScale = isMobile ? 0.5 : 1.0;

            targetPositions[i * 3 + 0] = Math.cos(angle) * (radius * widthScale);
            targetPositions[i * 3 + 1] = Math.sin(angle) * (radius * 0.4) - 2; // Squashed ellipse format
            targetPositions[i * 3 + 2] = depth;

            // Random chaotic offsets for the swarm phase, spread very wide in all directions
            randomOffsets[i * 3 + 0] = (Math.random() - 0.5) * SWARM_SPREAD;
            randomOffsets[i * 3 + 1] = (Math.random() - 0.5) * SWARM_SPREAD * 0.5; // Flatter height
            randomOffsets[i * 3 + 2] = (Math.random() - 0.5) * SWARM_SPREAD;

            sizeOffsets[i] = Math.random();
        }

        return { targetPositions, randomOffsets, sizeOffsets };
    }, [isMobile, particleCount]);

    const uniforms = useMemo(() => ({
        uProgress: { value: 0 },
        uTime: { value: 0 },
        uOpacity: { value: 0 }, // Changed default to 0 to prevent initial 1 frame pop before useFrame runs
        uBaseColor: { value: BASE_COLOR },
        uCoreColor: { value: CORE_COLOR }
    }), []);

    useFrame((state) => {
        const vis = Math.max(0, visibility[index]);
        if (!groupRef.current) return;

        // Keep group visible even slightly below 0 so the fade out/in handles it naturally
        if (vis <= 0) {
            groupRef.current.visible = false;
            return;
        }
        groupRef.current.visible = true;

        const prog = Math.max(0, progress[index]);

        if (materialRef.current) {
            materialRef.current.uniforms.uProgress.value = prog;
            materialRef.current.uniforms.uTime.value = state.clock.elapsedTime * SHADER_SPEED;
            materialRef.current.uniforms.uOpacity.value = vis * 0.8; // Blend in slightly transparent global opacity
        }

        // Smoothly ramp ambient lighting up to 0.5 intensity based on scroll progress
        if (ambientLightRef.current) {
            ambientLightRef.current.intensity = 0.5 * vis;
        }

        // As the swarm coalesces, the camera pushes rapidly through the core Z depth
        if (groupRef.current) {
            groupRef.current.position.z = prog * 40; // High speed push-in
        }
    });

    return (
        <group ref={groupRef}>
            {/* Ambient deep space blue backing */}
            <ambientLight ref={ambientLightRef} intensity={0} color="#0a1526" />

            {/* Volumetric Swarm Core */}
            <instancedMesh ref={meshRef} args={[undefined as any, undefined as any, particleCount]} frustumCulled={false}>
                <planeGeometry args={[0.2, 0.2]}>
                    <instancedBufferAttribute attach="attributes-targetPosition" args={[targetPositions, 3]} />
                    <instancedBufferAttribute attach="attributes-randomOffset" args={[randomOffsets, 3]} />
                    <instancedBufferAttribute attach="attributes-sizeOffset" args={[sizeOffsets, 1]} />
                </planeGeometry>
                <shaderMaterial
                    ref={materialRef}
                    vertexShader={vertexShader}
                    fragmentShader={fragmentShader}
                    uniforms={uniforms}
                    transparent
                    depthWrite={false}
                    blending={THREE.AdditiveBlending}
                    precision="highp"
                />
            </instancedMesh>
        </group>
    );
}
