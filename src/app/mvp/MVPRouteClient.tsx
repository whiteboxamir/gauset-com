"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LeftPanel from "@/components/Editor/LeftPanel";
import ViewerPanel from "@/components/Editor/ViewerPanel";
import RightPanel from "@/components/Editor/RightPanel";
import { MVP_API_BASE_URL, toProxyUrl } from "@/lib/mvp-api";
import { resolveEnvironmentRenderState } from "@/lib/mvp-product";
import { createEmptyWorkspaceSceneGraph, normalizeWorkspaceSceneGraph, PersistedSceneGraphV1 } from "@/lib/mvp-workspace";
import MVPClarityLaunchpad from "./_components/MVPClarityLaunchpad";
import { MvpActivityEntry, buildChangeSummary, createActivityEntry, createDemoWorldPreset } from "./_lib/clarity";
import { trackMvpEvent } from "./_lib/analytics";

const LOCAL_DRAFT_KEY = "gauset:mvp:draft:v1";
const MVP_WORKSPACE_SHELL_LOCK_VERSION = "2026-03-11";
const HUD_LAYOUT_STORAGE_KEY_PREFIX = `gauset:mvp:hud:${MVP_WORKSPACE_SHELL_LOCK_VERSION}`;
const AUTOSAVE_DEBOUNCE_MS = 1500;
const PROGRAMMATIC_CHANGE_RESET_MS = 80;
const HUD_RAIL_EXPANDED_WIDTH_CLASS = "w-80";
const HUD_RAIL_COLLAPSED_WIDTH_CLASS = "w-14";

type SaveState = "idle" | "saving" | "saved" | "recovered" | "error";
type WorkspaceEntryMode = "launchpad" | "workspace";
type MvpRouteVariant = "workspace" | "preview";

interface WorkspaceHudState {
    leftRailCollapsed: boolean;
    rightRailCollapsed: boolean;
    directorHudCompact: boolean;
}

interface SceneVersion {
    version_id: string;
    saved_at: string;
    source?: string;
    summary?: {
        asset_count?: number;
        has_environment?: boolean;
    };
}

interface StoredDraft {
    activeScene: string | null;
    sceneGraph: any;
    assetsList: any[];
    updatedAt?: string | null;
}

interface StepStatus {
    busy: boolean;
    label: string;
    detail?: string;
}

interface GenerationTelemetry {
    kind: "preview" | "reconstruction" | "asset" | "generated_image";
    label: string;
    detail?: string;
    inputLabel?: string;
    sceneId?: string;
    assetId?: string;
    sceneGraph?: any;
}

const createSceneId = () => `scene_${Date.now().toString(36)}`;

const hasTextContent = (value: unknown) => typeof value === "string" && value.trim().length > 0;

const shouldKeepEnvironment = (environment: any) => {
    if (!environment || typeof environment !== "object") {
        return false;
    }

    const renderState = resolveEnvironmentRenderState(environment);
    return (
        renderState.hasRenderableOutput ||
        Boolean(renderState.referenceImage) ||
        hasTextContent(environment?.sourceLabel) ||
        hasTextContent(environment?.statusLabel) ||
        hasTextContent(environment?.label) ||
        hasTextContent(environment?.lane) ||
        hasTextContent(environment?.metadata?.truth_label) ||
        hasTextContent(environment?.metadata?.reconstruction_status)
    );
};

const normalizeEnvironmentResourceUrls = (environment: any) => {
    if (!environment || typeof environment !== "object") {
        return environment ?? null;
    }

    const urls = environment.urls && typeof environment.urls === "object" ? environment.urls : null;
    const normalized = {
        ...environment,
        ...(urls
            ? {
                  urls: {
                      ...urls,
                      viewer: typeof urls.viewer === "string" ? toProxyUrl(urls.viewer) : urls.viewer,
                      splats: typeof urls.splats === "string" ? toProxyUrl(urls.splats) : urls.splats,
                      cameras: typeof urls.cameras === "string" ? toProxyUrl(urls.cameras) : urls.cameras,
                      metadata: typeof urls.metadata === "string" ? toProxyUrl(urls.metadata) : urls.metadata,
                      preview_projection:
                          typeof urls.preview_projection === "string" ? toProxyUrl(urls.preview_projection) : urls.preview_projection,
                      holdout_report: typeof urls.holdout_report === "string" ? toProxyUrl(urls.holdout_report) : urls.holdout_report,
                      capture_scorecard:
                          typeof urls.capture_scorecard === "string" ? toProxyUrl(urls.capture_scorecard) : urls.capture_scorecard,
                      benchmark_report:
                          typeof urls.benchmark_report === "string" ? toProxyUrl(urls.benchmark_report) : urls.benchmark_report,
                  },
              }
            : {}),
    };

    return shouldKeepEnvironment(normalized) ? normalized : null;
};

