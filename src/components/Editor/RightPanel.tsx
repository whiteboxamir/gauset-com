"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
    Box,
    Copy,
    Download,
    Focus,
    History,
    Layers,
    Loader2,
    MapPin,
    MapPinned,
    NotebookPen,
    RefreshCcw,
    Save,
    Share2,
    Trash2,
} from "lucide-react";
import { extractApiError, MVP_API_BASE_URL } from "@/lib/mvp-api";
import { describeEnvironment, GeneratedEnvironmentMetadata } from "@/lib/mvp-product";
import { createReviewPackage, encodeReviewPackage } from "@/lib/mvp-review";
import {
    CameraPose,
    CameraView,
    ReviewIssue,
    ReviewIssueSeverity,
    ReviewIssueStatus,
    SceneReviewRecord,
    SpatialPin,
    SpatialPinType,
    WorkspaceSceneGraph,
    createDefaultReviewRecord,
    createId,
    formatPinTypeLabel,
    normalizeReviewRecord,
    normalizeWorkspaceSceneGraph,
    nowIso,
} from "@/lib/mvp-workspace";

type SaveState = "idle" | "saving" | "saved" | "recovered" | "error";

interface SceneVersion {
    version_id: string;
    saved_at: string;
    source?: string;
    comment_count?: number;
    summary?: {
        asset_count?: number;
        has_environment?: boolean;
    };
}

interface LegacyComment {
    comment_id: string;
    author: string;
    body: string;
    created_at: string;
}

interface RightPanelProps {
    clarityMode?: boolean;
    activityLog?: Array<{
        id: string;
        at: string;
        label: string;
        detail: string;
        tone: "neutral" | "info" | "success" | "warning";
    }>;
    changeSummary?: {
        persistent: string[];
        sceneDirection: string[];
    } | null;
    lastOutputLabel?: string;
    sceneGraph: WorkspaceSceneGraph | any;
    setSceneGraph: React.Dispatch<React.SetStateAction<any>>;
    assetsList: any[];
    activeScene: string | null;
    saveState: SaveState;
    saveMessage: string;
    saveError: string;
    lastSavedAt: string | null;
    versions: SceneVersion[];
    onManualSave: () => Promise<any> | void;
    onRestoreVersion: (versionId: string) => Promise<any> | void;
    onExport?: () => void;
    selectedPinId?: string | null;
    onSelectPin?: (pinId: string | null) => void;
    selectedViewId?: string | null;
    onSelectView?: (viewId: string | null) => void;
    onFocusRequest?: (cameraPose: CameraPose) => void;
}

interface IssueDraft {
    title: string;
    body: string;
    type: SpatialPinType;
    severity: ReviewIssueSeverity;
    status: ReviewIssueStatus;
    assignee: string;
    author: string;
}

const DEFAULT_ISSUE_DRAFT: IssueDraft = {
    title: "",
    body: "",
    type: "general",
    severity: "medium",
    status: "open",
    assignee: "",
    author: "Reviewer",
};

const formatTimestamp = (value?: string | null) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString([], {
        hour: "numeric",
        minute: "2-digit",
        month: "short",
        day: "numeric",
    });
};

const statusClassName = (state: SaveState) => {
    if (state === "saved") return "border-emerald-900/40 bg-emerald-950/30 text-emerald-300";
    if (state === "saving") return "border-blue-900/40 bg-blue-950/30 text-blue-300";
    if (state === "recovered") return "border-amber-900/40 bg-amber-950/30 text-amber-200";
    if (state === "error") return "border-rose-900/40 bg-rose-950/30 text-rose-300";
    return "border-neutral-800 bg-neutral-900/70 text-neutral-300";
};

const formatQualityBand = (value?: string | null) => {
    if (!value) return "";
    return value.replaceAll("_", " ");
};

const formatMetric = (value?: number | null, digits = 1) => {
    if (typeof value !== "number" || Number.isNaN(value)) return "n/a";
    return value.toFixed(digits);
};

const issueSeverityClass = (severity: ReviewIssueSeverity) => {
    if (severity === "critical") return "border-rose-500/30 bg-rose-950/30 text-rose-200";
    if (severity === "high") return "border-amber-500/30 bg-amber-950/30 text-amber-200";
    if (severity === "low") return "border-emerald-500/30 bg-emerald-950/30 text-emerald-200";
    return "border-sky-500/30 bg-sky-950/30 text-sky-200";
};

const activityToneClass = (tone: "neutral" | "info" | "success" | "warning") => {
    if (tone === "info") return "border-sky-500/20 bg-sky-950/20";
    if (tone === "success") return "border-emerald-500/20 bg-emerald-950/20";
    if (tone === "warning") return "border-amber-500/20 bg-amber-950/20";
    return "border-neutral-800 bg-neutral-950/60";
};

const assetLibraryKey = (asset: any, fallback?: string | number) => {
    if (typeof asset?.id === "string" && asset.id) return asset.id;
    if (typeof asset?.asset_id === "string" && asset.asset_id) return asset.asset_id;
    if (typeof asset?.name === "string" && asset.name) return asset.name;
    return fallback !== undefined ? String(fallback) : "";
};

