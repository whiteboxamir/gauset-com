"use client";

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Grid, Html, OrbitControls, PivotControls } from "@react-three/drei";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { TAARenderPass } from "three/examples/jsm/postprocessing/TAARenderPass.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { MapPin } from "lucide-react";
import EnvironmentSplat from "./EnvironmentSplat";
import { toProxyUrl } from "@/lib/mvp-api";
import { resolveEnvironmentRenderState } from "@/lib/mvp-product";
import { isSingleImagePreviewMetadata, resolveViewerCapabilities, ViewerFallbackReason } from "@/lib/mvp-viewer";
import {
    CameraPathFrame,
    CameraPose,
    SpatialPin,
    SpatialPinType,
    Vector3Tuple,
    createId,
    fovToLensMm,
    formatPinTypeLabel,
    normalizeWorkspaceSceneGraph,
    nowIso,
    parseVector3Tuple,
} from "@/lib/mvp-workspace";

type TransformTuple = [number, number, number];

type SceneAsset = {
    instanceId: string;
    name: string;
    mesh?: string;
    position?: TransformTuple;
    rotation?: TransformTuple;
    scale?: TransformTuple;
};

type ParsedMeshAsset = {
    format: "glb" | "gltf" | "obj";
    scene: THREE.Object3D;
};

const EDITOR_CAMERA_NEAR = 0.01;
const EDITOR_CAMERA_FAR = 500;
const DEFAULT_EDITOR_VIEWER_BACKGROUND = "#0a0a0a";
const PREVIEW_CAMERA_ORIENTATION_QUATERNION = new THREE.Quaternion(1, 0, 0, 0);
const sceneBackgroundScratchColor = new THREE.Color();

type FocusRequest = (CameraPose & { token: number }) | null;
type TAARenderPassInternal = TAARenderPass & { accumulateIndex: number };

type ThreeOverlayFallbackProps = {
    message?: string;
    referenceImage?: string | null;
};

class CanvasErrorBoundary extends React.Component<
    {
        onError: (error: Error) => void;
        children: React.ReactNode;
    },
    { hasError: boolean }
> {
    constructor(props: { onError: (error: Error) => void; children: React.ReactNode }) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    componentDidCatch(error: Error) {
        this.props.onError(error);
    }

    render() {
        if (this.state.hasError) {
            return null;
        }
        return this.props.children;
    }
}

function isSingleImagePreviewEnvironment(metadata: any) {
    return isSingleImagePreviewMetadata(metadata);
}

function shouldApplyPreviewOrientation(metadata: any) {
    if (typeof metadata?.rendering?.apply_preview_orientation === "boolean") {
        return metadata.rendering.apply_preview_orientation;
    }

    return isSingleImagePreviewEnvironment(metadata);
}

function rotatePreviewCameraVector(tuple: Vector3Tuple) {
    const rotated = new THREE.Vector3(...tuple).applyQuaternion(PREVIEW_CAMERA_ORIENTATION_QUATERNION);
    return [rotated.x, rotated.y, rotated.z] as Vector3Tuple;
}

function resolveSingleImagePreviewCamera(metadata: any): (CameraPose & { up?: Vector3Tuple }) | null {
    const sourceCamera = metadata?.source_camera;
    if (!sourceCamera || typeof sourceCamera !== "object") {
        return null;
    }

    const applyOrientation = shouldApplyPreviewOrientation(metadata);
    const position = parseVector3Tuple(sourceCamera.position, [0, 0, 0]);
    const target = parseVector3Tuple(sourceCamera.target, [0, 0, 1]);
    const up = parseVector3Tuple(sourceCamera.up, [0, 1, 0]);
    const orientedPosition = applyOrientation ? rotatePreviewCameraVector(position) : position;
    const orientedTarget = applyOrientation ? rotatePreviewCameraVector(target) : target;
    const orientedUp = applyOrientation ? rotatePreviewCameraVector(up) : up;
    const explicitFov = Number(sourceCamera.fov_degrees ?? NaN);
    const focalLengthPx = Number(sourceCamera.focal_length_px ?? NaN);
    const resolutionPx = Array.isArray(sourceCamera.resolution_px) ? sourceCamera.resolution_px.map((value: unknown) => Number(value)) : [];
    const imageHeightPx = Number.isFinite(resolutionPx[1]) ? Math.max(1, resolutionPx[1]) : NaN;
    const derivedFov =
        Number.isFinite(explicitFov) && explicitFov > 1
            ? explicitFov
            : Number.isFinite(focalLengthPx) && focalLengthPx > 1 && Number.isFinite(imageHeightPx)
              ? (2 * Math.atan(imageHeightPx / (2 * focalLengthPx)) * 180) / Math.PI
              : NaN;
    const fov = Number.isFinite(derivedFov) && derivedFov > 1 ? derivedFov : 45;

    return {
        position: orientedPosition,
        target: orientedTarget,
        up: orientedUp,
        fov,
        lens_mm: Math.round(fovToLensMm(fov) * 10) / 10,
    };
}