const normalizeAssetEntries = (assets: any[]) =>
    assets.map((asset) =>
        asset && typeof asset === "object"
            ? {
                  ...asset,
                  mesh: typeof asset.mesh === "string" ? toProxyUrl(asset.mesh) : asset.mesh,
                  texture: typeof asset.texture === "string" ? toProxyUrl(asset.texture) : asset.texture,
                  preview: typeof asset.preview === "string" ? toProxyUrl(asset.preview) : asset.preview,
              }
            : asset,
    );

const normalizeSceneGraph = (sceneGraph: any): PersistedSceneGraphV1 => {
    const normalized = normalizeWorkspaceSceneGraph(sceneGraph);
    return {
        ...normalized,
        environment: normalizeEnvironmentResourceUrls(normalized.environment),
        assets: normalizeAssetEntries(normalized.assets),
    };
};

const hasSceneContent = (sceneGraph: any) => {
    const normalized = normalizeSceneGraph(sceneGraph);
    return (
        normalized.assets.length > 0 ||
        (normalized.environment ? resolveEnvironmentRenderState(normalized.environment).hasRenderableOutput || Boolean(resolveEnvironmentRenderState(normalized.environment).referenceImage) : false)
    );
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

const createDefaultHudState = (routeVariant: MvpRouteVariant): WorkspaceHudState =>
    routeVariant === "preview"
        ? {
              leftRailCollapsed: true,
              rightRailCollapsed: true,
              directorHudCompact: true,
          }
        : {
              leftRailCollapsed: false,
              rightRailCollapsed: false,
              directorHudCompact: false,
          };

const normalizeHudState = (routeVariant: MvpRouteVariant, value: unknown): WorkspaceHudState => {
    const fallback = createDefaultHudState(routeVariant);
    if (!value || typeof value !== "object") {
        return fallback;
    }

    const input = value as Partial<WorkspaceHudState>;
    return {
        leftRailCollapsed: typeof input.leftRailCollapsed === "boolean" ? input.leftRailCollapsed : fallback.leftRailCollapsed,
        rightRailCollapsed: typeof input.rightRailCollapsed === "boolean" ? input.rightRailCollapsed : fallback.rightRailCollapsed,
        directorHudCompact: typeof input.directorHudCompact === "boolean" ? input.directorHudCompact : fallback.directorHudCompact,
    };
};

const hudStorageKey = (routeVariant: MvpRouteVariant) => `${HUD_LAYOUT_STORAGE_KEY_PREFIX}:${routeVariant}`;

export default function MVPRouteClient({
    clarityMode = false,
    routeVariant = "workspace",
}: {
    clarityMode?: boolean;
    routeVariant?: MvpRouteVariant;
}) {
    const demoPreset = useMemo(() => createDemoWorldPreset(), []);
    const flowName = clarityMode ? "clarity_preview" : "classic";

    const [entryMode, setEntryMode] = useState<WorkspaceEntryMode>(clarityMode ? "launchpad" : "workspace");
    const [activeScene, setActiveScene] = useState<string | null>(null);
    const [sceneGraph, setSceneGraph] = useState<any>(() => normalizeSceneGraph(createEmptyWorkspaceSceneGraph()));
    const [assetsList, setAssetsList] = useState<any[]>([]);
    const [saveState, setSaveState] = useState<SaveState>("idle");
    const [saveMessage, setSaveMessage] = useState(
        clarityMode ? "Open the demo world or upload a still to begin." : "Scene is empty.",
    );
    const [saveError, setSaveError] = useState("");
    const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
    const [versions, setVersions] = useState<SceneVersion[]>([]);
    const [storedDraft, setStoredDraft] = useState<StoredDraft | null>(null);
    const [stepStatus, setStepStatus] = useState<StepStatus | null>(null);
    const [activityLog, setActivityLog] = useState<MvpActivityEntry[]>([]);
    const [currentInputLabel, setCurrentInputLabel] = useState<string | null>(null);
    const [lastOutputInputLabel, setLastOutputInputLabel] = useState<string | null>(null);
    const [lastOutputSceneGraph, setLastOutputSceneGraph] = useState<any | null>(null);
    const [lastOutputLabel, setLastOutputLabel] = useState("No world output yet");
    const [hudState, setHudState] = useState<WorkspaceHudState>(() => createDefaultHudState(routeVariant));

    const hasHydratedRef = useRef(false);
    const hudHydratedRef = useRef(false);
    const lastSavedFingerprintRef = useRef("");
    const versionsRequestRef = useRef(0);
    const saveInFlightRef = useRef<Promise<any> | null>(null);
    const programmaticSceneChangeRef = useRef(false);
    const previousSceneFingerprintRef = useRef("");
    const sessionAnalyticsRef = useRef({
        firstEdit: false,
        firstGenerate: false,
        firstSuccess: false,
    });

    const sceneFingerprint = useMemo(
        () => JSON.stringify({ activeScene, sceneGraph: normalizeSceneGraph(sceneGraph), assetsList, currentInputLabel }),
        [activeScene, assetsList, currentInputLabel, sceneGraph],
    );

    const appendActivity = useCallback((label: string, detail: string, tone: MvpActivityEntry["tone"] = "neutral") => {
        setActivityLog((prev) => [createActivityEntry(label, detail, tone), ...prev].slice(0, 8));
    }, []);

    const markProgrammaticSceneChange = useCallback(() => {
        programmaticSceneChangeRef.current = true;
        window.setTimeout(() => {
            programmaticSceneChangeRef.current = false;
        }, PROGRAMMATIC_CHANGE_RESET_MS);
    }, []);

    const registerFirstEdit = useCallback(
        (surface: string) => {
            if (sessionAnalyticsRef.current.firstEdit) return;
            sessionAnalyticsRef.current.firstEdit = true;
            trackMvpEvent("mvp_first_edit", {
                flow: flowName,
                surface,
            });
            appendActivity("First edit", `Changed ${surface} after the current output loaded.`, "info");
        },
        [appendActivity, flowName],
    );

    const loadVersions = useCallback(async (sceneId: string) => {
        const requestId = ++versionsRequestRef.current;
        try {
            const response = await fetch(`${MVP_API_BASE_URL}/scene/${sceneId}/versions`, {
                cache: "no-store",
            });
            if (!response.ok) {
                throw new Error(`Version history unavailable (${response.status})`);
            }
            const payload = await response.json();
            if (versionsRequestRef.current === requestId) {
                setVersions(Array.isArray(payload.versions) ? payload.versions : []);
            }
        } catch {
            if (versionsRequestRef.current === requestId) {
                setVersions([]);
            }
        }
    }, []);

    const applyWorkspaceSnapshot = useCallback(
        (
            snapshot: {
                activeScene: string | null;
                sceneGraph: any;
                assetsList: any[];
                saveState: SaveState;
                saveMessage: string;
                currentInputLabel?: string | null;
                lastSavedAt?: string | null;
                lastOutputLabel?: string;
                lastOutputAt?: string | null;
            },
            options?: {
                keepAsLastOutput?: boolean;
            },
        ) => {
            const normalizedSceneGraph = normalizeSceneGraph(snapshot.sceneGraph);
            const normalizedAssetsList = normalizeAssetEntries(Array.isArray(snapshot.assetsList) ? snapshot.assetsList : []);
            markProgrammaticSceneChange();
            setActiveScene(snapshot.activeScene);
            setSceneGraph(normalizedSceneGraph);
            setAssetsList(normalizedAssetsList);
            setVersions([]);
            setSaveState(snapshot.saveState);
            setSaveError("");
            setSaveMessage(snapshot.saveMessage);
            setLastSavedAt(snapshot.lastSavedAt ?? null);
            setCurrentInputLabel(snapshot.currentInputLabel ?? null);
            setLastOutputLabel(snapshot.lastOutputLabel ?? "Current workspace");
            setEntryMode("workspace");

            if (options?.keepAsLastOutput) {
                setLastOutputSceneGraph(normalizedSceneGraph);
                setLastOutputInputLabel(snapshot.currentInputLabel ?? null);
                lastSavedFingerprintRef.current = JSON.stringify({
                    activeScene: snapshot.activeScene,
                    sceneGraph: normalizedSceneGraph,
                    assetsList: normalizedAssetsList,
                });
            } else {
                setLastOutputSceneGraph(null);
                setLastOutputInputLabel(null);
                lastSavedFingerprintRef.current = "";
            }
        },
        [markProgrammaticSceneChange],
    );

    const openDemoWorld = useCallback(() => {
        applyWorkspaceSnapshot(
            {
                activeScene: null,
                sceneGraph: demoPreset.sceneGraph,
                assetsList: demoPreset.assetsList,
                saveState: "recovered",
                saveMessage: "Demo world loaded. Update the director brief or export a version when you are ready.",
                currentInputLabel: demoPreset.inputLabel,
                lastOutputLabel: "Demo world",
                lastOutputAt: new Date().toISOString(),
            },
            { keepAsLastOutput: true },
        );

        setStepStatus(null);
        appendActivity("Demo world opened", "Loaded a sample world so persistence is visible immediately.", "info");
        trackMvpEvent("mvp_demo_open", { flow: flowName });
    }, [appendActivity, applyWorkspaceSnapshot, demoPreset, flowName]);

    const startBlankWorkspace = useCallback(() => {
        applyWorkspaceSnapshot(
            {
                activeScene: null,
                sceneGraph: createEmptyWorkspaceSceneGraph(),
                assetsList: [],
                saveState: "idle",
                saveMessage: "Upload one still to build your first persistent world.",
                currentInputLabel: null,
                lastOutputLabel: "No world output yet",
                lastOutputAt: null,
            },
            { keepAsLastOutput: false },
        );
        setStepStatus(null);
        appendActivity("Workspace ready", "Upload one still or return to the demo world.", "neutral");
    }, [appendActivity, applyWorkspaceSnapshot]);

    const resumeStoredDraft = useCallback(() => {
        if (!storedDraft) {
            startBlankWorkspace();
            return;
        }

        applyWorkspaceSnapshot(
            {
                activeScene: storedDraft.activeScene,
                sceneGraph: storedDraft.sceneGraph,
                assetsList: storedDraft.assetsList,
                saveState: "recovered",
                saveMessage: storedDraft.updatedAt
                    ? `Recovered local draft from ${formatTimestamp(storedDraft.updatedAt)}`
                    : "Recovered local draft.",
                currentInputLabel:
                    typeof storedDraft.sceneGraph?.environment?.sourceLabel === "string"
                        ? storedDraft.sceneGraph.environment.sourceLabel
                        : null,
                lastSavedAt: null,
                lastOutputLabel: "Recovered draft",
                lastOutputAt: storedDraft.updatedAt ?? null,
            },
            { keepAsLastOutput: false },
        );
        appendActivity("Draft resumed", "Recovered the last local /mvp draft.", "info");
    }, [applyWorkspaceSnapshot, startBlankWorkspace, storedDraft, appendActivity]);

    const saveScene = useCallback(
        async (source: "manual" | "autosave" = "manual") => {
            const nextSceneId = activeScene ?? createSceneId();
            const normalizedSceneGraph = normalizeSceneGraph(sceneGraph);

            if (!hasSceneContent(normalizedSceneGraph)) {
                setSaveState("idle");
                setSaveError("");
                setSaveMessage(
                    clarityMode ? "Open the demo world or build your own world before saving." : "Scene is empty.",
                );
                return null;
            }

            setSaveState("saving");
            setSaveError("");
            setSaveMessage(source === "autosave" ? "Autosaving scene..." : "Saving scene...");

            const request = fetch(`${MVP_API_BASE_URL}/scene/save`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    scene_id: nextSceneId,
                    scene_graph: normalizedSceneGraph,
                    source,
                }),
            })
                .then(async (response) => {
                    if (!response.ok) {
                        throw new Error(`Scene save failed (${response.status})`);
                    }

                    const payload = await response.json();
                    const savedAt = payload.saved_at ?? new Date().toISOString();
                    setActiveScene(nextSceneId);
                    setSaveState("saved");
                    setSaveMessage(
                        source === "autosave"
                            ? `Autosaved ${formatTimestamp(savedAt)}`
                            : `Saved ${nextSceneId} at ${formatTimestamp(savedAt)}`,
                    );
                    setLastSavedAt(savedAt);
                    lastSavedFingerprintRef.current = JSON.stringify({
                        activeScene: nextSceneId,
                        sceneGraph: normalizedSceneGraph,
                        assetsList,
                    });
                    void loadVersions(nextSceneId);
                    if (source === "manual") {
                        appendActivity("Version saved", "Saved the current world and director state.", "success");
                    }
                    return payload;
                })
                .catch((error) => {
                    const message = error instanceof Error ? error.message : "Scene save failed";
                    setSaveState("error");
                    setSaveError(message);
                    setSaveMessage("Autosave failed.");
                    return null;
                })
                .finally(() => {
                    saveInFlightRef.current = null;
                });

            saveInFlightRef.current = request;
            return request;
        },
        [activeScene, appendActivity, assetsList, clarityMode, loadVersions, sceneGraph],
    );

    const restoreVersion = useCallback(
        async (versionId: string) => {
            if (!activeScene) return;

            markProgrammaticSceneChange();
            setSaveState("saving");
            setSaveError("");
            setSaveMessage("Restoring version...");

            try {
                const response = await fetch(`${MVP_API_BASE_URL}/scene/${activeScene}/versions/${versionId}`, {
                    cache: "no-store",
                });
                if (!response.ok) {
                    throw new Error(`Version restore failed (${response.status})`);
                }

                const payload = await response.json();
                const restoredGraph = normalizeSceneGraph(payload.scene_graph ?? createEmptyWorkspaceSceneGraph());
                setSceneGraph(restoredGraph);
                setCurrentInputLabel(
                    typeof restoredGraph.environment?.sourceLabel === "string" ? restoredGraph.environment.sourceLabel : null,
                );
                setSaveState("recovered");
                setSaveMessage(`Restored version from ${formatTimestamp(payload.saved_at) || "history"}`);
                setLastSavedAt(payload.saved_at ?? null);
                setLastOutputSceneGraph(restoredGraph);
                setLastOutputInputLabel(
                    typeof restoredGraph.environment?.sourceLabel === "string" ? restoredGraph.environment.sourceLabel : null,
                );
                setLastOutputLabel("Restored version");
                lastSavedFingerprintRef.current = "";
                appendActivity("Version restored", "Loaded a saved world state back into the workspace.", "info");
            } catch (error) {
                const message = error instanceof Error ? error.message : "Version restore failed";
                setSaveState("error");
                setSaveError(message);
                setSaveMessage("Version restore failed.");
            }
        },
        [activeScene, appendActivity, markProgrammaticSceneChange],
    );

    useEffect(() => {
        hasHydratedRef.current = true;
        try {
            const rawDraft = window.localStorage.getItem(LOCAL_DRAFT_KEY);
            if (!rawDraft) return;
            const draft = JSON.parse(rawDraft) as StoredDraft;
            if (!draft || !draft.sceneGraph) return;

            const restoredGraph = normalizeSceneGraph(draft.sceneGraph);
            const restoredAssetsList = Array.isArray(draft.assetsList) ? normalizeAssetEntries(draft.assetsList) : [];
            const restoredSceneId = typeof draft.activeScene === "string" ? draft.activeScene : null;

            if (!hasSceneContent(restoredGraph) && restoredAssetsList.length === 0) return;

            const nextDraft = {
                activeScene: restoredSceneId,
                sceneGraph: restoredGraph,
                assetsList: restoredAssetsList,
                updatedAt: draft.updatedAt,
            };

            window.localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify(nextDraft));
            setStoredDraft(nextDraft);

            if (!clarityMode) {
                setActiveScene(restoredSceneId);
                setSceneGraph(restoredGraph);
                setAssetsList(restoredAssetsList);
                setCurrentInputLabel(
                    typeof restoredGraph.environment?.sourceLabel === "string" ? restoredGraph.environment.sourceLabel : null,
                );
                setSaveState("recovered");
                setSaveMessage(
                    draft.updatedAt
                        ? `Recovered local draft from ${formatTimestamp(draft.updatedAt)}`
                        : "Recovered local draft.",
                );
                if (restoredSceneId) {
                    void loadVersions(restoredSceneId);
                }
            }
        } catch {
            window.localStorage.removeItem(LOCAL_DRAFT_KEY);
        }
    }, [clarityMode, loadVersions]);

    useEffect(() => {
        try {
            const rawHudState = window.localStorage.getItem(hudStorageKey(routeVariant));
            if (!rawHudState) {
                setHudState(createDefaultHudState(routeVariant));
                return;
            }
            setHudState(normalizeHudState(routeVariant, JSON.parse(rawHudState)));
        } catch {
            setHudState(createDefaultHudState(routeVariant));
        } finally {
            hudHydratedRef.current = true;
        }
    }, [routeVariant]);

    useEffect(() => {
        if (!hudHydratedRef.current) {
            return;
        }
        try {
            window.localStorage.setItem(hudStorageKey(routeVariant), JSON.stringify(hudState));
        } catch {
            // Ignore local storage failures so the workspace stays usable.
        }
    }, [hudState, routeVariant]);

    useEffect(() => {
        if (!activeScene) {
            setVersions([]);
            return;
        }
        void loadVersions(activeScene);
    }, [activeScene, loadVersions]);

    useEffect(() => {
        if (!hasHydratedRef.current || entryMode !== "workspace") return;
        window.localStorage.setItem(
            LOCAL_DRAFT_KEY,
            JSON.stringify({
                activeScene,
                sceneGraph: normalizeSceneGraph(sceneGraph),
                assetsList: normalizeAssetEntries(assetsList),
                updatedAt: new Date().toISOString(),
            }),
        );
    }, [activeScene, assetsList, entryMode, sceneGraph]);

    useEffect(() => {
        if (!hasHydratedRef.current || entryMode !== "workspace") return;
        if (!hasSceneContent(sceneGraph)) return;
        if (sceneFingerprint === lastSavedFingerprintRef.current) return;
        if (saveInFlightRef.current) return;

        const timer = window.setTimeout(() => {
            void saveScene("autosave");
        }, AUTOSAVE_DEBOUNCE_MS);

        return () => window.clearTimeout(timer);
    }, [entryMode, saveScene, sceneFingerprint, sceneGraph]);

    useEffect(() => {
        trackMvpEvent("mvp_landed", {
            flow: flowName,
            entry_mode: clarityMode ? "launchpad" : "workspace",
        });
    }, [clarityMode, flowName]);

    useEffect(() => {
        const handlePageHide = () => {
            if (sessionAnalyticsRef.current.firstSuccess) return;
            trackMvpEvent("mvp_abandonment", {
                flow: flowName,
                entry_mode: entryMode,
                had_content: hasSceneContent(sceneGraph),
            });
        };

        window.addEventListener("pagehide", handlePageHide);
        return () => {
            window.removeEventListener("pagehide", handlePageHide);
        };
    }, [entryMode, flowName, sceneGraph]);

    const handleInputReady = useCallback(
        (inputLabel: string) => {
            setCurrentInputLabel(inputLabel);
            appendActivity("Reference still ready", `${inputLabel} is ready to build a persistent world.`, "info");
        },
        [appendActivity],
    );

    const handleGenerationStart = useCallback(
        (event: GenerationTelemetry) => {
            setStepStatus({
                busy: true,
                label: event.label,
                detail: event.detail,
            });
            appendActivity(event.label, event.detail ?? "Generation started.", "info");

            if (!sessionAnalyticsRef.current.firstGenerate) {
                sessionAnalyticsRef.current.firstGenerate = true;
                trackMvpEvent("mvp_first_generate", {
                    flow: flowName,
                    kind: event.kind,
                    input_label: event.inputLabel ?? currentInputLabel ?? "",
                });
            }
        },
        [appendActivity, currentInputLabel, flowName],
    );

    const handleGenerationSuccess = useCallback(
        (event: GenerationTelemetry) => {
            const nextSceneGraph = normalizeSceneGraph(event.sceneGraph ?? sceneGraph);
            const detail = event.detail ?? "The current output is ready.";
            setStepStatus({
                busy: false,
                label: event.label,
                detail,
            });
            setLastOutputSceneGraph(nextSceneGraph);
            setLastOutputLabel(event.label);
            setLastOutputInputLabel(event.inputLabel ?? currentInputLabel ?? null);
            appendActivity(event.label, detail, "success");

            if (!sessionAnalyticsRef.current.firstSuccess) {
                sessionAnalyticsRef.current.firstSuccess = true;
                trackMvpEvent("mvp_first_success", {
                    flow: flowName,
                    kind: event.kind,
                    input_label: event.inputLabel ?? currentInputLabel ?? "",
                });
            }
        },
        [appendActivity, currentInputLabel, flowName, sceneGraph],
    );

    const handleGenerationError = useCallback(
        (event: Pick<GenerationTelemetry, "label" | "detail">) => {
            setStepStatus({
                busy: false,
                label: event.label,
                detail: event.detail,
            });
            appendActivity(event.label, event.detail ?? "Generation failed.", "warning");
        },
        [appendActivity],
    );

    useEffect(() => {
        if (!stepStatus || stepStatus.busy) return;
        const timer = window.setTimeout(() => setStepStatus(null), 4000);
        return () => window.clearTimeout(timer);
    }, [stepStatus]);

    const changeSummary = useMemo(
        () => buildChangeSummary(normalizeSceneGraph(sceneGraph), lastOutputSceneGraph, currentInputLabel, lastOutputInputLabel),
        [currentInputLabel, lastOutputInputLabel, lastOutputSceneGraph, sceneGraph],
    );

    useEffect(() => {
        if (!hasHydratedRef.current) {
            previousSceneFingerprintRef.current = sceneFingerprint;
            return;
        }
        if (programmaticSceneChangeRef.current) {
            previousSceneFingerprintRef.current = sceneFingerprint;
            return;
        }
        if (!changeSummary) {
            previousSceneFingerprintRef.current = sceneFingerprint;
            return;
        }
        if (sceneFingerprint === previousSceneFingerprintRef.current) return;

        previousSceneFingerprintRef.current = sceneFingerprint;
        registerFirstEdit(changeSummary.sceneDirection.length > 0 ? "scene direction" : "world state");
    }, [changeSummary, registerFirstEdit, sceneFingerprint]);

    const handleExport = useCallback(() => {
        trackMvpEvent("mvp_export", {
            flow: flowName,
            active_scene: activeScene ?? "",
            last_output_label: lastOutputLabel,
        });
        appendActivity("Scene package exported", "Exported the current world and director package.", "success");
    }, [activeScene, appendActivity, flowName, lastOutputLabel]);

    const toggleLeftRail = useCallback(() => {
        setHudState((previous) => ({
            ...previous,
            leftRailCollapsed: !previous.leftRailCollapsed,
        }));
    }, []);

    const toggleRightRail = useCallback(() => {
        setHudState((previous) => ({
            ...previous,
            rightRailCollapsed: !previous.rightRailCollapsed,
        }));
    }, []);

    const toggleDirectorHud = useCallback(() => {
        setHudState((previous) => ({
            ...previous,
            directorHudCompact: !previous.directorHudCompact,
        }));
    }, []);

    if (clarityMode && entryMode === "launchpad") {
        return (
            <MVPClarityLaunchpad
                draftUpdatedAt={storedDraft?.updatedAt ?? null}
                hasDraft={Boolean(storedDraft)}
                onOpenDemoWorld={openDemoWorld}
                onResumeDraft={resumeStoredDraft}
                onStartBlank={startBlankWorkspace}
            />
        );
    }

    return (
        <div className="flex h-screen w-screen flex-col overflow-hidden bg-neutral-900 font-sans text-white">
            {clarityMode ? (
                <div className="border-b border-neutral-800 bg-neutral-950/95 px-5 py-4 shadow-2xl">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="max-w-3xl">
                            <p className="text-[10px] uppercase tracking-[0.24em] text-cyan-200/65">Persistent AI-generated worlds</p>
                            <h1 className="mt-2 text-xl font-semibold tracking-tight text-white">Create world, direct scene, export result.</h1>
                            <p className="mt-2 text-sm text-neutral-400">
                                Keep the world state stable, then change only the scene direction for each new output.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={openDemoWorld}
                                className="rounded-full bg-white px-4 py-2 text-xs font-medium text-black transition-colors hover:bg-neutral-200"
                            >
                                Open demo world
                            </button>
                            <button
                                type="button"
                                onClick={() => setEntryMode("launchpad")}
                                className="rounded-full border border-neutral-700 bg-neutral-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:border-neutral-500"
                            >
                                Back to preview intro
                            </button>
                        </div>
                    </div>
                    <div className="mt-4 grid gap-2 text-xs text-neutral-300 md:grid-cols-3">
                        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 px-3 py-3">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">1. Create world</p>
                            <p className="mt-1">Upload one still or use the demo to load persistent world state.</p>
                        </div>
                        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 px-3 py-3">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">2. Direct scene</p>
                            <p className="mt-1">Change only the shot note or placed objects for this scene.</p>
                        </div>
                        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 px-3 py-3">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">3. Export result</p>
                            <p className="mt-1">Save versions, review what changed, and export a package.</p>
                        </div>
                    </div>
                </div>
            ) : null}

            <div className="flex min-h-0 flex-1 overflow-hidden">
                <div
                    className={`z-10 flex h-full flex-col border-r border-neutral-800 bg-neutral-950 shadow-2xl transition-[width] duration-200 ${
                        hudState.leftRailCollapsed ? HUD_RAIL_COLLAPSED_WIDTH_CLASS : HUD_RAIL_EXPANDED_WIDTH_CLASS
                    }`}
                >
                    {hudState.leftRailCollapsed ? (
                        <button
                            type="button"
                            onClick={toggleLeftRail}
                            className="flex h-full w-full flex-col items-center justify-center gap-4 px-2 text-center text-white transition-colors hover:bg-neutral-900"
                            aria-label="Show left HUD"
                        >
                            <span className="text-[10px] uppercase tracking-[0.3em] text-cyan-200/65 [writing-mode:vertical-rl] rotate-180">Capture HUD</span>
                            <span className="rounded-full border border-neutral-800 bg-neutral-900 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-neutral-200">Expand</span>
                        </button>
                    ) : (
                        <>
                            <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-3">
                                <div>
                                    <p className="text-[10px] uppercase tracking-[0.24em] text-cyan-200/65">Workspace HUD</p>
                                    <p className="mt-1 text-sm text-white">Capture and build</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={toggleLeftRail}
                                    className="rounded-full border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-[11px] text-white transition-colors hover:border-neutral-700 hover:text-neutral-100"
                                >
                                    Hide
                                </button>
                            </div>
                            <div className="min-h-0 flex-1 overflow-hidden">
                                <LeftPanel
                                    clarityMode={clarityMode}
                                    setActiveScene={setActiveScene}
                                    setSceneGraph={setSceneGraph}
                                    setAssetsList={setAssetsList}
                                    onProgrammaticSceneChange={markProgrammaticSceneChange}
                                    onInputReady={handleInputReady}
                                    onGenerationStart={handleGenerationStart}
                                    onGenerationSuccess={handleGenerationSuccess}
                                    onGenerationError={handleGenerationError}
                                />
                            </div>
                        </>
                    )}
                </div>

                <div className="relative z-0 flex-1">
                    <ViewerPanel
                        clarityMode={clarityMode}
                        routeVariant={routeVariant}
                        leftHudCollapsed={hudState.leftRailCollapsed}
                        rightHudCollapsed={hudState.rightRailCollapsed}
                        directorHudCompact={hudState.directorHudCompact}
                        onToggleLeftHud={toggleLeftRail}
                        onToggleRightHud={toggleRightRail}
                        onToggleDirectorHud={toggleDirectorHud}
                        processingStatus={stepStatus}
                        sceneGraph={sceneGraph}
                        setSceneGraph={setSceneGraph}
                    />
                </div>

                <div
                    className={`z-10 flex h-full flex-col border-l border-neutral-800 bg-neutral-950 shadow-2xl transition-[width] duration-200 ${
                        hudState.rightRailCollapsed ? HUD_RAIL_COLLAPSED_WIDTH_CLASS : HUD_RAIL_EXPANDED_WIDTH_CLASS
                    }`}
                >
                    {hudState.rightRailCollapsed ? (
                        <button
                            type="button"
                            onClick={toggleRightRail}
                            className="flex h-full w-full flex-col items-center justify-center gap-4 px-2 text-center text-white transition-colors hover:bg-neutral-900"
                            aria-label="Show right HUD"
                        >
                            <span className="text-[10px] uppercase tracking-[0.3em] text-cyan-200/65 [writing-mode:vertical-rl]">Review HUD</span>
                            <span className="rounded-full border border-neutral-800 bg-neutral-900 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-neutral-200">Expand</span>
                        </button>
                    ) : (
                        <>
                            <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-3">
                                <div>
                                    <p className="text-[10px] uppercase tracking-[0.24em] text-cyan-200/65">Review HUD</p>
                                    <p className="mt-1 text-sm text-white">Handoff and export</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={toggleRightRail}
                                    className="rounded-full border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-[11px] text-white transition-colors hover:border-neutral-700 hover:text-neutral-100"
                                >
                                    Hide
                                </button>
                            </div>
                            <div className="min-h-0 flex-1 overflow-hidden">
                                <RightPanel
                                    clarityMode={clarityMode}
                                    activityLog={activityLog}
                                    changeSummary={changeSummary}
                                    lastOutputLabel={lastOutputLabel}
                                    sceneGraph={sceneGraph}
                                    setSceneGraph={setSceneGraph}
                                    assetsList={assetsList}
                                    activeScene={activeScene}
                                    saveState={saveState}
                                    saveMessage={saveMessage}
                                    saveError={saveError}
                                    lastSavedAt={lastSavedAt}
                                    versions={versions}
                                    onManualSave={() => saveScene("manual")}
                                    onRestoreVersion={restoreVersion}
                                    onExport={handleExport}
                                />
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
