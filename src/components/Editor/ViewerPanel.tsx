"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Focus, MapPin, Maximize2, Minimize2, ScanLine, Video } from "lucide-react";
import ThreeOverlay from "./ThreeOverlay";
import { describeEnvironment, resolveEnvironmentRenderState } from "@/lib/mvp-product";
import {
    CameraPathFrame,
    CameraPose,
    CameraView,
    SpatialPinType,
    WorkspaceSceneGraph,
    createId,
    lensMmToFov,
    normalizeWorkspaceSceneGraph,
} from "@/lib/mvp-workspace";

type FocusRequest = (CameraPose & { token: number }) | null;

const LENS_PRESETS = [18, 24, 35, 50, 85];

function formatPathDuration(path: CameraPathFrame[]) {
    if (path.length < 2) return "0.0s";
    const duration = path[path.length - 1].time - path[0].time;
    return `${duration.toFixed(1)}s`;
}

function EmptyViewerState({ clarityMode }: { clarityMode: boolean }) {
    return (
        <div
            className="absolute inset-0 z-20 overflow-hidden bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.1),transparent_24%),linear-gradient(180deg,#06080c_0%,#040507_100%)]"
            data-testid="mvp-empty-viewer-state"
        >
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(8,14,22,0.2),transparent_38%,rgba(34,197,94,0.08)_100%)]" />
            <div className="relative flex h-full items-center justify-center p-6">
                <div className="w-full max-w-xl rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(9,12,18,0.9),rgba(7,9,13,0.86))] p-6 text-center shadow-[0_30px_80px_rgba(0,0,0,0.42)] backdrop-blur-xl">
                    <p className="text-[10px] uppercase tracking-[0.28em] text-cyan-100/75">Viewer standby</p>
                    <p className="mt-3 text-2xl font-medium text-white">No world loaded yet</p>
                    <p className="mt-3 text-sm leading-6 text-neutral-300">
                        Import a scout still, generate a preview world, or reopen a real saved draft before the live viewer boots.
                    </p>
                    <div className="mt-5 grid gap-3 text-left sm:grid-cols-2">
                        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">World state</p>
                            <p className="mt-2 text-sm text-white">The viewer now stays in a dark standby state until it has renderable scene content.</p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Next move</p>
                            <p className="mt-2 text-sm text-white">
                                {clarityMode ? "Open the demo world or upload a still to build the first persistent scene." : "Upload one still or resume a saved scene with a real world output."}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function StaticReferenceViewer({
    referenceImage,
    title,
    description,
}: {
    referenceImage: string;
    title: string;
    description: string;
}) {
    return (
        <div
            className="absolute inset-0 z-20 overflow-hidden bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.08),transparent_24%),linear-gradient(180deg,#06080c_0%,#040507_100%)]"
            data-testid="mvp-static-reference-viewer"
        >
            <div className="absolute inset-0 bg-cover bg-center opacity-55" style={{ backgroundImage: `url(${referenceImage})` }} />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,7,11,0.2),rgba(4,7,11,0.42)_48%,rgba(4,7,11,0.88)_100%)]" />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.12),transparent_28%)]" />
            <div className="relative flex h-full items-end p-6">
                <div className="w-full max-w-sm overflow-hidden rounded-[24px] border border-white/12 bg-[linear-gradient(180deg,rgba(8,11,16,0.92),rgba(7,10,14,0.96))] shadow-[0_24px_70px_rgba(0,0,0,0.38)] backdrop-blur-xl">
                    <div className="p-5">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-cyan-100/70">Reference view</p>
                        <p className="mt-2 text-base font-medium text-white">{title}</p>
                        <p className="mt-2 text-xs leading-5 text-neutral-200">{description}</p>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function ViewerPanel({
    clarityMode = false,
    routeVariant = "workspace",
    leftHudCollapsed = false,
    rightHudCollapsed = false,
    directorHudCompact = false,
    onToggleLeftHud,
    onToggleRightHud,
    onToggleDirectorHud,
    processingStatus,
    sceneGraph,
    setSceneGraph,
    readOnly = false,
    selectedPinId,
    onSelectPin,
    selectedViewId,
    onSelectView,
    focusRequest,
}: {
    clarityMode?: boolean;
    routeVariant?: "workspace" | "preview";
    leftHudCollapsed?: boolean;
    rightHudCollapsed?: boolean;
    directorHudCompact?: boolean;
    onToggleLeftHud?: () => void;
    onToggleRightHud?: () => void;
    onToggleDirectorHud?: () => void;
    processingStatus?: {
        busy: boolean;
        label: string;
        detail?: string;
    } | null;
    sceneGraph: WorkspaceSceneGraph | any;
    setSceneGraph: React.Dispatch<React.SetStateAction<any>>;
    readOnly?: boolean;
    selectedPinId?: string | null;
    onSelectPin?: (pinId: string | null) => void;
    selectedViewId?: string | null;
    onSelectView?: (viewId: string | null) => void;
    focusRequest?: FocusRequest;
}) {
    const isPreviewRoute = routeVariant === "preview";
    const normalizedSceneGraph = useMemo(() => normalizeWorkspaceSceneGraph(sceneGraph), [sceneGraph]);
    const [captureRequestKey, setCaptureRequestKey] = useState(0);
    const [isPinPlacementEnabled, setIsPinPlacementEnabled] = useState(false);
    const [pinType, setPinType] = useState<SpatialPinType>("general");
    const [isRecordingPath, setIsRecordingPath] = useState(false);
    const [localFocusRequest, setLocalFocusRequest] = useState<FocusRequest>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [viewerReady, setViewerReady] = useState(false);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const captureFallbackTimerRef = useRef<number | null>(null);
    const pendingCaptureRequestRef = useRef<number | null>(null);

    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(document.fullscreenElement === containerRef.current);
        };
        document.addEventListener("fullscreenchange", handleFullscreenChange);
        return () => {
            document.removeEventListener("fullscreenchange", handleFullscreenChange);
        };
    }, []);

    useEffect(() => {
        return () => {
            if (captureFallbackTimerRef.current !== null) {
                window.clearTimeout(captureFallbackTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (viewerReady) return;
        setIsPinPlacementEnabled(false);
        setIsRecordingPath(false);
        pendingCaptureRequestRef.current = null;
        if (captureFallbackTimerRef.current !== null) {
            window.clearTimeout(captureFallbackTimerRef.current);
            captureFallbackTimerRef.current = null;
        }
    }, [viewerReady]);

    useEffect(() => {
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;

            let handled = false;
            if (isPinPlacementEnabled) {
                setIsPinPlacementEnabled(false);
                handled = true;
            }
            if (isRecordingPath) {
                setIsRecordingPath(false);
                handled = true;
            }
            if (document.fullscreenElement === containerRef.current) {
                handled = true;
                void document.exitFullscreen().catch(() => {
                    setIsFullscreen(false);
                });
            }
            if (handled) {
                event.preventDefault();
            }
        };

        window.addEventListener("keydown", handleEscape);
        return () => {
            window.removeEventListener("keydown", handleEscape);
        };
    }, [isPinPlacementEnabled, isRecordingPath]);

    useEffect(() => {
        if (!focusRequest) return;
        setSceneGraph((prev: any) => {
            const normalized = normalizeWorkspaceSceneGraph(prev);
            return {
                ...normalized,
                viewer: {
                    fov: focusRequest.fov,
                    lens_mm: focusRequest.lens_mm,
                },
            };
        });
    }, [focusRequest, setSceneGraph]);

    const handleDrop = (event: React.DragEvent) => {
        if (readOnly) return;
        event.preventDefault();
        try {
            const assetData = event.dataTransfer.getData("asset");
            if (!assetData) return;
            const asset = JSON.parse(assetData);
            setSceneGraph((prev: any) => {
                const normalized = normalizeWorkspaceSceneGraph(prev);
                return {
                    ...normalized,
                    assets: [
                        ...normalized.assets,
                        {
                            ...asset,
                            instanceId: `inst_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                            position: [0, 0, 0],
                            rotation: [0, 0, 0],
                            scale: [1, 1, 1],
                        },
                    ],
                };
            });
        } catch {
            // Ignore invalid drag payloads.
        }
    };

    const handleDragOver = (event: React.DragEvent) => {
        if (readOnly) return;
        event.preventDefault();
    };

    const hasEnvironment = Boolean(normalizedSceneGraph.environment);
    const environmentState = describeEnvironment(normalizedSceneGraph.environment);
    const qualityScore = normalizedSceneGraph.environment?.metadata?.quality?.score;
    const environmentRenderState = resolveEnvironmentRenderState(normalizedSceneGraph.environment);
    const hasEnvironmentSplat = environmentRenderState.hasRenderableOutput;
    const isReferenceOnlyDemo = environmentRenderState.isReferenceOnlyDemo;
    const isLegacyDemoWorld = environmentRenderState.isLegacyDemoWorld;
    const referenceImage = environmentRenderState.referenceImage;
    const shouldUseStaticReferenceViewer = Boolean(referenceImage) && !hasEnvironmentSplat && (isReferenceOnlyDemo || isLegacyDemoWorld);
    const shouldRenderInteractiveViewer =
        !shouldUseStaticReferenceViewer &&
        (hasEnvironmentSplat || Boolean(referenceImage) || normalizedSceneGraph.assets.length > 0 || normalizedSceneGraph.pins.length > 0);
    const selectedView = normalizedSceneGraph.camera_views.find((view) => view.id === selectedViewId) ?? null;
    const selectedPin = normalizedSceneGraph.pins.find((pin) => pin.id === selectedPinId) ?? null;
    const combinedFocusRequest =
        localFocusRequest && (!focusRequest || localFocusRequest.token >= focusRequest.token) ? localFocusRequest : focusRequest ?? null;

    useEffect(() => {
        if (shouldUseStaticReferenceViewer) {
            setViewerReady(false);
            return;
        }
        if (!shouldRenderInteractiveViewer) {
            setViewerReady(false);
        }
    }, [shouldRenderInteractiveViewer, shouldUseStaticReferenceViewer]);

    const requestFocus = (pose: CameraPose) => {
        setSceneGraph((prev: any) => {
            const normalized = normalizeWorkspaceSceneGraph(prev);
            return {
                ...normalized,
                viewer: {
                    fov: pose.fov,
                    lens_mm: pose.lens_mm,
                },
            };
        });
        setLocalFocusRequest({ ...pose, token: Date.now() });
    };

    const toggleFullscreen = async () => {
        if (!containerRef.current) return;

        try {
            if (document.fullscreenElement === containerRef.current) {
                await document.exitFullscreen();
                return;
            }
            if (document.fullscreenElement && document.fullscreenElement !== containerRef.current) {
                await document.exitFullscreen();
            }
            if (typeof containerRef.current.requestFullscreen !== "function") return;
            await containerRef.current.requestFullscreen();
        } catch {
            setIsFullscreen(document.fullscreenElement === containerRef.current);
        }
    };

    const setLens = (lensMm: number) => {
        const fov = lensMmToFov(lensMm);
        setSceneGraph((prev: any) => {
            const normalized = normalizeWorkspaceSceneGraph(prev);
            return {
                ...normalized,
                viewer: {
                    fov,
                    lens_mm: lensMm,
                },
            };
        });
    };

    const appendCapturedView = (pose: CameraPose) => {
        const nextViewId = createId("view");
        setSceneGraph((prev: any) => {
            const normalized = normalizeWorkspaceSceneGraph(prev);
            const nextView: CameraView = {
                id: nextViewId,
                label: `View ${normalized.camera_views.length + 1}`,
                position: pose.position,
                target: pose.target,
                fov: pose.fov,
                lens_mm: pose.lens_mm,
                note: "",
            };
            return {
                ...normalized,
                camera_views: [...normalized.camera_views, nextView],
                viewer: {
                    fov: pose.fov,
                    lens_mm: pose.lens_mm,
                },
            };
        });
        onSelectView?.(nextViewId);
    };

    const handleCapturePose = (pose: CameraPose) => {
        if (pendingCaptureRequestRef.current === null) return;
        pendingCaptureRequestRef.current = null;
        if (captureFallbackTimerRef.current !== null) {
            window.clearTimeout(captureFallbackTimerRef.current);
            captureFallbackTimerRef.current = null;
        }
        appendCapturedView(pose);
    };

    const requestViewCapture = () => {
        if (!viewerReady) return;
        const requestToken = Date.now();
        const fallbackPose: CameraPose =
            selectedView ??
            combinedFocusRequest ?? {
                position: [5, 4, 6],
                target: [0, 0, 0],
                fov: normalizedSceneGraph.viewer.fov,
                lens_mm: normalizedSceneGraph.viewer.lens_mm,
            };

        pendingCaptureRequestRef.current = requestToken;
        if (captureFallbackTimerRef.current !== null) {
            window.clearTimeout(captureFallbackTimerRef.current);
        }

        setCaptureRequestKey((value) => value + 1);
        captureFallbackTimerRef.current = window.setTimeout(() => {
            if (pendingCaptureRequestRef.current !== requestToken) return;
            pendingCaptureRequestRef.current = null;
            captureFallbackTimerRef.current = null;
            appendCapturedView(fallbackPose);
        }, 350);
    };

    const handlePathRecorded = (path: CameraPathFrame[]) => {
        setSceneGraph((prev: any) => {
            const normalized = normalizeWorkspaceSceneGraph(prev);
            return {
                ...normalized,
                director_path: path,
            };
        });
    };

    const focusView = (view: CameraView) => {
        onSelectView?.(view.id);
        onSelectPin?.(null);
        requestFocus({
            position: view.position,
            target: view.target,
            fov: view.fov,
            lens_mm: view.lens_mm,
        });
    };

    const focusPin = () => {
        if (!selectedPin) return;
        const basePose = selectedView
            ? {
                  position: selectedView.position,
                  target: selectedPin.position,
                  fov: selectedView.fov,
                  lens_mm: selectedView.lens_mm,
              }
            : {
                  position: [
                      selectedPin.position[0] + 4,
                      selectedPin.position[1] + 2,
                      selectedPin.position[2] + 4,
                  ] as [number, number, number],
                  target: selectedPin.position,
                  fov: normalizedSceneGraph.viewer.fov,
                  lens_mm: normalizedSceneGraph.viewer.lens_mm,
              };
        requestFocus(basePose);
    };

    const clearDirectorPath = () => {
        setSceneGraph((prev: any) => {
            const normalized = normalizeWorkspaceSceneGraph(prev);
            return {
                ...normalized,
                director_path: [],
            };
        });
    };

    const viewerActionDisabled = readOnly || !viewerReady;
    const viewerActionClassName = viewerActionDisabled ? "cursor-not-allowed opacity-50" : "";
    const showDirectorHudCompact = directorHudCompact;
    const directorHudToggleLabel = showDirectorHudCompact ? "Expand HUD" : "Minimize HUD";
    const leftHudToggleLabel = leftHudCollapsed ? "Show left HUD" : "Hide left HUD";
    const rightHudToggleLabel = rightHudCollapsed ? "Show right HUD" : "Hide right HUD";

    const lensPresetControls = (
        <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex shrink-0 items-center gap-2 rounded-full border border-neutral-800 bg-black/30 px-3 py-2">
                <Camera className="h-3.5 w-3.5 text-neutral-400" />
                <span className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">Lens</span>
            </div>
            {LENS_PRESETS.map((lensMm) => {
                const active = Math.round(normalizedSceneGraph.viewer.lens_mm) === lensMm;
                return (
                    <button
                        key={lensMm}
                        type="button"
                        onClick={() => setLens(lensMm)}
                        className={`shrink-0 rounded-full border px-3 py-2 text-[11px] transition-colors ${
                            active
                                ? "border-white/20 bg-white text-black"
                                : "border-neutral-800 bg-neutral-900 text-neutral-300 hover:border-neutral-700 hover:text-white"
                        }`}
                    >
                        {lensMm}mm
                    </button>
                );
            })}
        </div>
    );

    return (
        <div
            className="relative flex h-full w-full flex-col bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.08),transparent_24%),linear-gradient(180deg,#050608_0%,#040507_100%)]"
            ref={containerRef}
        >
            <div
                className={
                    showDirectorHudCompact
                        ? "pointer-events-none absolute left-1/2 top-5 z-30 w-[min(92vw,56rem)] -translate-x-1/2"
                        : "absolute top-0 left-0 right-0 p-5 shrink-0 z-30"
                }
            >
                {showDirectorHudCompact ? (
                    <div className="pointer-events-auto relative overflow-hidden rounded-full border border-white/12 bg-[linear-gradient(180deg,rgba(9,12,18,0.76),rgba(7,9,13,0.7))] px-3 py-3 shadow-[0_20px_50px_rgba(0,0,0,0.3)] backdrop-blur-xl">
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-cyan-200/40 via-white/10 to-transparent" />
                        <div className="flex flex-wrap items-center justify-center gap-3">
                            <div className="flex shrink-0 items-center gap-3 rounded-full border border-white/10 bg-black/20 px-3 py-2">
                                <div
                                    className={`h-2.5 w-2.5 rounded-full ${
                                        hasEnvironment && !isReferenceOnlyDemo && !isLegacyDemoWorld
                                            ? "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.8)]"
                                            : "bg-neutral-600"
                                    }`}
                                />
                                <div className="min-w-0">
                                    <p className="text-[10px] uppercase tracking-[0.3em] text-cyan-200/65">GAUSET Director</p>
                                    <p className="truncate text-xs font-medium text-neutral-100">{environmentState.label}</p>
                                </div>
                            </div>
                            <div className="min-w-0 flex-1 overflow-hidden">{lensPresetControls}</div>
                            <button
                                type="button"
                                onClick={onToggleDirectorHud}
                                className="shrink-0 rounded-full border border-neutral-800 bg-neutral-900 px-3 py-2 text-[11px] text-white transition-colors hover:border-neutral-700 hover:text-neutral-100"
                                aria-label={directorHudToggleLabel}
                            >
                                <Maximize2 className="mr-1 inline h-3.5 w-3.5" />
                                {directorHudToggleLabel}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="relative overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(9,12,18,0.84),rgba(7,9,13,0.74))] p-4 shadow-[0_24px_60px_rgba(0,0,0,0.38)] backdrop-blur-xl">
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-cyan-200/40 via-white/10 to-transparent" />
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div className="min-w-[220px] max-w-sm">
                                <div className="flex items-center gap-3">
                                    <div
                                        className={`h-2.5 w-2.5 rounded-full ${
                                            hasEnvironment && !isReferenceOnlyDemo && !isLegacyDemoWorld
                                                ? "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.8)]"
                                                : "bg-neutral-600"
                                        }`}
                                    />
                                    <div>
                                        <p className="text-[10px] uppercase tracking-[0.3em] text-cyan-200/65">GAUSET Director</p>
                                        <span className="text-sm font-medium text-neutral-100">{environmentState.label}</span>
                                    </div>
                                </div>
                                <p className="mt-2 text-[11px] text-neutral-400">{environmentState.note}</p>
                                {environmentState.detail ? <p className="mt-1 text-[11px] text-neutral-500">{environmentState.detail}</p> : null}
                                {clarityMode ? (
                                    <div className="mt-3 grid gap-2">
                                        <div className="rounded-2xl border border-emerald-500/15 bg-emerald-950/20 px-3 py-2">
                                            <p className="text-[10px] uppercase tracking-[0.16em] text-emerald-200/80">Persistent world</p>
                                            <p className="mt-1 text-[11px] leading-5 text-emerald-50/90">
                                                Environment and placed assets stay fixed until you rebuild or replace the world.
                                            </p>
                                        </div>
                                        <div className="rounded-2xl border border-sky-500/15 bg-sky-950/20 px-3 py-2">
                                            <p className="text-[10px] uppercase tracking-[0.16em] text-sky-200/80">Scene direction</p>
                                            <p className="mt-1 text-[11px] leading-5 text-sky-50/90">
                                                Views, notes, pins, and lens choices change only the shot you are directing.
                                            </p>
                                        </div>
                                    </div>
                                ) : null}
                            </div>

                            <div className="flex max-w-[32rem] flex-wrap items-center justify-end gap-2">
                                {typeof qualityScore === "number" ? (
                                    <div className="rounded-2xl border border-neutral-800 bg-black/30 px-3 py-2 text-right">
                                        <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Quality</p>
                                        <p className="text-sm text-white">{qualityScore.toFixed(1)}</p>
                                    </div>
                                ) : null}
                                {!readOnly ? (
                                    <>
                                        <button
                                            type="button"
                                            onClick={requestViewCapture}
                                            disabled={viewerActionDisabled}
                                            className={`rounded-full border border-neutral-800 bg-neutral-900 px-3 py-2 text-[11px] text-white transition-colors hover:border-blue-500/50 hover:text-blue-200 disabled:hover:border-neutral-800 disabled:hover:text-white ${viewerActionClassName}`}
                                        >
                                            Save camera view
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setIsPinPlacementEnabled((value) => !value)}
                                            disabled={viewerActionDisabled}
                                            className={`rounded-full border px-3 py-2 text-[11px] transition-colors ${
                                                isPinPlacementEnabled
                                                    ? "border-sky-500/60 bg-sky-500/15 text-sky-200"
                                                    : "border-neutral-800 bg-neutral-900 text-white hover:border-sky-500/40 hover:text-sky-200"
                                            } disabled:hover:border-neutral-800 disabled:hover:text-white ${viewerActionClassName}`}
                                        >
                                            <MapPin className="mr-1 inline h-3.5 w-3.5" />
                                            {isPinPlacementEnabled ? "Drop scene note" : "Scene notes"}
                                        </button>
                                        <select
                                            value={pinType}
                                            onChange={(event) => setPinType(event.target.value as SpatialPinType)}
                                            disabled={viewerActionDisabled}
                                            className={`rounded-full border border-neutral-800 bg-neutral-900 px-3 py-2 text-[11px] text-white outline-none focus:border-sky-500/50 ${viewerActionClassName}`}
                                            aria-label="Pin type"
                                        >
                                            <option value="general">General</option>
                                            <option value="egress">Egress</option>
                                            <option value="lighting">Lighting</option>
                                            <option value="hazard">Hazard</option>
                                        </select>
                                        <button
                                            type="button"
                                            onClick={() => setIsRecordingPath((value) => !value)}
                                            disabled={viewerActionDisabled}
                                            className={`rounded-full border px-3 py-2 text-[11px] transition-colors ${
                                                isRecordingPath
                                                    ? "border-amber-500/60 bg-amber-500/15 text-amber-200"
                                                    : "border-neutral-800 bg-neutral-900 text-white hover:border-amber-500/40 hover:text-amber-200"
                                            } disabled:hover:border-neutral-800 disabled:hover:text-white ${viewerActionClassName}`}
                                        >
                                            <Video className="mr-1 inline h-3.5 w-3.5" />
                                            {isRecordingPath ? "Stop path" : "Record camera path"}
                                        </button>
                                    </>
                                ) : null}
                                {onToggleLeftHud ? (
                                    <button
                                        type="button"
                                        onClick={onToggleLeftHud}
                                        className="rounded-full border border-neutral-800 bg-neutral-900 px-3 py-2 text-[11px] text-white transition-colors hover:border-neutral-700 hover:text-neutral-100"
                                        aria-label={leftHudToggleLabel}
                                    >
                                        {leftHudToggleLabel}
                                    </button>
                                ) : null}
                                {onToggleRightHud ? (
                                    <button
                                        type="button"
                                        onClick={onToggleRightHud}
                                        className="rounded-full border border-neutral-800 bg-neutral-900 px-3 py-2 text-[11px] text-white transition-colors hover:border-neutral-700 hover:text-neutral-100"
                                        aria-label={rightHudToggleLabel}
                                    >
                                        {rightHudToggleLabel}
                                    </button>
                                ) : null}
                                {onToggleDirectorHud ? (
                                    <button
                                        type="button"
                                        onClick={onToggleDirectorHud}
                                        className="rounded-full border border-neutral-800 bg-neutral-900 px-3 py-2 text-[11px] text-white transition-colors hover:border-neutral-700 hover:text-neutral-100"
                                        aria-label={directorHudToggleLabel}
                                    >
                                        <Minimize2 className="mr-1 inline h-3.5 w-3.5" />
                                        {directorHudToggleLabel}
                                    </button>
                                ) : null}
                                <button
                                    type="button"
                                    onClick={toggleFullscreen}
                                    className="rounded-full border border-neutral-800 bg-neutral-900 px-3 py-2 text-[11px] text-white transition-colors hover:border-neutral-700 hover:text-neutral-100"
                                >
                                    {isFullscreen ? <Minimize2 className="mr-1 inline h-3.5 w-3.5" /> : <Maximize2 className="mr-1 inline h-3.5 w-3.5" />}
                                    {isFullscreen ? "Exit" : "Expand"}
                                </button>
                            </div>
                        </div>

                        {processingStatus ? (
                            <div className="mt-4 rounded-2xl border border-cyan-300/15 bg-cyan-400/10 px-3 py-3">
                                <p className="text-xs font-medium text-white">{processingStatus.label}</p>
                                {processingStatus.detail ? <p className="mt-1 text-[11px] leading-5 text-neutral-300">{processingStatus.detail}</p> : null}
                                {processingStatus.busy ? (
                                    <p className="mt-2 text-[10px] uppercase tracking-[0.16em] text-cyan-100/80">
                                        Current output stays visible until the new result finishes.
                                    </p>
                                ) : null}
                            </div>
                        ) : null}

                        <div className="mt-4">{lensPresetControls}</div>

                        {(normalizedSceneGraph.camera_views.length > 0 || normalizedSceneGraph.pins.length > 0) && (
                            <div className="mt-4 grid gap-3 lg:grid-cols-2">
                                <div className="rounded-2xl border border-neutral-800 bg-black/25 p-3">
                                    <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-neutral-500">
                                        <ScanLine className="h-3.5 w-3.5" />
                                        Saved Camera Views
                                    </div>
                                    {normalizedSceneGraph.camera_views.length > 0 ? (
                                        <div className="flex flex-wrap gap-2">
                                            {normalizedSceneGraph.camera_views.map((view) => (
                                                <button
                                                    key={view.id}
                                                    type="button"
                                                    onClick={() => focusView(view)}
                                                    className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                                                        view.id === selectedViewId
                                                            ? "border-white/20 bg-white text-black"
                                                            : "border-neutral-800 bg-neutral-900 text-neutral-300 hover:border-blue-500/40 hover:text-blue-200"
                                                    }`}
                                                >
                                                    {view.label}
                                                </button>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-xs text-neutral-500">Save a camera view for scout angles, director setups, and review handoff.</p>
                                    )}
                                </div>
                                <div className="rounded-2xl border border-neutral-800 bg-black/25 p-3">
                                    <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-neutral-500">
                                        <MapPin className="h-3.5 w-3.5" />
                                        Scene Notes
                                    </div>
                                    {normalizedSceneGraph.pins.length > 0 ? (
                                        <div className="flex flex-wrap gap-2">
                                            {normalizedSceneGraph.pins.map((pin) => (
                                                <button
                                                    key={pin.id}
                                                    type="button"
                                                    onClick={() => {
                                                        onSelectPin?.(pin.id);
                                                        onSelectView?.(null);
                                                    }}
                                                    className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                                                        pin.id === selectedPinId
                                                            ? "border-white/20 bg-white text-black"
                                                            : "border-neutral-800 bg-neutral-900 text-neutral-300 hover:border-sky-500/40 hover:text-sky-200"
                                                    }`}
                                                >
                                                    {pin.label}
                                                </button>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-xs text-neutral-500">Add typed pins for access, lighting, hazards, and handoff notes.</p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div
                className="relative m-6 flex-1 overflow-hidden rounded-[32px] border border-neutral-800/50 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.08),transparent_24%),linear-gradient(180deg,#050608_0%,#040507_100%)] shadow-2xl"
                data-testid="mvp-viewer-surface"
                onDrop={handleDrop}
                onDragOver={handleDragOver}
            >
                {shouldUseStaticReferenceViewer && referenceImage ? (
                    <StaticReferenceViewer
                        referenceImage={referenceImage}
                        title={isReferenceOnlyDemo ? "Reference-only demo" : "Demo world"}
                        description={
                            isReferenceOnlyDemo
                                ? "This draft is reference-only. Build or import a real world before treating the viewer as a persistent environment."
                                : "Demo worlds are shown as stable reference surfaces here until you load a real renderable scene."
                        }
                    />
                ) : shouldRenderInteractiveViewer ? (
                    <ThreeOverlay
                        sceneGraph={normalizedSceneGraph}
                        setSceneGraph={setSceneGraph}
                        readOnly={readOnly}
                        backgroundColor={isPreviewRoute ? "#040507" : undefined}
                        selectedPinId={selectedPinId}
                        onSelectPin={onSelectPin}
                        focusRequest={combinedFocusRequest}
                        captureRequestKey={captureRequestKey}
                        onCapturePose={handleCapturePose}
                        isPinPlacementEnabled={isPinPlacementEnabled}
                        pinType={pinType}
                        isRecordingPath={isRecordingPath}
                        onPathRecorded={handlePathRecorded}
                        onViewerReadyChange={setViewerReady}
                    />
                ) : (
                    <EmptyViewerState clarityMode={clarityMode} />
                )}

                {viewerReady && !shouldUseStaticReferenceViewer && !hasEnvironmentSplat && referenceImage ? (
                    <div className="pointer-events-none absolute bottom-6 left-6 right-6 z-20 md:right-auto">
                        <div
                            className="w-full max-w-sm overflow-hidden rounded-[24px] border border-white/12 bg-[linear-gradient(180deg,rgba(8,11,16,0.92),rgba(7,10,14,0.96))] shadow-[0_24px_70px_rgba(0,0,0,0.38)] backdrop-blur-xl"
                            data-testid="mvp-reference-card"
                        >
                            <div className="relative aspect-[16/10] w-full overflow-hidden">
                                <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${referenceImage})` }} />
                                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.08),rgba(0,0,0,0.68))]" />
                                <div className="absolute bottom-0 left-0 right-0 p-4">
                                    <p className="text-[10px] uppercase tracking-[0.18em] text-cyan-100/70">Reference view</p>
                                    <p className="mt-2 text-base font-medium text-white">
                                        {isReferenceOnlyDemo ? "Reference-only demo" : isLegacyDemoWorld ? "Demo world" : "Reference image"}
                                    </p>
                                    <p className="mt-2 max-w-xs text-xs leading-5 text-neutral-200">
                                        {isReferenceOnlyDemo
                                            ? "This draft is reference-only. Build or import a real world before treating the viewer as a persistent environment."
                                            : isLegacyDemoWorld
                                              ? "Recovered an older demo world state. Open the preview intro or replace it with your own world when you are ready."
                                              : "Using the source still as a fallback while the viewer waits for a renderable environment."}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : null}

                {shouldRenderInteractiveViewer ? (
                    <div className="absolute top-1/2 left-1/2 z-30 -translate-x-1/2 -translate-y-1/2 opacity-20 pointer-events-none">
                        <div className="absolute top-1/2 left-1/2 h-[1px] w-8 -translate-x-1/2 -translate-y-1/2 bg-white" />
                        <div className="absolute top-1/2 left-1/2 h-8 w-[1px] -translate-x-1/2 -translate-y-1/2 bg-white" />
                    </div>
                ) : null}
            </div>

            {(selectedPin || selectedView || normalizedSceneGraph.director_path.length > 0) && (
                <div className="absolute bottom-6 left-6 right-6 z-30" data-testid="mvp-viewer-selection-tray">
                    <div className="rounded-[28px] border border-neutral-800/80 bg-neutral-950/80 p-4 shadow-2xl backdrop-blur-xl">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div className="space-y-2">
                                {selectedPin ? (
                                    <div>
                                        <p className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Selected Pin</p>
                                        <p className="text-sm text-white">{selectedPin.label}</p>
                                        <p className="text-[11px] text-neutral-500">
                                            {selectedPin.type} · [{selectedPin.position.map((value) => value.toFixed(2)).join(", ")}]
                                        </p>
                                    </div>
                                ) : null}
                                {selectedView ? (
                                    <div>
                                        <p className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Selected View</p>
                                        <p className="text-sm text-white">{selectedView.label}</p>
                                        <p className="text-[11px] text-neutral-500">
                                            {selectedView.lens_mm.toFixed(0)}mm · FOV {selectedView.fov.toFixed(1)}
                                        </p>
                                    </div>
                                ) : null}
                                {normalizedSceneGraph.director_path.length > 0 ? (
                                    <div>
                                        <p className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Recorded Path</p>
                                        <p className="text-sm text-white">
                                            {normalizedSceneGraph.director_path.length} frames · {formatPathDuration(normalizedSceneGraph.director_path)}
                                        </p>
                                    </div>
                                ) : null}
                            </div>

                            <div className="flex flex-wrap gap-2">
                                {selectedPin ? (
                                    <button
                                        type="button"
                                        onClick={focusPin}
                                        className="rounded-full border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-white transition-colors hover:border-sky-500/40 hover:text-sky-200"
                                    >
                                        <Focus className="mr-1 inline h-3.5 w-3.5" />
                                        Focus Pin
                                    </button>
                                ) : null}
                                {normalizedSceneGraph.director_path.length > 0 && !readOnly ? (
                                    <button
                                        type="button"
                                        onClick={clearDirectorPath}
                                        className="rounded-full border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-white transition-colors hover:border-rose-500/40 hover:text-rose-200"
                                    >
                                        Clear Path
                                    </button>
                                ) : null}
                            </div>
                        </div>

                        {!readOnly ? (
                            <textarea
                                value={normalizedSceneGraph.director_brief}
                                onChange={(event) =>
                                    setSceneGraph((prev: any) => {
                                        const normalized = normalizeWorkspaceSceneGraph(prev);
                                        return {
                                            ...normalized,
                                            director_brief: event.target.value,
                                        };
                                    })
                                }
                                className="mt-4 w-full rounded-2xl border border-neutral-800 bg-black/30 px-4 py-3 text-sm text-white outline-none focus:border-blue-500/50"
                                placeholder="Director brief: lens intent, blocking concerns, safety notes, or move direction."
                            />
                        ) : normalizedSceneGraph.director_brief ? (
                            <p className="mt-4 rounded-2xl border border-neutral-800 bg-black/30 px-4 py-3 text-sm text-neutral-300">
                                {normalizedSceneGraph.director_brief}
                            </p>
                        ) : null}
                    </div>
                </div>
            )}
        </div>
    );
}