function applyEditorCameraClipping(camera: THREE.PerspectiveCamera) {
    camera.near = EDITOR_CAMERA_NEAR;
    camera.far = EDITOR_CAMERA_FAR;
}

function LoadingLabel({ text }: { text: string }) {
    return (
        <Html center>
            <div className="text-xs px-3 py-1 rounded bg-neutral-950/80 border border-neutral-700 text-neutral-300">{text}</div>
        </Html>
    );
}

function ThreeOverlayFallback({ message, referenceImage }: ThreeOverlayFallbackProps) {
    return (
        <div className="absolute inset-0 z-20 overflow-hidden rounded-[32px] bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.08),transparent_22%),linear-gradient(180deg,#06080b_0%,#040507_100%)]">
            {referenceImage ? (
                <div
                    className="absolute inset-0 bg-cover bg-center opacity-30"
                    style={{ backgroundImage: `url(${referenceImage})` }}
                />
            ) : null}
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,6,9,0.72),rgba(4,5,7,0.94))]" />
            <div className="relative flex h-full items-center justify-center p-6">
                <div className="w-full max-w-lg rounded-[28px] border border-white/12 bg-[linear-gradient(180deg,rgba(10,14,21,0.94),rgba(7,10,14,0.94))] p-5 text-center shadow-[0_24px_70px_rgba(0,0,0,0.4)] backdrop-blur-xl">
                    <p className="text-[10px] uppercase tracking-[0.28em] text-cyan-100/80">Viewer fallback</p>
                    <p className="mt-3 text-lg font-medium text-white">3D viewer unavailable</p>
                    <p className="mt-2 text-sm leading-6 text-neutral-200">
                        {message || "This browser or environment could not initialize the WebGL viewer. Import, review, export, and other non-3D controls remain available."}
                    </p>
                    <p className="mt-3 text-[11px] leading-5 text-neutral-300">
                        Camera capture, scene-note placement, and path recording stay disabled until the viewer can create a render context.
                    </p>
                </div>
            </div>
        </div>
    );
}

function SingleImagePreviewSurface({ imageUrl }: { imageUrl: string }) {
    return (
        <div className="absolute inset-0 z-20 overflow-hidden rounded-[32px] bg-[linear-gradient(180deg,#040507_0%,#020304_100%)]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.08),transparent_24%)]" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={imageUrl}
                alt=""
                className="h-full w-full object-contain"
                draggable={false}
            />
        </div>
    );
}

