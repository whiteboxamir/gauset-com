"use client";

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Grid, Html, OrbitControls, PivotControls } from "@react-three/drei";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { TAARenderPass } from "three/examples/jsm/postprocessing/TAARenderPass.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { MapPin } from "lucide-react";
import EnvironmentSplat from "./EnvironmentSplat";
import { toProxyUrl } from "@/lib/mvp-api";
import { resolveEnvironmentRenderState } from "@/lib/mvp-product";
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

function canCreateWebGLContext() {
    if (typeof document === "undefined") return true;
    const canvas = document.createElement("canvas");
    const context =
        canvas.getContext("webgl2", { powerPreference: "high-performance" }) ??
        canvas.getContext("webgl", { powerPreference: "high-performance" }) ??
        (canvas.getContext("experimental-webgl", { powerPreference: "high-performance" }) as
            | WebGLRenderingContext
            | WebGL2RenderingContext
            | null);

    if (!context) {
        return false;
    }

    const loseContext = context.getExtension?.("WEBGL_lose_context");
    loseContext?.loseContext();
    return true;
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

function GLBAsset({
    asset,
    updateAssetTransform,
    readOnly,
}: {
    asset: SceneAsset;
    updateAssetTransform: (instanceId: string, patch: Partial<SceneAsset>) => void;
    readOnly: boolean;
}) {
    const [active, setActive] = useState(false);
    const gltf = useLoader(GLTFLoader, asset.mesh || "");
    const scene = useMemo(() => clone(gltf.scene), [gltf.scene]);

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
        return (
            <Suspense fallback={<LoadingLabel text="Loading mesh..." />}>
                <GLBAsset asset={asset} updateAssetTransform={updateAssetTransform} readOnly={readOnly} />
            </Suspense>
        );
    }

    return <AssetFallbackMesh asset={asset} updateAssetTransform={updateAssetTransform} readOnly={readOnly} />;
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
        perspectiveCamera.fov = viewerFov;
        perspectiveCamera.updateProjectionMatrix();
    }, [perspectiveCamera, viewerFov]);

    useEffect(() => {
        if (!focusRequest || focusRequest.token === lastFocusTokenRef.current) return;
        lastFocusTokenRef.current = focusRequest.token;
        perspectiveCamera.position.set(...focusRequest.position);
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

export default function ThreeOverlay({
    sceneGraph,
    setSceneGraph,
    readOnly = false,
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
    const [renderMode, setRenderMode] = useState<"webgl" | "fallback">("webgl");
    const [renderError, setRenderError] = useState("");
    const [isViewerReady, setIsViewerReady] = useState(false);
    const environmentRenderState = useMemo(
        () => resolveEnvironmentRenderState(normalizedSceneGraph.environment),
        [normalizedSceneGraph.environment],
    );
    const environmentViewerUrl = toProxyUrl(environmentRenderState.viewerUrl);
    const environmentSplatUrl = toProxyUrl(environmentRenderState.splatUrl);
    const environmentMetadata =
        typeof normalizedSceneGraph.environment === "object" ? normalizedSceneGraph.environment?.metadata ?? null : null;
    const referenceImage = environmentRenderState.referenceImage;

    useEffect(() => {
        if (canCreateWebGLContext()) return;
        setIsViewerReady(false);
        setRenderMode("fallback");
        setRenderError("WebGL could not be initialized in this environment.");
    }, []);

    useEffect(() => {
        onViewerReadyChange?.(isViewerReady && renderMode === "webgl");
    }, [isViewerReady, onViewerReadyChange, renderMode]);

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

    const handleCanvasError = (error: Error) => {
        setIsViewerReady(false);
        setRenderMode("fallback");
        setRenderError(error.message || "WebGL viewer failed to initialize.");
    };

    if (renderMode === "fallback") {
        return <ThreeOverlayFallback message={renderError} referenceImage={referenceImage} />;
    }

    return (
        <div className="absolute inset-0 pointer-events-auto z-20">
            <CanvasErrorBoundary onError={handleCanvasError}>
                <Canvas
                    camera={{ position: [5, 4, 6], fov: normalizedSceneGraph.viewer.fov }}
                    dpr={[1, 3]}
                    gl={{
                        powerPreference: "high-performance",
                        antialias: true,
                        alpha: true,
                        depth: true,
                        stencil: false,
                    }}
                    shadows
                    onCreated={({ gl }) => {
                        gl.outputColorSpace = THREE.SRGBColorSpace;
                        gl.toneMapping = THREE.ACESFilmicToneMapping;
                        gl.toneMappingExposure = 1;
                        setRenderError("");
                        setIsViewerReady(true);
                    }}
                    onPointerMissed={() => onSelectPin?.(null)}
                >
                    <color attach="background" args={["#0a0a0a"]} />
                    <TemporalAntialiasingComposer />
                    <ambientLight intensity={0.65} />
                    <directionalLight position={[8, 12, 6]} intensity={1.2} castShadow />

                    <OrbitControls ref={controlsRef} makeDefault enableDamping dampingFactor={0.08} />
                    <Environment preset="city" />
                    <CameraRig
                        viewerFov={normalizedSceneGraph.viewer.fov}
                        controlsRef={controlsRef}
                        focusRequest={focusRequest ?? null}
                        captureRequestKey={captureRequestKey}
                        onCapturePose={onCapturePose}
                        isRecordingPath={isRecordingPath}
                        onPathRecorded={onPathRecorded}
                    />

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

                    {environmentSplatUrl || environmentViewerUrl ? (
                        <Suspense fallback={<LoadingLabel text="Loading environment splat..." />}>
                            <EnvironmentSplat
                                plyUrl={environmentSplatUrl}
                                viewerUrl={environmentViewerUrl}
                                metadata={environmentMetadata}
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
