'use client';

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useScroll } from '@react-three/drei';
import * as THREE from 'three';
import { VoidWorld } from './worlds/VoidWorld';
import { FractureWorld } from './worlds/FractureWorld';
import { StudioWorld } from './worlds/StudioWorld';
import { PersistentShotWorld } from './worlds/PersistentShotWorld';
import { HorizonWorld } from './worlds/HorizonWorld';

/*
  5 WORLDS — Each a distinct film genre
  
  1. VOID: Deep atmospheric space (cool blue/purple)
  2. FRACTURE: Broken AI chaos (red/orange)
  3. PRODUCTION: Realistic film set (warm tungsten)
  4. PERSISTENT SHOTS: Same world multi-angle (THE reveal)
  5. HORIZON: Bright cinematic future (golden daylight)
*/

const WORLD_COUNT = 5;

// Camera keyframes: cinematic positions per world
// Void: static distant observer — slow, contemplative
// Fracture: offset lateral — unstable feel
// Production: crane-up reveal — discovering the set
// Persistent: FOUR sub-positions (wide → close-up → OTS → tracking)
// Horizon: wide low-angle — expansive
const CAMERA_POSITIONS = [
    new THREE.Vector3(0, 0, 22),        // Void: far, centered
    new THREE.Vector3(6, 1, 16),        // Fracture: off-axis, angled
    new THREE.Vector3(3, 4, 14),        // Production: crane reveal
    new THREE.Vector3(0, 1, 12),        // Persistent: starts wide (overridden per sub-shot)
    new THREE.Vector3(0, -1, 18),       // Horizon: wide, slightly low
];

const CAMERA_LOOK_AT = [
    new THREE.Vector3(0, 0, -5),        // Void: into the void
    new THREE.Vector3(-2, 0, -5),       // Fracture: slightly off
    new THREE.Vector3(0, 0, -5),        // Production: set center
    new THREE.Vector3(0, 0, -5),        // Persistent: set center
    new THREE.Vector3(0, 2, -20),       // Horizon: toward the distance
];

// Persistent Shot sub-keyframes (4 camera angles within the same world)
const PERSISTENT_CAMERAS = [
    { pos: new THREE.Vector3(0, 1, 16), look: new THREE.Vector3(0, 0, -5) },   // WIDE
    { pos: new THREE.Vector3(0.5, 0.8, 2), look: new THREE.Vector3(0, 0.8, -5) }, // CLOSE-UP
    { pos: new THREE.Vector3(4.5, 1.5, -4), look: new THREE.Vector3(-1, 0, -6) },  // OTS
    { pos: new THREE.Vector3(-8, 0.5, 0), look: new THREE.Vector3(3, 0, -5) },   // TRACKING
];

// Per-world fog colors for atmospheric transitions
const WORLD_FOG_COLORS = [
    new THREE.Color('#050510'), // Void: deep blue-black
    new THREE.Color('#1a0505'), // Fracture: dark red
    new THREE.Color('#02040a'), // Production: deep cyber blue
    new THREE.Color('#1a0033'), // Persistent: wildly alive deep space magenta/purple
    new THREE.Color('#1a2a35'), // Horizon: warm blue
];

const _tempVec3 = new THREE.Vector3();
const _tempLook = new THREE.Vector3();
const _smoothPos = new THREE.Vector3(0, 0, 22);
const _smoothLook = new THREE.Vector3(0, 0, -5);
const _finalLook = new THREE.Vector3();
const _fogColor = new THREE.Color('#050510');