function AssetFallbackMesh({
    asset,
    updateAssetTransform,
    readOnly,
}: {
    asset: SceneAsset;
    updateAssetTransform: (instanceId: string, patch: Partial<SceneAsset>) => void;
    readOnly: boolean;
}) {
    const [active, setActive] = useState(false);

    return (
        <PivotControls
            visible={!readOnly && active}
            scale={80}
            depthTest={false}
            lineWidth={3}
            anchor={[0, 0, 0]}
            onDrag={(local) => {
                if (readOnly) return;
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
                position={parseVector3Tuple(asset.position, [0, 0, 0])}
                rotation={parseVector3Tuple(asset.rotation, [0, 0, 0])}
                scale={parseVector3Tuple(asset.scale, [1, 1, 1])}
                onClick={(event) => {
                    if (readOnly) return;
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

function detectMeshFormat(buffer: ArrayBuffer) {
    const headerBytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 64));
    if (headerBytes.length >= 4) {
        const magic = String.fromCharCode(headerBytes[0] ?? 0, headerBytes[1] ?? 0, headerBytes[2] ?? 0, headerBytes[3] ?? 0);
        if (magic === "glTF") {
            return "glb" as const;
        }
    }

    const headerText = new TextDecoder("utf-8").decode(headerBytes).replace(/^\uFEFF/, "").trimStart();
    if (headerText.startsWith("{")) {
        return "gltf" as const;
    }

    if (/^(?:#.*\n\s*)*(?:mtllib|o|g|v|vt|vn|usemtl|s|f)\b/m.test(headerText)) {
        return "obj" as const;
    }

    throw new Error("Unsupported mesh payload format.");
}

function parseGltfAsset(loader: GLTFLoader, payload: ArrayBuffer | string, resourcePath: string) {
    return new Promise<ParsedMeshAsset>((resolve, reject) => {
        loader.parse(
            payload,
            resourcePath,
            (gltf) => {
                resolve({
                    format: payload instanceof ArrayBuffer ? "glb" : "gltf",
                    scene: gltf.scene || new THREE.Group(),
                });
            },
            (error) => {
                reject(error instanceof Error ? error : new Error("GLTF parse failed."));
            },
        );
    });
}

async function loadMeshAsset(meshUrl: string, signal: AbortSignal) {
    const resolvedUrl = toProxyUrl(meshUrl);
    const response = await fetch(resolvedUrl, {
        cache: "force-cache",
        signal,
    });
    if (!response.ok) {
        throw new Error(`Could not load ${resolvedUrl}: ${response.status} ${response.statusText}`.trim());
    }

    const payload = await response.arrayBuffer();
    const format = detectMeshFormat(payload);
    const resourcePath = new URL("./", new URL(resolvedUrl, window.location.href)).toString();

    if (format === "obj") {
        const text = new TextDecoder("utf-8").decode(payload);
        return {
            format,
            scene: new OBJLoader().parse(text),
        } satisfies ParsedMeshAsset;
    }

    const gltfLoader = new GLTFLoader();
    if (format === "glb") {
        return parseGltfAsset(gltfLoader, payload, resourcePath);
    }

    const text = new TextDecoder("utf-8").decode(payload);
    return parseGltfAsset(gltfLoader, text, resourcePath);
}

function MeshAsset({
    asset,
    updateAssetTransform,
    readOnly,
}: {
    asset: SceneAsset;
    updateAssetTransform: (instanceId: string, patch: Partial<SceneAsset>) => void;
    readOnly: boolean;
}) {
    const [active, setActive] = useState(false);
    const [parsedAsset, setParsedAsset] = useState<ParsedMeshAsset | null>(null);
    const [loadError, setLoadError] = useState<Error | null>(null);

    useEffect(() => {
        if (!asset.mesh) {
            setParsedAsset(null);
            setLoadError(null);
            return;
        }

        const abortController = new AbortController();
        let ignore = false;
        setParsedAsset(null);
        setLoadError(null);

        void loadMeshAsset(asset.mesh, abortController.signal)
            .then((nextAsset) => {
                if (ignore || abortController.signal.aborted) {
                    return;
                }
                setParsedAsset(nextAsset);
            })
            .catch((error) => {
                if (ignore || abortController.signal.aborted) {
                    return;
                }
                const resolvedError = error instanceof Error ? error : new Error("Mesh load failed.");
                console.error(`[ThreeOverlay] Mesh asset load failed for ${asset.mesh}`, resolvedError);
                setLoadError(resolvedError);
            });

        return () => {
            ignore = true;
            abortController.abort();
        };
    }, [asset.mesh]);

    const scene = useMemo(() => (parsedAsset ? clone(parsedAsset.scene) : null), [parsedAsset]);

    if (loadError) {
        return <AssetFallbackMesh asset={asset} updateAssetTransform={updateAssetTransform} readOnly={readOnly} />;
    }

    if (!scene) {
        return <LoadingLabel text="Loading mesh..." />;
    }

    return (
        <PivotControls
            visible={!readOnly && active}
            scale={80}
            depthTest={false}
            lineWidth={3}
            anchor={[0, 0, 0]}
            onDrag={(local) => {
                if (readOnly) return;
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
                position={parseVector3Tuple(asset.position, [0, 0, 0])}
                rotation={parseVector3Tuple(asset.rotation, [0, 0, 0])}
                scale={parseVector3Tuple(asset.scale, [1, 1, 1])}
                onClick={(event) => {
                    if (readOnly) return;
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
    readOnly,
}: {
    asset: SceneAsset;
    updateAssetTransform: (instanceId: string, patch: Partial<SceneAsset>) => void;
    readOnly: boolean;
}) {
    if (asset.mesh) {
        return <MeshAsset asset={asset} updateAssetTransform={updateAssetTransform} readOnly={readOnly} />;
    }

    return null;
}

function pinColors(type: SpatialPinType, isSelected: boolean) {
    if (type === "egress") {
        return isSelected ? "bg-emerald-400 border-emerald-200 text-black" : "bg-emerald-500/15 border-emerald-500 text-emerald-300";
    }
    if (type === "lighting") {
        return isSelected ? "bg-amber-300 border-amber-100 text-black" : "bg-amber-500/15 border-amber-500 text-amber-300";
    }
    if (type === "hazard") {
        return isSelected ? "bg-rose-400 border-rose-200 text-black" : "bg-rose-500/15 border-rose-500 text-rose-300";
    }
    return isSelected ? "bg-sky-400 border-sky-200 text-black" : "bg-sky-500/15 border-sky-500 text-sky-300";
}

function PinLayer({
    pins,
    selectedPinId,
    isPlacingPin,
    pinType,
    readOnly,
    onAddPin,
    onSelectPin,
}: {
    pins: SpatialPin[];
    selectedPinId?: string | null;
    isPlacingPin: boolean;
    pinType: SpatialPinType;
    readOnly: boolean;
    onAddPin: (pin: SpatialPin) => void;
    onSelectPin?: (pinId: string | null) => void;
}) {
    const { camera, pointer, raycaster, scene } = useThree();
    const [hoverPosition, setHoverPosition] = useState<THREE.Vector3 | null>(null);

    useFrame(() => {
        if (!isPlacingPin || readOnly) {
            setHoverPosition((prev) => (prev ? null : prev));
            return;
        }
        raycaster.setFromCamera(pointer, camera);
        const intersections = raycaster.intersectObjects(scene.children, true);
        if (intersections.length > 0) {
            setHoverPosition(intersections[0].point.clone());
        } else {
            setHoverPosition(null);
        }
    });

    const handlePointerDown = (event: { stopPropagation: () => void }) => {
        if (!isPlacingPin || readOnly || !hoverPosition) return;
        event.stopPropagation();
        onAddPin({
            id: createId("pin"),
            label: `${formatPinTypeLabel(pinType)} Pin`,
            type: pinType,
            position: [hoverPosition.x, hoverPosition.y, hoverPosition.z],
            created_at: nowIso(),
        });
    };

    return (
        <group onPointerDown={handlePointerDown}>
            {isPlacingPin && hoverPosition ? (
                <group position={hoverPosition}>
                    <Html center zIndexRange={[100, 0]}>
                        <div className="flex flex-col items-center opacity-75 pointer-events-none">
                            <div className="mb-1 rounded-full border border-white/20 bg-black/70 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-white/80">
                                Drop {formatPinTypeLabel(pinType)}
                            </div>
                            <MapPin className="h-5 w-5 text-sky-300" />
                        </div>
                    </Html>
                </group>
            ) : null}
            {pins.map((pin) => {
                const isSelected = pin.id === selectedPinId;
                return (
                    <group key={pin.id} position={pin.position}>
                        <Html center distanceFactor={10} zIndexRange={[100, 0]}>
                            <button
                                type="button"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onSelectPin?.(pin.id);
                                }}
                                className={`group relative flex h-8 w-8 items-center justify-center rounded-full border text-xs shadow-lg transition-transform hover:scale-110 ${pinColors(pin.type, isSelected)}`}
                                title={pin.label}
                            >
                                <MapPin className="h-4 w-4" />
                                <span className="pointer-events-none absolute bottom-full mb-2 whitespace-nowrap rounded-full border border-white/10 bg-black/80 px-2 py-1 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                                    {pin.label}
                                </span>
                            </button>
                        </Html>
                    </group>
                );
            })}
        </group>
    );
}

function CameraRig({
    viewerFov,
    controlsRef,
    focusRequest,
    captureRequestKey,
    onCapturePose,
    isRecordingPath,
    onPathRecorded,
}: {
    viewerFov: number;
    controlsRef: React.MutableRefObject<any>;
    focusRequest: FocusRequest;
    captureRequestKey: number;
    onCapturePose?: (pose: CameraPose) => void;
    isRecordingPath: boolean;
    onPathRecorded?: (path: CameraPathFrame[]) => void;
}) {
    const { camera } = useThree();
    const perspectiveCamera = camera as THREE.PerspectiveCamera;
    const pathRef = useRef<CameraPathFrame[]>([]);
    const lastCaptureRequestRef = useRef<number>(0);
    const lastFocusTokenRef = useRef<number>(0);
    const lastSampleRef = useRef<number>(-1);
    const startTimeRef = useRef<number>(0);

    useEffect(() => {
        applyEditorCameraClipping(perspectiveCamera);
        perspectiveCamera.fov = viewerFov;
        perspectiveCamera.updateProjectionMatrix();
    }, [perspectiveCamera, viewerFov]);

    useEffect(() => {
        if (!focusRequest || focusRequest.token === lastFocusTokenRef.current) return;
        lastFocusTokenRef.current = focusRequest.token;
        perspectiveCamera.position.set(...focusRequest.position);
        if (focusRequest.up) {
            perspectiveCamera.up.set(...focusRequest.up);
        } else {
            perspectiveCamera.up.set(0, 1, 0);
        }
        applyEditorCameraClipping(perspectiveCamera);
        perspectiveCamera.fov = focusRequest.fov;
        perspectiveCamera.updateProjectionMatrix();
        if (controlsRef.current?.target) {
            controlsRef.current.target.set(...focusRequest.target);
            controlsRef.current.update();
        }
    }, [controlsRef, focusRequest, perspectiveCamera]);

    useEffect(() => {
        if (!onCapturePose || captureRequestKey === 0 || captureRequestKey === lastCaptureRequestRef.current) return;
        lastCaptureRequestRef.current = captureRequestKey;
        const target = controlsRef.current?.target
            ? ([controlsRef.current.target.x, controlsRef.current.target.y, controlsRef.current.target.z] as Vector3Tuple)
            : ([0, 0, 0] as Vector3Tuple);
        onCapturePose({
            position: [perspectiveCamera.position.x, perspectiveCamera.position.y, perspectiveCamera.position.z],
            target,
            fov: perspectiveCamera.fov,
            lens_mm: Math.round(fovToLensMm(perspectiveCamera.fov) * 10) / 10,
        });
    }, [captureRequestKey, controlsRef, onCapturePose, perspectiveCamera]);

    useEffect(() => {
        if (isRecordingPath) {
            pathRef.current = [];
            lastSampleRef.current = -1;
            startTimeRef.current = 0;
            return;
        }
        if (pathRef.current.length > 0 && onPathRecorded) {
            onPathRecorded([...pathRef.current]);
            pathRef.current = [];
        }
    }, [isRecordingPath, onPathRecorded]);

    useFrame((state) => {
        if (!isRecordingPath) return;
        if (startTimeRef.current === 0) {
            startTimeRef.current = state.clock.elapsedTime;
        }
        const elapsed = state.clock.elapsedTime - startTimeRef.current;
        if (lastSampleRef.current >= 0 && elapsed - lastSampleRef.current < 0.08) {
            return;
        }
        lastSampleRef.current = elapsed;
        const target = controlsRef.current?.target
            ? ([controlsRef.current.target.x, controlsRef.current.target.y, controlsRef.current.target.z] as Vector3Tuple)
            : ([0, 0, 0] as Vector3Tuple);
        pathRef.current.push({
            time: Number(elapsed.toFixed(3)),
            position: [perspectiveCamera.position.x, perspectiveCamera.position.y, perspectiveCamera.position.z],
            target,
            rotation: [
                perspectiveCamera.quaternion.x,
                perspectiveCamera.quaternion.y,
                perspectiveCamera.quaternion.z,
                perspectiveCamera.quaternion.w,
            ],
            fov: perspectiveCamera.fov,
        });
    });

    return null;
}

function TemporalAntialiasingComposer() {
    const { camera, gl, scene, size } = useThree();
    const composerRef = useRef<EffectComposer | null>(null);
    const taaPassRef = useRef<TAARenderPassInternal | null>(null);
    const lastCameraPositionRef = useRef(new THREE.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY));
    const lastCameraQuaternionRef = useRef(new THREE.Quaternion());
    const lastProjectionMatrixRef = useRef(new THREE.Matrix4());

    useEffect(() => {
        const composer = new EffectComposer(gl);
        composer.setPixelRatio(gl.getPixelRatio());
        composer.setSize(size.width, size.height);

        const taaPass = new TAARenderPass(scene, camera, 0x000000, 0) as TAARenderPassInternal;
        taaPass.unbiased = true;
        taaPass.sampleLevel = 2;
        taaPass.accumulate = true;
        taaPass.accumulateIndex = -1;
        composer.addPass(taaPass);

        composerRef.current = composer;
        taaPassRef.current = taaPass;
        lastCameraPositionRef.current.copy(camera.position);
        lastCameraQuaternionRef.current.copy(camera.quaternion);
        lastProjectionMatrixRef.current.copy(camera.projectionMatrix);

        return () => {
            taaPass.dispose();
            composer.dispose();
            composerRef.current = null;
            taaPassRef.current = null;
        };
    }, [camera, gl, scene, size.height, size.width]);

    useEffect(() => {
        const composer = composerRef.current;
        const taaPass = taaPassRef.current;
        if (!composer || !taaPass) {
            return;
        }

        composer.setPixelRatio(gl.getPixelRatio());
        composer.setSize(size.width, size.height);
        taaPass.accumulateIndex = -1;
    }, [gl, size.height, size.width]);

    useFrame((_, delta) => {
        const composer = composerRef.current;
        const taaPass = taaPassRef.current;
        if (!composer || !taaPass) {
            return;
        }

        const positionDeltaSq = lastCameraPositionRef.current.distanceToSquared(camera.position);
        const rotationDelta = 1 - Math.abs(lastCameraQuaternionRef.current.dot(camera.quaternion));
        const projectionChanged = !lastProjectionMatrixRef.current.equals(camera.projectionMatrix);

        if (positionDeltaSq > 1e-8 || rotationDelta > 1e-8 || projectionChanged) {
            taaPass.accumulateIndex = -1;
            lastCameraPositionRef.current.copy(camera.position);
            lastCameraQuaternionRef.current.copy(camera.quaternion);
            lastProjectionMatrixRef.current.copy(camera.projectionMatrix);
        }

        composer.render(delta);
    }, 1);

    return null;
}

function SceneBackgroundLock({ backgroundColor }: { backgroundColor: string }) {
    const { gl, scene } = useThree();
    const background = useMemo(() => new THREE.Color(backgroundColor), [backgroundColor]);

    useEffect(() => {
        const previousBackground = scene.background;
        const previousClearColor = gl.getClearColor(new THREE.Color()).clone();
        const previousClearAlpha = gl.getClearAlpha();

        scene.background = background;
        gl.setClearColor(background, 1);
        gl.domElement.style.backgroundColor = backgroundColor;

        return () => {
            scene.background = previousBackground;
            gl.setClearColor(previousClearColor, previousClearAlpha);
        };
    }, [background, backgroundColor, gl, scene]);

    useFrame(() => {
        if (!(scene.background instanceof THREE.Color) || !scene.background.equals(background)) {
            scene.background = background;
        }

        if (!gl.getClearColor(sceneBackgroundScratchColor).equals(background) || gl.getClearAlpha() !== 1) {
            gl.setClearColor(background, 1);
        }

        if (gl.domElement.style.backgroundColor !== backgroundColor) {
            gl.domElement.style.backgroundColor = backgroundColor;
        }
    }, -1);

    return null;
}

export default function ThreeOverlay({
    sceneGraph,
    setSceneGraph,
    readOnly = false,
    backgroundColor = DEFAULT_EDITOR_VIEWER_BACKGROUND,
    selectedPinId,
    onSelectPin,
    focusRequest,
    captureRequestKey = 0,
    onCapturePose,
    isPinPlacementEnabled = false,
    pinType = "general",
    isRecordingPath = false,
    onPathRecorded,
    onViewerReadyChange,
}: {
    sceneGraph: any;
    setSceneGraph: React.Dispatch<React.SetStateAction<any>>;
    readOnly?: boolean;
    backgroundColor?: string;
    selectedPinId?: string | null;
    onSelectPin?: (pinId: string | null) => void;
    focusRequest?: FocusRequest;
    captureRequestKey?: number;
    onCapturePose?: (pose: CameraPose) => void;
    isPinPlacementEnabled?: boolean;
    pinType?: SpatialPinType;
    isRecordingPath?: boolean;
    onPathRecorded?: (path: CameraPathFrame[]) => void;
    onViewerReadyChange?: (ready: boolean) => void;
}) {
    const normalizedSceneGraph = useMemo(() => normalizeWorkspaceSceneGraph(sceneGraph), [sceneGraph]);
    const controlsRef = useRef<any>(null);
    const canvasEventCleanupRef = useRef<(() => void) | null>(null);
    const previewAutofocusKeyRef = useRef("");
    const [renderMode, setRenderMode] = useState<"webgl" | "fallback">("webgl");
    const [renderError, setRenderError] = useState("");
    const [isViewerReady, setIsViewerReady] = useState(false);
    const [previewAutofocusRequest, setPreviewAutofocusRequest] = useState<FocusRequest>(null);
    const environmentRenderState = useMemo(
        () => resolveEnvironmentRenderState(normalizedSceneGraph.environment),
        [normalizedSceneGraph.environment],
    );
    const environmentViewerUrl = toProxyUrl(environmentRenderState.viewerUrl);
    const environmentSplatUrl = toProxyUrl(environmentRenderState.splatUrl);
    const previewProjectionImage = toProxyUrl(environmentRenderState.previewProjectionImage);
    const environmentMetadata =
        typeof normalizedSceneGraph.environment === "object" ? normalizedSceneGraph.environment?.metadata ?? null : null;
    const referenceImage = environmentRenderState.referenceImage;
    const isSingleImagePreview = isSingleImagePreviewEnvironment(environmentMetadata);
    const viewerDecision = useMemo(
        () =>
            resolveViewerCapabilities({
                plyUrl: environmentSplatUrl,
                viewerUrl: environmentViewerUrl,
                metadata: environmentMetadata,
            }),
        [environmentMetadata, environmentSplatUrl, environmentViewerUrl],
    );
    const hasRenderableEnvironment = Boolean(environmentSplatUrl || environmentViewerUrl);
    const shouldUsePreviewProjectionFallback = renderMode !== "fallback" && !hasRenderableEnvironment && Boolean(previewProjectionImage);
    const singleImagePreviewCamera = useMemo(() => resolveSingleImagePreviewCamera(environmentMetadata), [environmentMetadata]);
    const effectiveFocusRequest =
        previewAutofocusRequest && (!focusRequest || previewAutofocusRequest.token >= focusRequest.token)
            ? previewAutofocusRequest
            : focusRequest ?? null;

    const activateViewerFallback = React.useCallback((message: string) => {
        setIsViewerReady(false);
        setRenderMode("fallback");
        setRenderError(message);
    }, []);

    useEffect(() => {
        if (viewerDecision.renderMode !== "fallback") {
            setRenderMode("webgl");
            setRenderError("");
            return;
        }

        activateViewerFallback(viewerDecision.fallbackMessage);
    }, [activateViewerFallback, viewerDecision.fallbackMessage, viewerDecision.renderMode]);

    useEffect(() => {
        return () => {
            canvasEventCleanupRef.current?.();
            canvasEventCleanupRef.current = null;
        };
    }, []);

    useEffect(() => {
        onViewerReadyChange?.(isViewerReady && renderMode === "webgl");
    }, [isViewerReady, onViewerReadyChange, renderMode]);

    useEffect(() => {
        previewAutofocusKeyRef.current = "";
        setPreviewAutofocusRequest(null);
    }, [environmentSplatUrl, environmentViewerUrl, isSingleImagePreview]);

    const updateAssetTransform = (instanceId: string, patch: Partial<SceneAsset>) => {
        setSceneGraph((prev: any) => {
            const normalized = normalizeWorkspaceSceneGraph(prev);
            return {
                ...normalized,
                assets: normalized.assets.map((asset: SceneAsset) => (asset.instanceId === instanceId ? { ...asset, ...patch } : asset)),
            };
        });
    };

    const addPin = (pin: SpatialPin) => {
        setSceneGraph((prev: any) => {
            const normalized = normalizeWorkspaceSceneGraph(prev);
            return {
                ...normalized,
                pins: [...normalized.pins, pin],
            };
        });
        onSelectPin?.(pin.id);
    };

    const handleCanvasError = React.useCallback(
        (error: Error) => {
            activateViewerFallback(error.message || "WebGL viewer failed to initialize.");
        },
        [activateViewerFallback],
    );

    const handleEnvironmentFatalError = React.useCallback(
        (message: string, reason: ViewerFallbackReason) => {
            const normalizedMessage = message.trim().toLowerCase();
            if (
                reason === "texture_size_exceeded" ||
                reason === "context_lost" ||
                normalizedMessage.includes("webgl2") ||
                normalizedMessage.includes("ext_color_buffer_float")
            ) {
                activateViewerFallback(message);
            }
        },
        [activateViewerFallback],
    );

    const handlePreviewBounds = (bounds: { center: [number, number, number]; radius: number; forward?: [number, number, number] }) => {
        if (!isSingleImagePreview) {
            return;
        }

        if (singleImagePreviewCamera) {
            const key = `${environmentSplatUrl}|source-camera|${singleImagePreviewCamera.position.join(",")}|${singleImagePreviewCamera.target.join(",")}|${singleImagePreviewCamera.fov.toFixed(3)}`;
            if (previewAutofocusKeyRef.current === key) {
                return;
            }
            previewAutofocusKeyRef.current = key;
            setPreviewAutofocusRequest({
                ...singleImagePreviewCamera,
                token: Date.now(),
            });
            return;
        }

        const key = `${environmentSplatUrl}|${bounds.center.join(",")}|${bounds.radius.toFixed(4)}|${(bounds.forward ?? [0, 0, 1]).join(",")}|${normalizedSceneGraph.viewer.fov.toFixed(2)}`;
        if (previewAutofocusKeyRef.current === key) {
            return;
        }
        previewAutofocusKeyRef.current = key;

        const radius = Math.max(0.1, bounds.radius);
        const verticalFovRadians = THREE.MathUtils.degToRad(normalizedSceneGraph.viewer.fov);
        const distance = Math.max(radius * 1.75, (radius / Math.tan(verticalFovRadians * 0.5)) * 0.96);
        const forward = new THREE.Vector3(...(bounds.forward ?? [0, 0, 1]));
        if (forward.lengthSq() <= 1e-6) {
            forward.set(0, 0, 1);
        }
        forward.normalize();
        const position = new THREE.Vector3(...bounds.center).addScaledVector(forward, distance);

        setPreviewAutofocusRequest({
            position: [position.x, position.y, position.z],
            target: bounds.center,
            fov: normalizedSceneGraph.viewer.fov,
            lens_mm: Math.round(fovToLensMm(normalizedSceneGraph.viewer.fov) * 10) / 10,
            token: Date.now(),
        });
    };

    if (shouldUsePreviewProjectionFallback && previewProjectionImage) {
        return <SingleImagePreviewSurface imageUrl={previewProjectionImage} />;
    }

    if (renderMode === "fallback") {
        return <ThreeOverlayFallback message={renderError} referenceImage={referenceImage} />;
    }

    return (
        <div className="absolute inset-0 pointer-events-auto z-20">
            <CanvasErrorBoundary onError={handleCanvasError}>
                <Canvas
                    camera={{ position: [5, 4, 6], fov: normalizedSceneGraph.viewer.fov, near: EDITOR_CAMERA_NEAR, far: EDITOR_CAMERA_FAR }}
                    dpr={isSingleImagePreview ? [1, 2] : [1, 3]}
                    style={{ background: backgroundColor, touchAction: "none" }}
                    gl={{
                        powerPreference: "high-performance",
                        antialias: true,
                        alpha: true,
                        depth: true,
                        stencil: false,
                    }}
                    shadows={!isSingleImagePreview}
                    onCreated={({ gl }) => {
                        canvasEventCleanupRef.current?.();
                        const handleContextLost = (event: Event) => {
                            event.preventDefault();
                            activateViewerFallback("WebGL context was lost while rendering the viewer.");
                        };
                        const handleContextRestored = () => {
                            setRenderError("");
                        };
                        gl.domElement.addEventListener("webglcontextlost", handleContextLost, false);
                        gl.domElement.addEventListener("webglcontextrestored", handleContextRestored, false);
                        canvasEventCleanupRef.current = () => {
                            gl.domElement.removeEventListener("webglcontextlost", handleContextLost, false);
                            gl.domElement.removeEventListener("webglcontextrestored", handleContextRestored, false);
                        };

                        gl.setClearColor(backgroundColor, 1);
                        gl.domElement.style.backgroundColor = backgroundColor;
                        gl.outputColorSpace = THREE.SRGBColorSpace;
                        gl.toneMapping = THREE.ACESFilmicToneMapping;
                        gl.toneMappingExposure = 1;
                        setRenderError("");
                        setIsViewerReady(true);
                    }}
                    onPointerMissed={() => onSelectPin?.(null)}
                >
                    <SceneBackgroundLock backgroundColor={backgroundColor} />
                    {!isSingleImagePreview ? <TemporalAntialiasingComposer /> : null}
                    <ambientLight intensity={isSingleImagePreview ? 0.35 : 0.65} />
                    {!isSingleImagePreview ? <directionalLight position={[8, 12, 6]} intensity={1.2} castShadow /> : null}

                    <OrbitControls ref={controlsRef} makeDefault enableDamping dampingFactor={0.08} />
                    {!isSingleImagePreview ? <Environment preset="city" background={false} /> : null}
                    <CameraRig
                        viewerFov={normalizedSceneGraph.viewer.fov}
                        controlsRef={controlsRef}
                        focusRequest={effectiveFocusRequest}
                        captureRequestKey={captureRequestKey}
                        onCapturePose={onCapturePose}
                        isRecordingPath={isRecordingPath}
                        onPathRecorded={onPathRecorded}
                    />

                    {!isSingleImagePreview ? (
                        <>
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
                        </>
                    ) : null}

                    {environmentSplatUrl || environmentViewerUrl ? (
                        <Suspense fallback={<LoadingLabel text="Loading environment splat..." />}>
                            <EnvironmentSplat
                                plyUrl={environmentSplatUrl}
                                viewerUrl={environmentViewerUrl}
                                metadata={environmentMetadata}
                                onPreviewBounds={handlePreviewBounds}
                                onFatalError={handleEnvironmentFatalError}
                            />
                        </Suspense>
                    ) : null}

                    {(normalizedSceneGraph.assets ?? []).map((asset: SceneAsset, index: number) => (
                        <SceneAssetNode
                            key={asset.instanceId || `${asset.name}-${index}`}
                            asset={asset}
                            updateAssetTransform={updateAssetTransform}
                            readOnly={readOnly}
                        />
                    ))}

                    <PinLayer
                        pins={normalizedSceneGraph.pins}
                        selectedPinId={selectedPinId}
                        isPlacingPin={isPinPlacementEnabled}
                        pinType={pinType}
                        readOnly={readOnly}
                        onAddPin={addPin}
                        onSelectPin={onSelectPin}
                    />
                </Canvas>
            </CanvasErrorBoundary>
        </div>
    );
}