export default function RightPanel({
    clarityMode = false,
    activityLog = [],
    changeSummary = null,
    lastOutputLabel,
    sceneGraph,
    setSceneGraph,
    assetsList,
    activeScene,
    saveState,
    saveMessage,
    saveError,
    lastSavedAt,
    versions,
    onManualSave,
    onRestoreVersion,
    onExport,
    selectedPinId,
    onSelectPin,
    selectedViewId,
    onSelectView,
    onFocusRequest,
}: RightPanelProps) {
    const normalizedSceneGraph = useMemo(() => normalizeWorkspaceSceneGraph(sceneGraph), [sceneGraph]);
    const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
    const [shareStatus, setShareStatus] = useState("");
    const [reviewData, setReviewData] = useState<SceneReviewRecord>(() => createDefaultReviewRecord(activeScene));
    const [reviewStatus, setReviewStatus] = useState("");
    const [reviewError, setReviewError] = useState("");
    const [isSavingReview, setIsSavingReview] = useState(false);
    const [legacyComments, setLegacyComments] = useState<LegacyComment[]>([]);
    const [issueDraft, setIssueDraft] = useState<IssueDraft>(DEFAULT_ISSUE_DRAFT);

    const environmentState = useMemo(() => describeEnvironment(normalizedSceneGraph.environment), [normalizedSceneGraph.environment]);
    const environmentMetadata = useMemo(
        () => (normalizedSceneGraph.environment?.metadata ?? null) as GeneratedEnvironmentMetadata | null,
        [normalizedSceneGraph.environment],
    );
    const environmentQuality = environmentMetadata?.quality;
    const environmentDelivery = environmentMetadata?.delivery;
    const environmentCapture = environmentMetadata?.capture;
    const environmentTraining = environmentMetadata?.training;
    const environmentHoldout = environmentMetadata?.holdout;
    const environmentComparison = environmentMetadata?.comparison;
    const environmentReleaseGates = environmentMetadata?.release_gates;
    const environmentWarnings = Array.isArray(environmentQuality?.warnings) ? environmentQuality.warnings : [];
    const environmentBlockingIssues = Array.isArray(environmentDelivery?.blocking_issues) ? environmentDelivery.blocking_issues : [];
    const environmentNextActions = Array.isArray(environmentDelivery?.next_actions) ? environmentDelivery.next_actions : [];
    const environmentGateFailures = Array.isArray(environmentReleaseGates?.failed) ? environmentReleaseGates.failed : [];

    const selectedVersion = useMemo(
        () => versions.find((version) => version.version_id === selectedVersionId) ?? versions[0] ?? null,
        [selectedVersionId, versions],
    );
    const selectedPin = useMemo(
        () => normalizedSceneGraph.pins.find((pin) => pin.id === selectedPinId) ?? null,
        [normalizedSceneGraph.pins, selectedPinId],
    );
    const selectedView = useMemo(
        () => normalizedSceneGraph.camera_views.find((view) => view.id === selectedViewId) ?? null,
        [normalizedSceneGraph.camera_views, selectedViewId],
    );
    const libraryAssetCounts = useMemo(() => {
        const counts = new Map<string, number>();
        normalizedSceneGraph.assets.forEach((asset: any, index: number) => {
            const key = assetLibraryKey(asset, index);
            counts.set(key, (counts.get(key) ?? 0) + 1);
        });
        return counts;
    }, [normalizedSceneGraph.assets]);
    const nextLocalAsset = useMemo(
        () =>
            assetsList.find((asset, index) => (libraryAssetCounts.get(assetLibraryKey(asset, index)) ?? 0) === 0) ??
            assetsList[0] ??
            null,
        [assetsList, libraryAssetCounts],
    );
    const sceneGraphItemCount =
        normalizedSceneGraph.assets.length +
        normalizedSceneGraph.camera_views.length +
        normalizedSceneGraph.pins.length +
        (normalizedSceneGraph.environment ? 1 : 0);
    const persistentWorldSummary = normalizedSceneGraph.environment
        ? `${normalizedSceneGraph.assets.length} placed asset${normalizedSceneGraph.assets.length === 1 ? "" : "s"} stay with the world.`
        : "No persistent world loaded yet.";
    const sceneDirectionSummary = normalizedSceneGraph.camera_views.length || normalizedSceneGraph.pins.length || normalizedSceneGraph.director_brief
        ? `${normalizedSceneGraph.camera_views.length} saved view${normalizedSceneGraph.camera_views.length === 1 ? "" : "s"}, ${normalizedSceneGraph.pins.length} scene note${normalizedSceneGraph.pins.length === 1 ? "" : "s"}, and a director note shape only this scene.`
        : "No per-scene direction yet. Save a view, add a note, or update the director brief.";

    useEffect(() => {
        if (selectedVersionId && versions.some((version) => version.version_id === selectedVersionId)) return;
        setSelectedVersionId(versions[0]?.version_id ?? null);
    }, [selectedVersionId, versions]);

    useEffect(() => {
        let cancelled = false;

        const loadReview = async () => {
            if (!activeScene) {
                setReviewData(createDefaultReviewRecord(null));
                return;
            }
            try {
                const response = await fetch(`${MVP_API_BASE_URL}/scene/${activeScene}/review`, { cache: "no-store" });
                if (!response.ok) {
                    throw new Error(await extractApiError(response, `Review metadata load failed (${response.status})`));
                }
                const payload = normalizeReviewRecord(await response.json(), activeScene);
                if (!cancelled) {
                    setReviewData(payload);
                    setReviewError("");
                }
            } catch (error) {
                if (!cancelled) {
                    setReviewData(createDefaultReviewRecord(activeScene));
                    setReviewError(error instanceof Error ? error.message : "Review metadata load failed.");
                }
            }
        };

        void loadReview();
        return () => {
            cancelled = true;
        };
    }, [activeScene, lastSavedAt]);

    useEffect(() => {
        setIssueDraft((prev) => ({
            ...prev,
            author: reviewData.metadata.owner || prev.author || "Reviewer",
        }));
    }, [reviewData.metadata.owner]);

    useEffect(() => {
        let cancelled = false;

        const loadLegacyComments = async () => {
            if (!activeScene || !selectedVersion?.version_id) {
                setLegacyComments([]);
                return;
            }
            try {
                const response = await fetch(
                    `${MVP_API_BASE_URL}/scene/${activeScene}/versions/${selectedVersion.version_id}/comments`,
                    { cache: "no-store" },
                );
                if (!response.ok) {
                    throw new Error(await extractApiError(response, `Comment load failed (${response.status})`));
                }
                const payload = await response.json();
                if (!cancelled) {
                    setLegacyComments(Array.isArray(payload.comments) ? payload.comments : []);
                }
            } catch {
                if (!cancelled) {
                    setLegacyComments([]);
                }
            }
        };

        void loadLegacyComments();
        return () => {
            cancelled = true;
        };
    }, [activeScene, selectedVersion]);

    const buildReviewLink = () => {
        const url = new URL(`${window.location.origin}/mvp/review`);
        const hasSavedVersion = Boolean(activeScene && selectedVersion?.version_id);

        if (hasSavedVersion) {
            url.searchParams.set("scene", activeScene as string);
            url.searchParams.set("version", selectedVersion?.version_id as string);
            return url.toString();
        }

        const reviewPackage = createReviewPackage(
            normalizedSceneGraph,
            assetsList,
            activeScene,
            selectedVersion?.version_id ?? null,
            reviewData,
        );
        url.searchParams.set("payload", encodeReviewPackage(reviewPackage));
        return url.toString();
    };

    const copyReviewLink = async () => {
        try {
            const link = buildReviewLink();
            await navigator.clipboard.writeText(link);
            setShareStatus("Review link copied.");
        } catch {
            setShareStatus("Unable to copy review link.");
        }
    };

    const exportScenePackage = () => {
        const reviewPackage = createReviewPackage(normalizedSceneGraph, assetsList, activeScene, selectedVersion?.version_id ?? null, reviewData);
        const blob = new Blob([JSON.stringify(reviewPackage, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${activeScene ?? "gauset-scene"}-${selectedVersion?.version_id ?? "draft"}.json`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
        setShareStatus("Scene package exported.");
        onExport?.();
    };

    const persistReview = async (nextReview: SceneReviewRecord, nextState?: string, successMessage?: string) => {
        if (!activeScene) return;
        setIsSavingReview(true);
        setReviewStatus("");
        setReviewError("");

        try {
            const response = await fetch(`${MVP_API_BASE_URL}/scene/${activeScene}/review`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    metadata: nextReview.metadata,
                    approval_state: nextState ?? nextReview.approval.state ?? "draft",
                    updated_by: nextReview.metadata.owner.trim() || "Reviewer",
                    note: nextReview.approval.note ?? "",
                    issues: nextReview.issues,
                }),
            });
            if (!response.ok) {
                throw new Error(await extractApiError(response, `Review save failed (${response.status})`));
            }
            const payload = normalizeReviewRecord(await response.json(), activeScene);
            setReviewData(payload);
            setReviewStatus(
                successMessage ?? (nextState ? `Scene marked ${nextState.replaceAll("_", " ")}.` : "GAUSET review saved."),
            );
        } catch (error) {
            setReviewError(error instanceof Error ? error.message : "Review save failed.");
        } finally {
            setIsSavingReview(false);
        }
    };

    const saveReview = async (nextState?: string) => {
        if (!activeScene) return;
        await persistReview({ ...reviewData, scene_id: activeScene }, nextState);
    };

    const updateReviewField = (field: keyof SceneReviewRecord["metadata"], value: string) => {
        setReviewData((prev) => ({
            ...prev,
            scene_id: activeScene ?? prev.scene_id,
            metadata: {
                ...prev.metadata,
                [field]: value,
            },
        }));
    };

    const updateApprovalNote = (value: string) => {
        setReviewData((prev) => ({
            ...prev,
            scene_id: activeScene ?? prev.scene_id,
            approval: {
                ...prev.approval,
                note: value,
            },
        }));
    };

    const issueCountForVersion = (versionId: string) =>
        reviewData.issues.filter((issue) => issue.version_id === versionId).length;

    const addIssue = async () => {
        if (!activeScene || !selectedVersion?.version_id) return;
        if (!issueDraft.title.trim() && !issueDraft.body.trim()) return;
        const now = nowIso();
        const nextIssue: ReviewIssue = {
            id: createId("issue"),
            title: issueDraft.title.trim() || "Untitled issue",
            body: issueDraft.body.trim(),
            type: issueDraft.type,
            severity: issueDraft.severity,
            status: issueDraft.status,
            assignee: issueDraft.assignee.trim(),
            author: issueDraft.author.trim() || "Reviewer",
            anchor_position: selectedPin?.position ?? null,
            anchor_view_id: selectedView?.id ?? null,
            version_id: selectedVersion.version_id,
            created_at: now,
            updated_at: now,
        };
        const nextReview: SceneReviewRecord = {
            ...reviewData,
            scene_id: activeScene,
            issues: [...reviewData.issues, nextIssue],
        };
        setReviewData(nextReview);
        setIssueDraft((prev) => ({ ...DEFAULT_ISSUE_DRAFT, author: prev.author || "Reviewer" }));
        await persistReview(nextReview, undefined, "Issue added to review handoff.");
    };

    const deleteIssue = async (issueId: string) => {
        if (!activeScene) return;
        const nextReview = {
            ...reviewData,
            scene_id: activeScene,
            issues: reviewData.issues.filter((issue) => issue.id !== issueId),
        };
        setReviewData(nextReview);
        await persistReview(nextReview, undefined, "Issue removed.");
    };

    const updateIssueStatus = async (issueId: string, status: ReviewIssueStatus) => {
        if (!activeScene) return;
        const nextReview = {
            ...reviewData,
            scene_id: activeScene,
            issues: reviewData.issues.map((issue) =>
                issue.id === issueId ? { ...issue, status, updated_at: nowIso() } : issue,
            ),
        };
        setReviewData(nextReview);
        await persistReview(nextReview, undefined, "Issue status updated.");
    };

    const deletePin = (pinId: string) => {
        setSceneGraph((prev: any) => {
            const normalized = normalizeWorkspaceSceneGraph(prev);
            return {
                ...normalized,
                pins: normalized.pins.filter((pin) => pin.id !== pinId),
            };
        });
        if (selectedPinId === pinId) {
            onSelectPin?.(null);
        }
    };

    const deleteView = (viewId: string) => {
        setSceneGraph((prev: any) => {
            const normalized = normalizeWorkspaceSceneGraph(prev);
            return {
                ...normalized,
                camera_views: normalized.camera_views.filter((view) => view.id !== viewId),
            };
        });
        if (selectedViewId === viewId) {
            onSelectView?.(null);
        }
    };

    const duplicateSceneAsset = (instanceId: string) => {
        setSceneGraph((prev: any) => {
            const normalized = normalizeWorkspaceSceneGraph(prev);
            const source = normalized.assets.find((asset: any) => asset.instanceId === instanceId);
            if (!source) return normalized;
            const sourcePos = source.position ?? [0, 0, 0];
            return {
                ...normalized,
                assets: [
                    ...normalized.assets,
                    {
                        ...source,
                        instanceId: `inst_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                        position: [sourcePos[0] + 0.75, sourcePos[1], sourcePos[2] + 0.75],
                    },
                ],
            };
        });
    };

    const deleteSceneAsset = (instanceId: string) => {
        setSceneGraph((prev: any) => {
            const normalized = normalizeWorkspaceSceneGraph(prev);
            return {
                ...normalized,
                assets: normalized.assets.filter((asset: any) => asset.instanceId !== instanceId),
            };
        });
    };

    const addAssetToScene = (asset: any) => {
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
    };

    const handleDragStart = (event: React.DragEvent, asset: any) => {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("asset", JSON.stringify(asset));
    };

    const focusWorkspace = () => {
        const latestView = normalizedSceneGraph.camera_views[normalizedSceneGraph.camera_views.length - 1] ?? null;
        if (latestView) {
            focusView(latestView);
            return;
        }

        const target = selectedPin?.position ?? ([0, 0, 0] as [number, number, number]);
        onFocusRequest?.({
            position: [target[0] + 6, target[1] + 4, target[2] + 6],
            target,
            fov: normalizedSceneGraph.viewer.fov,
            lens_mm: normalizedSceneGraph.viewer.lens_mm,
        });
    };

    const stageNextLocalAsset = () => {
        if (!nextLocalAsset) return;
        addAssetToScene(nextLocalAsset);
    };

    const focusView = (view: CameraView) => {
        onSelectView?.(view.id);
        onSelectPin?.(null);
        onFocusRequest?.({
            position: view.position,
            target: view.target,
            fov: view.fov,
            lens_mm: view.lens_mm,
        });
    };

    const focusPin = (pin: SpatialPin) => {
        onSelectPin?.(pin.id);
        const fallbackView = selectedView ?? normalizedSceneGraph.camera_views[0] ?? null;
        onFocusRequest?.(
            fallbackView
                ? {
                      position: fallbackView.position,
                      target: pin.position,
                      fov: fallbackView.fov,
                      lens_mm: fallbackView.lens_mm,
                  }
                : {
                      position: [pin.position[0] + 4, pin.position[1] + 2, pin.position[2] + 4],
                      target: pin.position,
                      fov: normalizedSceneGraph.viewer.fov,
                      lens_mm: normalizedSceneGraph.viewer.lens_mm,
                  },
        );
    };

    const focusIssue = (issue: ReviewIssue) => {
        if (issue.anchor_view_id) {
            const view = normalizedSceneGraph.camera_views.find((candidate) => candidate.id === issue.anchor_view_id);
            if (view) {
                focusView(view);
                return;
            }
        }
        if (issue.anchor_position) {
            onFocusRequest?.({
                position: [issue.anchor_position[0] + 4, issue.anchor_position[1] + 2, issue.anchor_position[2] + 4],
                target: issue.anchor_position,
                fov: normalizedSceneGraph.viewer.fov,
                lens_mm: normalizedSceneGraph.viewer.lens_mm,
            });
        }
    };

    return (
        <div className="flex h-full flex-col overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.08),transparent_22%),linear-gradient(180deg,#080a0d_0%,#050608_100%)]">
            <div className="flex items-center justify-between border-b border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] p-4 shrink-0">
                <div>
                    <p className="text-[10px] uppercase tracking-[0.28em] text-amber-200/65">GAUSET Review</p>
                    <h3 className="mt-2 text-sm font-semibold tracking-tight text-white">
                        {clarityMode ? "World state and export" : "Production handoff"}
                    </h3>
                    <p className="mt-1 font-mono text-[11px] text-neutral-500">{activeScene ?? "scene_not_saved"}</p>
                </div>
                <button
                    onClick={onManualSave}
                    disabled={saveState === "saving"}
                    className="p-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white transition-colors shadow-lg shadow-blue-900/20 disabled:opacity-60 disabled:hover:bg-blue-600"
                    title="Save Scene as JSON"
                >
                    {saveState === "saving" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                </button>
            </div>

            <div className="p-4 border-b border-neutral-800 space-y-3 shrink-0">
                <div className={`rounded-xl border px-3 py-3 text-xs ${statusClassName(saveState)}`}>
                    <p className="font-medium tracking-wide uppercase text-[10px] mb-1">Save State</p>
                    <p>{saveMessage || "Scene is idle."}</p>
                    {lastSavedAt && <p className="text-[11px] text-neutral-400 mt-2">Last saved {formatTimestamp(lastSavedAt)}</p>}
                    {saveError && <p className="text-[11px] text-rose-200 mt-2 whitespace-pre-wrap">{saveError}</p>}
                </div>

                <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 px-3 py-3 text-xs text-neutral-300">
                    <p className="font-medium tracking-wide uppercase text-[10px] mb-1 text-neutral-500">Workspace Readiness</p>
                    <p className="text-white">{environmentState.label}</p>
                    <p className="mt-2 text-[11px] text-neutral-500">{environmentState.note}</p>
                    {environmentState.detail ? <p className="mt-1 text-[11px] text-neutral-400">{environmentState.detail}</p> : null}
                    {normalizedSceneGraph.environment?.metadata?.truth_label ? (
                        <p className="mt-2 text-[11px] text-neutral-400">{normalizedSceneGraph.environment.metadata.truth_label}</p>
                    ) : null}
                    {environmentMetadata?.lane_truth ? (
                        <p className="mt-1 text-[11px] text-neutral-500">Truth: {environmentMetadata.lane_truth.replaceAll("_", " ")}</p>
                    ) : null}
                    {environmentMetadata?.reconstruction_status ? (
                        <p className="mt-1 text-[11px] text-neutral-500">
                            Status: {environmentMetadata.reconstruction_status.replaceAll("_", " ")}
                        </p>
                    ) : null}
                </div>

                {environmentMetadata?.rendering || environmentQuality || environmentDelivery ? (
                    <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 px-3 py-3 space-y-3 text-xs text-neutral-300">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="font-medium tracking-wide uppercase text-[10px] text-neutral-500">
                                    {environmentQuality ? "Reconstruction Quality" : "Splat Rendering"}
                                </p>
                                <p className="mt-1 text-white">
                                    {environmentQuality?.band ? formatQualityBand(environmentQuality.band) : "Colorized splat output"}
                                </p>
                            </div>
                            {typeof environmentQuality?.score === "number" ? (
                                <div className="rounded-lg border border-neutral-800 bg-neutral-950 px-2.5 py-2 text-right">
                                    <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Score</p>
                                    <p className="text-sm text-white">{environmentQuality.score.toFixed(1)}</p>
                                </div>
                            ) : null}
                        </div>

                        {environmentQuality ? (
                            <div className="grid grid-cols-2 gap-2 text-[11px]">
                                <div className="rounded-lg border border-neutral-800 bg-neutral-950/70 px-3 py-2">
                                    Alignment {formatMetric(environmentQuality.alignment?.score)}
                                </div>
                                <div className="rounded-lg border border-neutral-800 bg-neutral-950/70 px-3 py-2">
                                    Appearance {formatMetric(environmentQuality.appearance?.score)}
                                </div>
                                <div className="rounded-lg border border-neutral-800 bg-neutral-950/70 px-3 py-2">
                                    Pose pairs {environmentQuality.alignment?.pose_pairs ?? 0}/{environmentQuality.alignment?.pair_count ?? 0}
                                </div>
                                <div className="rounded-lg border border-neutral-800 bg-neutral-950/70 px-3 py-2">
                                    Exposure span {formatMetric(environmentQuality.appearance?.exposure_span, 3)}
                                </div>
                            </div>
                        ) : null}

                        {environmentWarnings.length > 0 ? (
                            <div className="space-y-1">
                                {environmentWarnings.slice(0, 3).map((warning) => (
                                    <p key={warning} className="text-[11px] text-amber-200">
                                        {warning}
                                    </p>
                                ))}
                            </div>
                        ) : null}

                        {environmentDelivery ? (
                            <div className="rounded-lg border border-neutral-800 bg-neutral-950/70 px-3 py-3 space-y-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="font-medium tracking-wide uppercase text-[10px] text-neutral-500">Delivery Gate</p>
                                        <p className="mt-1 text-white">
                                            {environmentDelivery.label || formatQualityBand(environmentDelivery.readiness) || "Not scored"}
                                        </p>
                                        {environmentDelivery.summary ? (
                                            <p className="mt-1 text-[11px] text-neutral-500">{environmentDelivery.summary}</p>
                                        ) : null}
                                    </div>
                                    {typeof environmentDelivery.score === "number" ? (
                                        <div className="rounded-lg border border-neutral-800 bg-black/20 px-2.5 py-2 text-right">
                                            <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Gate Score</p>
                                            <p className="text-sm text-white">{environmentDelivery.score.toFixed(1)}</p>
                                        </div>
                                    ) : null}
                                </div>

                                {environmentDelivery.axes ? (
                                    <div className="grid grid-cols-2 gap-2 text-[11px] text-neutral-300">
                                        <div className="rounded-lg border border-neutral-800 bg-black/20 px-3 py-2">
                                            Geometry {formatMetric(environmentDelivery.axes.geometry?.score)}
                                        </div>
                                        <div className="rounded-lg border border-neutral-800 bg-black/20 px-3 py-2">
                                            Color {formatMetric(environmentDelivery.axes.color?.score)}
                                        </div>
                                        <div className="rounded-lg border border-neutral-800 bg-black/20 px-3 py-2">
                                            Coverage {formatMetric(environmentDelivery.axes.coverage?.score)}
                                        </div>
                                        <div className="rounded-lg border border-neutral-800 bg-black/20 px-3 py-2">
                                            Density {formatMetric(environmentDelivery.axes.density?.score)}
                                        </div>
                                    </div>
                                ) : null}

                                {environmentDelivery.recommended_viewer_mode || environmentDelivery.render_targets ? (
                                    <p className="text-[11px] text-neutral-400">
                                        Viewer profile {formatQualityBand(environmentDelivery.recommended_viewer_mode) || "standard"}
                                        {environmentDelivery.render_targets?.desktop_fps
                                            ? ` · ${environmentDelivery.render_targets.desktop_fps}fps desktop`
                                            : ""}
                                        {environmentDelivery.render_targets?.mobile_fps
                                            ? ` · ${environmentDelivery.render_targets.mobile_fps}fps mobile`
                                            : ""}
                                    </p>
                                ) : null}

                                {environmentBlockingIssues.length > 0 ? (
                                    <div className="space-y-1">
                                        {environmentBlockingIssues.slice(0, 3).map((issue) => (
                                            <p key={issue} className="text-[11px] text-amber-200">
                                                {issue}
                                            </p>
                                        ))}
                                    </div>
                                ) : null}

                                {environmentNextActions.length > 0 ? (
                                    <div className="space-y-1">
                                        {environmentNextActions.slice(0, 3).map((action) => (
                                            <p key={action} className="text-[11px] text-sky-200">
                                                {action}
                                            </p>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        ) : null}

                        {environmentCapture || environmentTraining || environmentHoldout || environmentComparison || environmentReleaseGates ? (
                            <div className="rounded-lg border border-neutral-800 bg-neutral-950/70 px-3 py-3 space-y-3">
                                <p className="font-medium tracking-wide uppercase text-[10px] text-neutral-500">World-Class Gates</p>
                                <div className="grid grid-cols-2 gap-2 text-[11px] text-neutral-300">
                                    <div className="rounded-lg border border-neutral-800 bg-black/20 px-3 py-2">
                                        Capture {environmentCapture?.frame_count ?? environmentMetadata?.frame_count ?? 0} frames
                                    </div>
                                    <div className="rounded-lg border border-neutral-800 bg-black/20 px-3 py-2">
                                        Benchmark {formatQualityBand(environmentComparison?.benchmark_status) || "not benchmarked"}
                                    </div>
                                    <div className="rounded-lg border border-neutral-800 bg-black/20 px-3 py-2">
                                        Training {formatQualityBand(environmentTraining?.backend) || "unknown"}
                                    </div>
                                    <div className="rounded-lg border border-neutral-800 bg-black/20 px-3 py-2">
                                        Holdout {environmentHoldout?.available ? "available" : "missing"}
                                    </div>
                                </div>
                                {environmentReleaseGates ? (
                                    <div className="rounded-lg border border-neutral-800 bg-black/20 px-3 py-3">
                                        <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Promotion gate</p>
                                        <p className="mt-1 text-sm text-white">
                                            {environmentReleaseGates.summary || "Promotion gates not reported"}
                                        </p>
                                        {environmentGateFailures.length > 0 ? (
                                            <div className="mt-2 space-y-1">
                                                {environmentGateFailures.slice(0, 4).map((failure) => (
                                                    <p key={failure} className="text-[11px] text-rose-200">
                                                        {failure}
                                                    </p>
                                                ))}
                                            </div>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                ) : null}

                <div className="grid grid-cols-2 gap-2">
                    <button
                        onClick={copyReviewLink}
                        className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-3 text-xs text-white hover:border-blue-500/50 hover:text-blue-200 transition-colors flex items-center justify-center gap-2"
                    >
                        <Share2 className="h-3.5 w-3.5" />
                        Copy review link
                    </button>
                    <button
                        onClick={exportScenePackage}
                        className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-3 text-xs text-white hover:border-blue-500/50 hover:text-blue-200 transition-colors flex items-center justify-center gap-2"
                    >
                        <Download className="h-3.5 w-3.5" />
                        Export scene package
                    </button>
                </div>
                {shareStatus && <p className="text-[11px] text-blue-300">{shareStatus}</p>}

                {clarityMode ? (
                    <>
                        <div className="grid grid-cols-2 gap-2">
                            <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 px-3 py-3">
                                <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Persistent world</p>
                                <p className="mt-1 text-sm text-white">{normalizedSceneGraph.environment ? "World state stays persistent" : "No world loaded yet"}</p>
                                <p className="mt-1 text-[11px] leading-5 text-neutral-500">{persistentWorldSummary}</p>
                            </div>
                            <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 px-3 py-3">
                                <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Scene direction</p>
                                <p className="mt-1 text-sm text-white">{normalizedSceneGraph.camera_views.length || normalizedSceneGraph.pins.length || normalizedSceneGraph.director_brief ? "Shot-only changes" : "No shot direction yet"}</p>
                                <p className="mt-1 text-[11px] leading-5 text-neutral-500">{sceneDirectionSummary}</p>
                            </div>
                        </div>

                        <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 px-3 py-3">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">What changed since the current output</p>
                            <p className="mt-2 text-sm text-white">{lastOutputLabel ?? "No output loaded yet"}</p>
                            {changeSummary ? (
                                <div className="mt-3 space-y-3">
                                    {changeSummary.persistent.length > 0 ? (
                                        <div>
                                            <p className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">Persistent world changes</p>
                                            <div className="mt-2 flex flex-wrap gap-2">
                                                {changeSummary.persistent.map((item) => (
                                                    <span key={item} className="rounded-full border border-emerald-500/20 bg-emerald-950/20 px-2.5 py-1 text-[11px] text-emerald-200">
                                                        {item}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    ) : null}
                                    {changeSummary.sceneDirection.length > 0 ? (
                                        <div>
                                            <p className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">Scene direction changes</p>
                                            <div className="mt-2 flex flex-wrap gap-2">
                                                {changeSummary.sceneDirection.map((item) => (
                                                    <span key={item} className="rounded-full border border-sky-500/20 bg-sky-950/20 px-2.5 py-1 text-[11px] text-sky-200">
                                                        {item}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    ) : null}
                                </div>
                            ) : (
                                <p className="mt-2 text-[11px] leading-5 text-neutral-500">No input changes since the current output was loaded.</p>
                            )}
                        </div>

                        <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 px-3 py-3">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Recent activity</p>
                                    <p className="mt-1 text-sm text-white">Lightweight version and action trail</p>
                                </div>
                                <span className="rounded-full border border-neutral-800 bg-black/20 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-neutral-400">
                                    {versions.length} versions
                                </span>
                            </div>

                            {activityLog.length > 0 ? (
                                <div className="mt-3 space-y-2">
                                    {activityLog.slice(0, 4).map((entry) => (
                                        <div key={entry.id} className={`rounded-lg border px-3 py-2 ${activityToneClass(entry.tone)}`}>
                                            <div className="flex items-center justify-between gap-3">
                                                <p className="text-xs text-white">{entry.label}</p>
                                                <p className="text-[11px] text-neutral-500">{formatTimestamp(entry.at)}</p>
                                            </div>
                                            <p className="mt-1 text-[11px] leading-5 text-neutral-400">{entry.detail}</p>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="mt-3 text-[11px] leading-5 text-neutral-500">Open the demo, build a world, save a version, or export a package to start the activity trail.</p>
                            )}

                            {versions.length > 0 ? (
                                <div className="mt-3 space-y-2">
                                    {versions.slice(0, 3).map((version) => (
                                        <div key={version.version_id} className="rounded-lg border border-neutral-800 bg-black/20 px-3 py-2">
                                            <div className="flex items-center justify-between gap-3">
                                                <p className="text-xs text-white">{formatTimestamp(version.saved_at) || version.version_id}</p>
                                                <button
                                                    onClick={() => void onRestoreVersion(version.version_id)}
                                                    className="rounded-full border border-neutral-800 bg-neutral-950 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-neutral-300 hover:border-blue-500/40 hover:text-blue-200"
                                                >
                                                    Restore
                                                </button>
                                            </div>
                                            <p className="mt-1 text-[11px] text-neutral-500">
                                                {version.source ?? "manual"} · {version.summary?.asset_count ?? 0} assets
                                                {version.summary?.has_environment ? " · world loaded" : ""}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    </>
                ) : null}
            </div>

            <div className="p-4 space-y-4 border-b border-neutral-800">
                <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 px-3 py-3 space-y-3">
                    <div className="flex items-center gap-2 text-[10px] font-bold text-neutral-500 uppercase tracking-wider">
                        <NotebookPen className="h-3 w-3" />
                        Production Review
                    </div>
                    {activeScene ? (
                        <>
                            <input
                                value={reviewData.metadata.project_name}
                                onChange={(event) => updateReviewField("project_name", event.target.value)}
                                className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-white outline-none focus:border-blue-500/60"
                                placeholder="Project name"
                            />
                            <input
                                value={reviewData.metadata.scene_title}
                                onChange={(event) => updateReviewField("scene_title", event.target.value)}
                                className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-white outline-none focus:border-blue-500/60"
                                placeholder="Scene title"
                            />
                            <div className="grid grid-cols-2 gap-2">
                                <input
                                    value={reviewData.metadata.location_name}
                                    onChange={(event) => updateReviewField("location_name", event.target.value)}
                                    className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-white outline-none focus:border-blue-500/60"
                                    placeholder="Location"
                                />
                                <input
                                    value={reviewData.metadata.owner}
                                    onChange={(event) => updateReviewField("owner", event.target.value)}
                                    className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-white outline-none focus:border-blue-500/60"
                                    placeholder="Owner"
                                />
                            </div>
                            <input
                                value={reviewData.metadata.address}
                                onChange={(event) => updateReviewField("address", event.target.value)}
                                className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-white outline-none focus:border-blue-500/60"
                                placeholder="Address"
                            />
                            <div className="grid grid-cols-2 gap-2">
                                <input
                                    value={reviewData.metadata.shoot_day}
                                    onChange={(event) => updateReviewField("shoot_day", event.target.value)}
                                    className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-white outline-none focus:border-blue-500/60"
                                    placeholder="Shoot day"
                                />
                                <input
                                    value={reviewData.metadata.permit_status}
                                    onChange={(event) => updateReviewField("permit_status", event.target.value)}
                                    className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-white outline-none focus:border-blue-500/60"
                                    placeholder="Permit status"
                                />
                            </div>
                            <textarea
                                value={reviewData.metadata.notes}
                                onChange={(event) => updateReviewField("notes", event.target.value)}
                                className="w-full min-h-20 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-white outline-none focus:border-blue-500/60"
                                placeholder="Production context"
                            />
                            <div className="grid grid-cols-1 gap-2">
                                <textarea
                                    value={reviewData.metadata.access_notes}
                                    onChange={(event) => updateReviewField("access_notes", event.target.value)}
                                    className="w-full min-h-16 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-white outline-none focus:border-blue-500/60"
                                    placeholder="Access notes"
                                />
                                <textarea
                                    value={reviewData.metadata.parking_notes}
                                    onChange={(event) => updateReviewField("parking_notes", event.target.value)}
                                    className="w-full min-h-16 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-white outline-none focus:border-blue-500/60"
                                    placeholder="Parking notes"
                                />
                                <textarea
                                    value={reviewData.metadata.power_notes}
                                    onChange={(event) => updateReviewField("power_notes", event.target.value)}
                                    className="w-full min-h-16 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-white outline-none focus:border-blue-500/60"
                                    placeholder="Power notes"
                                />
                                <textarea
                                    value={reviewData.metadata.safety_notes}
                                    onChange={(event) => updateReviewField("safety_notes", event.target.value)}
                                    className="w-full min-h-16 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-white outline-none focus:border-blue-500/60"
                                    placeholder="Safety notes"
                                />
                            </div>
                            <textarea
                                value={reviewData.approval.note ?? ""}
                                onChange={(event) => updateApprovalNote(event.target.value)}
                                className="w-full min-h-16 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-white outline-none focus:border-blue-500/60"
                                placeholder="Approval note"
                            />
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => void saveReview("in_review")}
                                    disabled={isSavingReview}
                                    className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-white disabled:opacity-50"
                                >
                                    Mark In Review
                                </button>
                                <button
                                    onClick={() => void saveReview("approved")}
                                    disabled={isSavingReview}
                                    className="rounded-lg border border-emerald-900/40 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200 disabled:opacity-50"
                                >
                                    Approve Scene
                                </button>
                                <button
                                    onClick={() => void saveReview("changes_requested")}
                                    disabled={isSavingReview}
                                    className="rounded-lg border border-amber-900/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-200 disabled:opacity-50"
                                >
                                    Request Changes
                                </button>
                                <button
                                    onClick={() => void saveReview()}
                                    disabled={isSavingReview}
                                    className="rounded-lg border border-neutral-800 bg-white px-3 py-2 text-xs text-black disabled:opacity-50"
                                >
                                    {isSavingReview ? "Saving..." : "Save Review"}
                                </button>
                            </div>
                            <div className="rounded-lg border border-neutral-800 bg-black/20 px-3 py-2 text-xs text-neutral-300">
                                <div className="flex items-center gap-2">
                                    <MapPinned className="h-3.5 w-3.5 text-neutral-500" />
                                    <span>
                                        Approval: {reviewData.approval.state?.replaceAll("_", " ") ?? "draft"}
                                        {reviewData.approval.updated_by ? ` · ${reviewData.approval.updated_by}` : ""}
                                    </span>
                                </div>
                                {reviewData.approval.updated_at && (
                                    <p className="mt-1 text-[11px] text-neutral-500">Updated {formatTimestamp(reviewData.approval.updated_at)}</p>
                                )}
                            </div>
                            {reviewStatus && <p className="text-[11px] text-emerald-300">{reviewStatus}</p>}
                            {reviewError && <p className="text-[11px] text-rose-300 whitespace-pre-wrap">{reviewError}</p>}
                        </>
                    ) : (
                        <p className="text-xs text-neutral-400">Save the scene once before attaching review metadata and approvals.</p>
                    )}
                </div>

                <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 px-3 py-3 space-y-3">
                    <div className="flex items-center gap-2 text-[10px] font-bold text-neutral-500 uppercase tracking-wider">
                        <MapPin className="h-3 w-3" />
                        Review Issues
                    </div>
                    {selectedVersion ? (
                        <>
                            <p className="text-[11px] text-neutral-500">
                                Anchors:{" "}
                                {selectedPin
                                    ? `pin ${selectedPin.label}`
                                    : selectedView
                                      ? `view ${selectedView.label}`
                                      : "select a pin or saved view to bind the issue"}
                            </p>
                            <input
                                value={issueDraft.title}
                                onChange={(event) => setIssueDraft((prev) => ({ ...prev, title: event.target.value }))}
                                className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-white outline-none focus:border-blue-500/60"
                                placeholder="Issue title"
                            />
                            <textarea
                                value={issueDraft.body}
                                onChange={(event) => setIssueDraft((prev) => ({ ...prev, body: event.target.value }))}
                                className="w-full min-h-20 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-white outline-none focus:border-blue-500/60"
                                placeholder="What needs to change, verify, or protect?"
                            />
                            <div className="grid grid-cols-2 gap-2">
                                <select
                                    value={issueDraft.type}
                                    onChange={(event) => setIssueDraft((prev) => ({ ...prev, type: event.target.value as SpatialPinType }))}
                                    className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-white outline-none focus:border-blue-500/60"
                                >
                                    <option value="general">General</option>
                                    <option value="egress">Egress</option>
                                    <option value="lighting">Lighting</option>
                                    <option value="hazard">Hazard</option>
                                </select>
                                <select
                                    value={issueDraft.severity}
                                    onChange={(event) =>
                                        setIssueDraft((prev) => ({ ...prev, severity: event.target.value as ReviewIssueSeverity }))
                                    }
                                    className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-white outline-none focus:border-blue-500/60"
                                >
                                    <option value="low">Low</option>
                                    <option value="medium">Medium</option>
                                    <option value="high">High</option>
                                    <option value="critical">Critical</option>
                                </select>
                                <select
                                    value={issueDraft.status}
                                    onChange={(event) =>
                                        setIssueDraft((prev) => ({ ...prev, status: event.target.value as ReviewIssueStatus }))
                                    }
                                    className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-white outline-none focus:border-blue-500/60"
                                >
                                    <option value="open">Open</option>
                                    <option value="in_review">In Review</option>
                                    <option value="blocked">Blocked</option>
                                    <option value="resolved">Resolved</option>
                                </select>
                                <input
                                    value={issueDraft.assignee}
                                    onChange={(event) => setIssueDraft((prev) => ({ ...prev, assignee: event.target.value }))}
                                    className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-white outline-none focus:border-blue-500/60"
                                    placeholder="Assignee"
                                />
                            </div>
                            <input
                                value={issueDraft.author}
                                onChange={(event) => setIssueDraft((prev) => ({ ...prev, author: event.target.value }))}
                                className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-white outline-none focus:border-blue-500/60"
                                placeholder="Reviewer"
                            />
                            <button
                                onClick={() => void addIssue()}
                                disabled={!activeScene || !selectedVersion || (!issueDraft.title.trim() && !issueDraft.body.trim())}
                                className="w-full rounded-lg bg-white text-black text-xs font-medium px-3 py-2 disabled:opacity-50"
                            >
                                Add Structured Issue
                            </button>
                            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                                {reviewData.issues.length > 0 ? (
                                    reviewData.issues
                                        .filter((issue) => !selectedVersion || issue.version_id === selectedVersion.version_id)
                                        .map((issue) => (
                                            <div key={issue.id} className="rounded-lg border border-neutral-800 bg-neutral-950/70 px-3 py-3">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <p className="text-sm text-white">{issue.title}</p>
                                                        <p className="mt-1 text-[11px] text-neutral-500">
                                                            {issue.author}
                                                            {issue.assignee ? ` -> ${issue.assignee}` : ""}
                                                            {issue.created_at ? ` · ${formatTimestamp(issue.created_at)}` : ""}
                                                        </p>
                                                    </div>
                                                    <button
                                                        onClick={() => void deleteIssue(issue.id)}
                                                        className="p-1 rounded text-rose-300 hover:text-rose-200 hover:bg-rose-950/40"
                                                        title="Delete issue"
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </button>
                                                </div>
                                                {issue.body ? <p className="mt-2 text-xs text-neutral-300 whitespace-pre-wrap">{issue.body}</p> : null}
                                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                                    <span className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${issueSeverityClass(issue.severity)}`}>
                                                        {issue.severity}
                                                    </span>
                                                    <span className="rounded-full border border-neutral-800 bg-black/20 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-neutral-300">
                                                        {formatPinTypeLabel(issue.type)}
                                                    </span>
                                                    <select
                                                        value={issue.status}
                                                        onChange={(event) =>
                                                            void updateIssueStatus(issue.id, event.target.value as ReviewIssueStatus)
                                                        }
                                                        className="rounded-full border border-neutral-800 bg-black/20 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-neutral-300 outline-none"
                                                    >
                                                        <option value="open">Open</option>
                                                        <option value="in_review">In Review</option>
                                                        <option value="blocked">Blocked</option>
                                                        <option value="resolved">Resolved</option>
                                                    </select>
                                                    {(issue.anchor_position || issue.anchor_view_id) ? (
                                                        <button
                                                            onClick={() => focusIssue(issue)}
                                                            className="rounded-full border border-neutral-800 bg-black/20 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-neutral-300 hover:border-blue-500/40 hover:text-blue-200"
                                                        >
                                                            <Focus className="mr-1 inline h-3 w-3" />
                                                            Focus
                                                        </button>
                                                    ) : null}
                                                </div>
                                            </div>
                                        ))
                                ) : (
                                    <p className="text-xs text-neutral-400">No structured issues yet for this scene.</p>
                                )}
                            </div>
                        </>
                    ) : (
                        <p className="text-xs text-neutral-400">Save the scene to start leaving structured review issues.</p>
                    )}
                </div>

                <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 px-3 py-3">
                    <div className="flex items-center gap-2 mb-3 text-[10px] font-bold text-neutral-500 uppercase tracking-wider">
                        <History className="h-3 w-3" />
                        Version History
                    </div>
                    {versions.length > 0 ? (
                        <div className="space-y-2">
                            {versions.slice(0, 6).map((version) => {
                                const isSelected = version.version_id === selectedVersion?.version_id;
                                const count = Math.max(version.comment_count ?? 0, issueCountForVersion(version.version_id));
                                return (
                                    <div
                                        key={version.version_id}
                                        onClick={() => setSelectedVersionId(version.version_id)}
                                        className={`rounded-lg border px-3 py-2 text-xs flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                                            isSelected
                                                ? "border-blue-500/60 bg-blue-950/20"
                                                : "border-neutral-800 bg-neutral-950/60 hover:border-neutral-700"
                                        }`}
                                    >
                                        <div className="min-w-0">
                                            <p className="text-white truncate">{formatTimestamp(version.saved_at) || version.version_id}</p>
                                            <p className="text-neutral-500">
                                                {version.source ?? "manual"} · {version.summary?.asset_count ?? 0} assets
                                                {version.summary?.has_environment ? " · env" : ""}
                                                {typeof count === "number" ? ` · ${count} review items` : ""}
                                            </p>
                                        </div>
                                        <button
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                void onRestoreVersion(version.version_id);
                                            }}
                                            className="shrink-0 p-1.5 rounded text-neutral-300 hover:text-white hover:bg-neutral-800"
                                            title="Restore version"
                                        >
                                            <RefreshCcw className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <p className="text-xs text-neutral-400">Autosaves and manual saves will appear here.</p>
                    )}
                    {legacyComments.length > 0 ? (
                        <div className="mt-3 rounded-xl border border-neutral-800 bg-black/20 p-3">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Legacy Version Notes</p>
                            <div className="mt-2 space-y-2">
                                {legacyComments.slice(0, 3).map((comment) => (
                                    <div key={comment.comment_id} className="rounded-lg border border-neutral-800 bg-neutral-950/50 px-3 py-2">
                                        <div className="flex items-center justify-between gap-3">
                                            <p className="text-xs text-white">{comment.author}</p>
                                            <p className="text-[11px] text-neutral-500">{formatTimestamp(comment.created_at)}</p>
                                        </div>
                                        <p className="mt-2 text-xs text-neutral-300 whitespace-pre-wrap">{comment.body}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>

            <div className="p-4 border-b border-neutral-800 shrink-0">
                <div className="flex items-center gap-2 mb-4 text-xs font-bold text-neutral-500 uppercase tracking-wider">
                    <Layers className="h-3 w-3" />
                    Scene Graph
                </div>

                <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 px-3 py-3">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Workspace</p>
                        <p className="mt-1 text-sm text-white">{sceneGraphItemCount} staged elements</p>
                        <p className="mt-1 text-[11px] text-neutral-500">
                            {normalizedSceneGraph.environment ? "Environment anchored" : "No environment yet"}
                        </p>
                    </div>
                    <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 px-3 py-3">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Coverage</p>
                        <p className="mt-1 text-sm text-white">
                            {normalizedSceneGraph.camera_views.length} views · {normalizedSceneGraph.pins.length} pins
                        </p>
                        <p className="mt-1 text-[11px] text-neutral-500">
                            {normalizedSceneGraph.assets.length} placed assets in the scene
                        </p>
                    </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                    <button
                        onClick={focusWorkspace}
                        className="rounded-full border border-neutral-800 bg-neutral-900 px-3 py-2 text-[11px] text-white transition-colors hover:border-blue-500/40 hover:text-blue-200"
                    >
                        <Focus className="mr-1 inline h-3.5 w-3.5" />
                        Focus Workspace
                    </button>
                    <button
                        onClick={stageNextLocalAsset}
                        disabled={!nextLocalAsset}
                        className="rounded-full border border-neutral-800 bg-neutral-900 px-3 py-2 text-[11px] text-white transition-colors hover:border-blue-500/40 hover:text-blue-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <Box className="mr-1 inline h-3.5 w-3.5" />
                        {nextLocalAsset ? "Stage Next Asset" : "No Local Assets Yet"}
                    </button>
                </div>

                <div className="mt-4 space-y-3 max-h-[28rem] overflow-y-auto pr-1">
                    {normalizedSceneGraph.environment ? (
                        <div className="bg-neutral-900/80 rounded-lg px-3 py-2.5 text-emerald-400 border border-emerald-900/30 flex justify-between items-center shadow-inner">
                            <span className="font-medium">{environmentState.lane === "preview" ? "Preview Splat" : "Environment Splat"}</span>
                            <span className="text-[10px] bg-emerald-950/50 px-1.5 py-0.5 rounded text-emerald-500 font-mono tracking-wider">
                                {environmentState.badge}
                            </span>
                        </div>
                    ) : null}

                    {normalizedSceneGraph.camera_views.length > 0 ? (
                        <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 px-3 py-3">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500 mb-2">Saved Views</p>
                            <div className="space-y-2">
                                {normalizedSceneGraph.camera_views.map((view) => (
                                    <div key={view.id} className="rounded-lg border border-neutral-800 bg-neutral-950/70 px-3 py-2">
                                        <div className="flex items-center justify-between gap-2">
                                            <div>
                                                <p className="text-xs text-white">{view.label}</p>
                                                <p className="text-[11px] text-neutral-500">
                                                    {view.lens_mm.toFixed(0)}mm · FOV {view.fov.toFixed(1)}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={() => focusView(view)}
                                                    className="p-1 rounded text-neutral-300 hover:text-white hover:bg-neutral-800"
                                                    title="Focus view"
                                                >
                                                    <Focus className="h-3.5 w-3.5" />
                                                </button>
                                                <button
                                                    onClick={() => deleteView(view.id)}
                                                    className="p-1 rounded text-rose-300 hover:text-rose-200 hover:bg-rose-950/40"
                                                    title="Delete view"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    {normalizedSceneGraph.pins.length > 0 ? (
                        <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 px-3 py-3">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500 mb-2">Spatial Pins</p>
                            <div className="space-y-2">
                                {normalizedSceneGraph.pins.map((pin) => (
                                    <div key={pin.id} className="rounded-lg border border-neutral-800 bg-neutral-950/70 px-3 py-2">
                                        <div className="flex items-center justify-between gap-2">
                                            <div>
                                                <p className="text-xs text-white">{pin.label}</p>
                                                <p className="text-[11px] text-neutral-500">
                                                    {formatPinTypeLabel(pin.type)} · [{pin.position.map((value) => value.toFixed(2)).join(", ")}]
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={() => focusPin(pin)}
                                                    className="p-1 rounded text-neutral-300 hover:text-white hover:bg-neutral-800"
                                                    title="Focus pin"
                                                >
                                                    <Focus className="h-3.5 w-3.5" />
                                                </button>
                                                <button
                                                    onClick={() => deletePin(pin.id)}
                                                    className="p-1 rounded text-rose-300 hover:text-rose-200 hover:bg-rose-950/40"
                                                    title="Delete pin"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    {normalizedSceneGraph.assets.map((asset: any, index: number) => (
                        <div
                            key={asset.instanceId || index}
                            className="bg-neutral-900/50 rounded-lg px-3 py-2.5 text-blue-400 border border-blue-900/30 flex flex-col gap-2 hover:border-blue-700/50 hover:bg-neutral-900 transition-colors"
                        >
                            <div className="flex justify-between items-center">
                                <span className="font-medium flex items-center gap-2 truncate">
                                    <Box className="h-3 w-3 opacity-50 shrink-0" /> {asset.name}
                                </span>
                                <div className="flex items-center gap-1 shrink-0">
                                    <button
                                        onClick={() => duplicateSceneAsset(asset.instanceId)}
                                        className="p-1 rounded text-neutral-300 hover:text-white hover:bg-neutral-800"
                                        title="Duplicate"
                                    >
                                        <Copy className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                        onClick={() => deleteSceneAsset(asset.instanceId)}
                                        className="p-1 rounded text-rose-300 hover:text-rose-200 hover:bg-rose-950/40"
                                        title="Delete"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            </div>
                            <span className="text-xs text-neutral-500 font-mono">
                                pos [{(asset.position ?? [0, 0, 0]).map((value: number) => Number(value).toFixed(2)).join(", ")}]
                            </span>
                        </div>
                    ))}

                    {normalizedSceneGraph.assets.length === 0 && !normalizedSceneGraph.environment ? (
                        <div className="rounded-2xl border border-dashed border-neutral-800 bg-neutral-900/40 px-4 py-4">
                            <p className="text-sm text-white">Nothing is staged yet.</p>
                            <p className="mt-2 text-xs text-neutral-400">
                                Generate a preview or reconstruction on the left, save views from the viewer, drop pins for blocking notes,
                                and place assets here for layout.
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                    onClick={focusWorkspace}
                                    className="rounded-full border border-neutral-800 bg-black/20 px-3 py-2 text-[11px] text-neutral-200 hover:border-blue-500/40 hover:text-blue-200"
                                >
                                    Scout Viewer
                                </button>
                                <button
                                    onClick={stageNextLocalAsset}
                                    disabled={!nextLocalAsset}
                                    className="rounded-full border border-neutral-800 bg-black/20 px-3 py-2 text-[11px] text-neutral-200 hover:border-blue-500/40 hover:text-blue-200 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {nextLocalAsset ? "Place First Asset" : "Generate an Asset First"}
                                </button>
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>

            <div className="p-4 bg-neutral-900/20 shrink-0">
                <div className="flex items-center gap-2 mb-4 text-xs font-bold text-neutral-500 uppercase tracking-wider">
                    <Box className="h-3 w-3" />
                    Local Assets
                </div>

                <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 px-3 py-3">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Library</p>
                        <p className="mt-1 text-sm text-white">{assetsList.length} assets ready</p>
                        <p className="mt-1 text-[11px] text-neutral-500">Click or drag assets into the viewer.</p>
                    </div>
                    <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 px-3 py-3">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Scene Usage</p>
                        <p className="mt-1 text-sm text-white">{normalizedSceneGraph.assets.length} staged instances</p>
                        <p className="mt-1 text-[11px] text-neutral-500">
                            {nextLocalAsset ? `${nextLocalAsset.name} is next to place.` : "Generate or restore assets to start layout."}
                        </p>
                    </div>
                </div>

                <p className="mt-3 text-[11px] text-neutral-500">
                    Filmmaker workflow: build the environment first, then click or drag hero props into the viewer and place notes or views around them.
                </p>

                {assetsList.length > 0 ? (
                    <div className="mt-4 grid max-h-[30rem] grid-cols-2 gap-3 overflow-y-auto pb-8 pr-1">
                        {assetsList.map((asset: any, index: number) => (
                            <div
                                key={asset.id || index}
                                draggable
                                onDragStart={(event) => handleDragStart(event, asset)}
                                onClick={() => addAssetToScene(asset)}
                                className="bg-neutral-900 border border-neutral-800 rounded-xl p-3 hover:border-blue-500/50 cursor-grab active:cursor-grabbing transition-all group aspect-square flex flex-col justify-between hover:shadow-xl hover:shadow-black/50 animate-in zoom-in-95 duration-200"
                                title="Click to place in scene or drag into the viewer"
                            >
                                <div className="flex items-center justify-between gap-2 mb-2">
                                    <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">
                                        {(libraryAssetCounts.get(assetLibraryKey(asset, index)) ?? 0) > 0
                                            ? `${libraryAssetCounts.get(assetLibraryKey(asset, index))} in scene`
                                            : "Ready to place"}
                                    </span>
                                    <button
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            addAssetToScene(asset);
                                        }}
                                        className="rounded-full border border-neutral-800 bg-black/20 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-neutral-200 hover:border-blue-500/40 hover:text-blue-200"
                                    >
                                        Place
                                    </button>
                                </div>
                                <div
                                    className="w-full flex-1 bg-gradient-to-tr from-neutral-800 to-neutral-700 rounded-lg mb-2 overflow-hidden relative shadow-inner bg-cover bg-center"
                                    style={asset.preview ? { backgroundImage: `url(${asset.preview})` } : undefined}
                                >
                                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-neutral-900/40 transition-opacity backdrop-blur-[2px]">
                                        <div className="bg-blue-600 text-white rounded-full p-1 shadow-lg pointer-events-none">
                                            <Box className="h-4 w-4" />
                                        </div>
                                    </div>
                                </div>
                                <div>
                                    <p className="text-xs text-center text-neutral-400 font-medium truncate group-hover:text-blue-200">{asset.name}</p>
                                    <p className="mt-1 text-[10px] text-center text-neutral-400">
                                        Click to stage at origin or drag into the viewer.
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="mt-4 flex min-h-[10rem] items-center justify-center rounded-xl border-2 border-dashed border-neutral-800/50 bg-neutral-900/30 px-4 py-6 text-center">
                        <div>
                            <p className="text-sm text-white">No local assets yet.</p>
                            <p className="mt-2 text-xs text-neutral-500">
                                Generate an asset from a selected frame in the left rail. When it finishes, it will appear here with one-click
                                staging into the scene.
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