export function WorldRenderer() {
    const scroll = useScroll();
    const targetPos = useRef(new THREE.Vector3());
    const targetLook = useRef(new THREE.Vector3());

    const worldState = useMemo(() => ({
        visibility: new Float32Array(WORLD_COUNT),
        progress: new Float32Array(WORLD_COUNT),
    }), []);

    useFrame((state, delta) => {
        // Strict firewall: clamp offset so iOS rubber-banding cannot force it < 0 or > 1,
        // preventing NaN errors and undefined array lookups in WebGL math
        const offset = THREE.MathUtils.clamp(scroll.offset, 0, 1);

        // Calculate per-world visibility and local progress
        for (let i = 0; i < WORLD_COUNT; i++) {
            const worldStart = i / WORLD_COUNT;
            const worldEnd = (i + 1) / WORLD_COUNT;
            const worldMid = (worldStart + worldEnd) / 2;
            const worldHalf = (worldEnd - worldStart) / 2;

            const dist = Math.abs(offset - worldMid);
            const fadeWidth = worldHalf * 1.2;
            worldState.visibility[i] = Math.max(0, 1 - dist / fadeWidth);

            worldState.progress[i] = THREE.MathUtils.clamp(
                (offset - worldStart) / (worldEnd - worldStart),
                0, 1
            );
        }

        // Calculate camera target based on current world
        const exactWorld = offset * WORLD_COUNT;
        const worldIndex = Math.min(Math.floor(exactWorld), WORLD_COUNT - 1);
        const nextIndex = Math.min(worldIndex + 1, WORLD_COUNT - 1);
        const t = exactWorld - worldIndex;
        // Smootherstep for silky easing
        const eased = t * t * t * (t * (t * 6 - 15) + 10);

        // Special handling for Persistent Shot world (index 3)
        if (worldIndex === 3) {
            // Four sub-shots within this world
            const subProgress = worldState.progress[3];
            const subIndex = Math.min(Math.floor(subProgress * 4), 3);
            const nextSubIndex = Math.min(subIndex + 1, 3);
            const subT = (subProgress * 4) - subIndex;
            const subEased = subT * subT * (3 - 2 * subT);

            _tempVec3.lerpVectors(PERSISTENT_CAMERAS[subIndex].pos, PERSISTENT_CAMERAS[nextSubIndex].pos, subEased);
            _tempLook.lerpVectors(PERSISTENT_CAMERAS[subIndex].look, PERSISTENT_CAMERAS[nextSubIndex].look, subEased);

            targetPos.current.copy(_tempVec3);
            targetLook.current.copy(_tempLook);
        } else if (worldIndex === 3 - 1 && nextIndex === 3) {
            // Transitioning into persistent world — approach the first sub-camera
            _tempVec3.lerpVectors(CAMERA_POSITIONS[worldIndex], PERSISTENT_CAMERAS[0].pos, eased);
            _tempLook.lerpVectors(CAMERA_LOOK_AT[worldIndex], PERSISTENT_CAMERAS[0].look, eased);
            targetPos.current.copy(_tempVec3);
            targetLook.current.copy(_tempLook);
        } else if (worldIndex === 3 && nextIndex === 4) {
            // Transitioning out of persistent world
            _tempVec3.lerpVectors(PERSISTENT_CAMERAS[3].pos, CAMERA_POSITIONS[nextIndex], eased);
            _tempLook.lerpVectors(PERSISTENT_CAMERAS[3].look, CAMERA_LOOK_AT[nextIndex], eased);
            targetPos.current.copy(_tempVec3);
            targetLook.current.copy(_tempLook);
        } else {
            _tempVec3.lerpVectors(CAMERA_POSITIONS[worldIndex], CAMERA_POSITIONS[nextIndex], eased);
            _tempLook.lerpVectors(CAMERA_LOOK_AT[worldIndex], CAMERA_LOOK_AT[nextIndex], eased);
            targetPos.current.copy(_tempVec3);
            targetLook.current.copy(_tempLook);
        }

        // Smooth camera movement with exponential damping (dolly feel)
        const dampFactor = 1 - Math.exp(-2.5 * delta);
        _smoothPos.lerp(targetPos.current, dampFactor);
        _smoothLook.lerp(targetLook.current, dampFactor);

        // --- Heavy Steadicam Breathing Effect ---
        // Tweaking variables for the organic camera drift
        const breathSpeed = 0.4;
        const breathAmplitudePos = 0.08;  // Bumped to 0.08 for visibility
        const breathAmplitudeLook = 0.04; // Boosted rotational drift

        const time = state.clock.elapsedTime;
        const breathOffsetX = Math.sin(time * breathSpeed) * breathAmplitudePos;
        const breathOffsetY = Math.cos(time * breathSpeed * 0.8) * breathAmplitudePos;

        const lookOffsetX = Math.sin(time * breathSpeed * 1.2) * breathAmplitudeLook;
        const lookOffsetY = Math.cos(time * breathSpeed * 0.9) * breathAmplitudeLook;

        // Apply breathing strictly ON TOP of the smooth dampened position
        // so the scrolling logic doesn't fight or swallow the drift.
        state.camera.position.set(
            _smoothPos.x + breathOffsetX,
            _smoothPos.y + breathOffsetY,
            _smoothPos.z
        );

        _finalLook.set(
            _smoothLook.x + lookOffsetX,
            _smoothLook.y + lookOffsetY,
            _smoothLook.z
        );

        state.camera.lookAt(_finalLook);

        // Interpolate fog/background color per world
        if (worldIndex < WORLD_COUNT - 1) {
            _fogColor.lerpColors(WORLD_FOG_COLORS[worldIndex], WORLD_FOG_COLORS[nextIndex], eased);
        } else {
            _fogColor.copy(WORLD_FOG_COLORS[worldIndex]);
        }

        // Update scene fog and background
        if (state.scene.fog instanceof THREE.Fog) {
            state.scene.fog.color.copy(_fogColor);
        }
        if (state.scene.background instanceof THREE.Color) {
            state.scene.background.copy(_fogColor);
        }
    });

    return (
        <group>
            <VoidWorld visibility={worldState.visibility} progress={worldState.progress} index={0} />
            <FractureWorld visibility={worldState.visibility} progress={worldState.progress} index={1} />
            <StudioWorld visibility={worldState.visibility} progress={worldState.progress} index={2} />
            <PersistentShotWorld visibility={worldState.visibility} progress={worldState.progress} index={3} />
            <HorizonWorld visibility={worldState.visibility} progress={worldState.progress} index={4} />
        </group>
    );
}
