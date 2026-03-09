"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    AlertTriangle,
    ArrowLeft,
    ArrowRight,
    Box,
    CheckCircle2,
    Clock3,
    Cpu,
    ImageIcon,
    Loader2,
    Sparkles,
    ShieldCheck,
    Upload,
} from "lucide-react";
import { extractApiError, MVP_API_BASE_URL, toProxyUrl } from "@/lib/mvp-api";
import {
    BackendMode,
    CaptureSessionResponse,
    GeneratedEnvironmentMetadata,
    normalizeSetupStatus,
    ProviderCatalogEntry,
    ProviderCatalogResponse,
    SetupStatusResponse,
    UploadResponse,
} from "@/lib/mvp-product";

const POLL_INTERVAL_MS = 1200;
const POLL_TIMEOUT_MS = 240_000;

type JobStatus = "processing" | "completed" | "failed";
type IntakeMode = "import" | "generate";
type JobType = "environment" | "asset" | "reconstruction" | "generated_image";

interface GenerateResponse {
    job_id?: string;
    scene_id?: string;
    asset_id?: string;
    status: JobStatus;
    urls?: Record<string, string>;
}

interface JobStatusResponse {
    id: string;
    type: JobType;
    status: JobStatus;
    error?: string | null;
    image_id?: string;
    created_at?: string;
    updated_at?: string;
    result?: {
        scene_id?: string;
        asset_id?: string;
        files?: Record<string, string>;
        urls?: Record<string, string>;
        images?: UploadResponse[];
    } | null;
}

interface LeftPanelProps {
    clarityMode?: boolean;
    previewWorkspaceNavigation?: {
        title: string;
        note: string;
        onBackToStart: () => void;
    } | null;
    setActiveScene: (sceneId: string | null) => void;
    setSceneGraph: React.Dispatch<React.SetStateAction<any>>;
    setAssetsList: React.Dispatch<React.SetStateAction<any[]>>;
    onProgrammaticSceneChange?: () => void;
    onGenerationStart?: (event: {
        kind: "preview" | "reconstruction" | "asset" | "generated_image";
        label: string;
        detail?: string;
        inputLabel?: string;
    }) => void;
    onGenerationSuccess?: (event: {
        kind: "preview" | "reconstruction" | "asset" | "generated_image";
        label: string;
        detail?: string;
        inputLabel?: string;
        sceneId?: string;
        assetId?: string;
        sceneGraph?: any;
    }) => void;
    onGenerationError?: (event: {
        kind: "preview" | "reconstruction" | "asset" | "generated_image";
        label: string;
        detail: string;
    }) => void;
}

interface JobRecord {
    id: string;
    type: JobType;
    imageId: string;
    label: string;
    status: JobStatus;
    createdAt: string;
    updatedAt: string;
    error?: string;
}

interface UploadItem extends UploadResponse {
    sourceName: string;
    previewUrl: string;
    uploadedAt: string;
}

const ACCEPTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const ACCEPTED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const defaultEnvironmentUrls = (sceneId: string) => ({
    viewer: `/storage/scenes/${sceneId}/environment`,
    splats: `/storage/scenes/${sceneId}/environment/splats.ply`,
    cameras: `/storage/scenes/${sceneId}/environment/cameras.json`,
    metadata: `/storage/scenes/${sceneId}/environment/metadata.json`,
});

const defaultAssetUrls = (assetId: string) => ({
    mesh: `/storage/assets/${assetId}/mesh.glb`,
    texture: `/storage/assets/${assetId}/texture.png`,
    preview: `/storage/assets/${assetId}/preview.png`,
});

async function pollJob(jobId: string): Promise<JobStatusResponse> {
    const start = Date.now();

    while (Date.now() - start < POLL_TIMEOUT_MS) {
        const response = await fetch(`${MVP_API_BASE_URL}/jobs/${jobId}`);
        if (!response.ok) {
            throw new Error(await extractApiError(response, `Job polling failed (${response.status})`));
        }

        const payload = (await response.json()) as JobStatusResponse;
        if (payload.status === "completed" || payload.status === "failed") {
            return payload;
        }

        await sleep(POLL_INTERVAL_MS);
    }

    throw new Error("Timed out waiting for generation job to finish.");
}

async function fetchEnvironmentMetadata(metadataUrl: string) {
    try {
        const response = await fetch(metadataUrl, { cache: "no-store" });
        if (!response.ok) return null;
        return (await response.json()) as GeneratedEnvironmentMetadata;
    } catch {
        return null;
    }
}

const formatBandLabel = (value?: string | null) => {
    if (!value) return "";
    return value.replaceAll("_", " ");
};

const formatScore = (value?: number | null, digits = 1) => {
    if (typeof value !== "number" || Number.isNaN(value)) return "n/a";
    return value.toFixed(digits);
};

const truncateLabel = (value?: string | null, max = 52) => {
    if (!value) return "";
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

const getFileExtension = (value: string) => {
    const match = /\.[^.]+$/.exec(value.toLowerCase());
    return match?.[0] ?? "";
};

const isSupportedImageFile = (file: File) => {
    if (file.type && ACCEPTED_IMAGE_TYPES.has(file.type.toLowerCase())) {
        return true;
    }
    return ACCEPTED_IMAGE_EXTENSIONS.has(getFileExtension(file.name));
};

export default function LeftPanel({
    clarityMode = false,
    previewWorkspaceNavigation = null,
    setActiveScene,
    setSceneGraph,
    setAssetsList,
    onProgrammaticSceneChange,
    onGenerationStart,
    onGenerationSuccess,
    onGenerationError,
}: LeftPanelProps) {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const uploadPreviewUrlsRef = useRef<string[]>([]);
    const previewGenerationLockRef = useRef<string | null>(null);
    const assetGenerationLockRef = useRef<string | null>(null);
    const generatedImageLockRef = useRef<string | null>(null);

    const [intakeMode, setIntakeMode] = useState<IntakeMode>("import");
    const [isUploading, setIsUploading] = useState(false);
    const [isGeneratingImage, setIsGeneratingImage] = useState(false);
    const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
    const [isGeneratingAsset, setIsGeneratingAsset] = useState(false);
    const [isUpdatingCapture, setIsUpdatingCapture] = useState(false);
    const [isStartingReconstruction, setIsStartingReconstruction] = useState(false);
    const [uploads, setUploads] = useState<UploadItem[]>([]);
    const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null);
    const [statusText, setStatusText] = useState("");
    const [errorText, setErrorText] = useState("");
    const [backendMode, setBackendMode] = useState<BackendMode>("checking");
    const [backendMessage, setBackendMessage] = useState("Checking backend capabilities...");
    const [setupStatus, setSetupStatus] = useState<SetupStatusResponse | null>(null);
    const [providerCatalog, setProviderCatalog] = useState<ProviderCatalogResponse | null>(null);
    const [providersLoading, setProvidersLoading] = useState(false);
    const [selectedProviderId, setSelectedProviderId] = useState("");
    const [selectedModelId, setSelectedModelId] = useState("");
    const [generatePrompt, setGeneratePrompt] = useState("");
    const [generateNegativePrompt, setGenerateNegativePrompt] = useState("");
    const [generateAspectRatio, setGenerateAspectRatio] = useState("16:9");
    const [generateCount, setGenerateCount] = useState(1);
    const [selectedReferenceIds, setSelectedReferenceIds] = useState<string[]>([]);
    const [jobs, setJobs] = useState<JobRecord[]>([]);
    const [captureSession, setCaptureSession] = useState<CaptureSessionResponse | null>(null);

    useEffect(() => {
        return () => {
            uploadPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
        };
    }, []);

    useEffect(() => {
        let cancelled = false;

        const loadProviders = async () => {
            setProvidersLoading(true);
            try {
                const response = await fetch(`${MVP_API_BASE_URL}/providers`, { cache: "no-store" });
                if (!response.ok) {
                    throw new Error(await extractApiError(response, `Provider catalog failed (${response.status})`));
                }

                const payload = (await response.json()) as ProviderCatalogResponse;
                if (!cancelled) {
                    setProviderCatalog(payload);
                }
            } catch {
                if (!cancelled) {
                    setProviderCatalog(null);
                }
            } finally {
                if (!cancelled) {
                    setProvidersLoading(false);
                }
            }
        };

        const loadSetupStatus = async () => {
            setBackendMode("checking");
            setBackendMessage("Checking backend capabilities...");
            try {
                const response = await fetch(`${MVP_API_BASE_URL}/setup/status`, { cache: "no-store" });
                if (!response.ok) {
                    throw new Error(await extractApiError(response, `Backend setup check failed (${response.status})`));
                }

                const payload = normalizeSetupStatus(await response.json());
                if (cancelled) return;

                const previewAvailable = Boolean(payload.capabilities?.preview?.available);
                const reconstructionLaneAvailable = Boolean(payload.capabilities?.reconstruction?.available);
                const assetAvailable = Boolean(payload.capabilities?.asset?.available);
                const directoriesReady = Object.values(payload.directories ?? {}).every(Boolean);
                const mode: BackendMode =
                    directoriesReady && (previewAvailable || reconstructionLaneAvailable || assetAvailable) ? "ready" : "degraded";

                setSetupStatus(payload);
                setBackendMode(mode);
                setBackendMessage(
                    payload.backend?.truth ??
                        (mode === "ready"
                            ? "Preview and asset lanes are available."
                            : "The backend responded, but one or more generation lanes are unavailable."),
                );
                void loadProviders();
            } catch (error) {
                if (cancelled) return;
                setSetupStatus(null);
                setProviderCatalog(null);
                setProvidersLoading(false);
                setBackendMode("offline");
                setBackendMessage(error instanceof Error ? error.message : "Gauset backend is unavailable.");
            }
        };

        void loadSetupStatus();
        return () => {
            cancelled = true;
        };
    }, []);

    const selectedUpload = useMemo(
        () => uploads.find((upload) => upload.image_id === selectedUploadId) ?? uploads[0] ?? null,
        [selectedUploadId, uploads],
    );
    const selectedUploadAnalysis = selectedUpload?.analysis;
    const captureQualitySummary = captureSession?.quality_summary;
    const captureBlockers = Array.isArray(captureSession?.reconstruction_blockers)
        ? captureSession.reconstruction_blockers
        : Array.isArray(captureQualitySummary?.reconstruction_gate?.blockers)
          ? captureQualitySummary.reconstruction_gate.blockers
          : [];
    const captureUniqueFrameCount =
        typeof captureQualitySummary?.unique_frame_count === "number"
            ? captureQualitySummary.unique_frame_count
            : Math.max((captureSession?.frame_count ?? 0) - (captureQualitySummary?.duplicate_frames ?? 0), 0);
    const captureDuplicateRatioPercent =
        typeof captureQualitySummary?.duplicate_ratio === "number"
            ? Math.round(captureQualitySummary.duplicate_ratio * 100)
            : null;
    const captureSetBlocked = Boolean(
        captureSession &&
            !captureSession.ready_for_reconstruction &&
            captureSession.frame_count >= captureSession.minimum_images &&
            captureBlockers.length > 0,
    );
    const captureNextActions = Array.isArray(captureQualitySummary?.recommended_next_actions)
        ? captureQualitySummary.recommended_next_actions
        : [];
    const imageProviders = useMemo(
        () => (providerCatalog?.providers ?? []).filter((provider) => provider.media_kind === "image"),
        [providerCatalog],
    );
    const availableImageProviders = useMemo(
        () => imageProviders.filter((provider) => provider.available),
        [imageProviders],
    );
    const selectedProvider = useMemo(
        () =>
            imageProviders.find((provider) => provider.id === selectedProviderId) ??
            availableImageProviders[0] ??
            imageProviders[0] ??
            null,
        [availableImageProviders, imageProviders, selectedProviderId],
    );
    const selectedProviderModel = useMemo(
        () =>
            selectedProvider?.models.find((model) => model.id === (selectedModelId || selectedProvider?.default_model || "")) ??
            selectedProvider?.models[0] ??
            null,
        [selectedModelId, selectedProvider],
    );
    const providerAspectRatios = useMemo(
        () =>
            selectedProvider?.supported_aspect_ratios && selectedProvider.supported_aspect_ratios.length > 0
                ? selectedProvider.supported_aspect_ratios
                : ["1:1", "4:3", "3:4", "16:9", "9:16"],
        [selectedProvider],
    );
    const selectedModelSupportsReferences =
        selectedProviderModel?.supports_references ?? selectedProvider?.supports_references ?? false;
    const selectedModelSupportsNegativePrompt = selectedProviderModel?.supports_negative_prompt ?? true;
    const selectedModelSupportsMultiOutput =
        selectedProviderModel?.supports_multi_output ?? selectedProvider?.supports_multi_output ?? false;
    const selectedProviderMaxOutputs = Math.max(1, selectedProvider?.max_outputs ?? 1);
    const selectedProviderMaxReferences = Math.max(0, selectedProvider?.max_reference_images ?? 0);
    const providerGenerationEnabled = Boolean(providerCatalog?.enabled ?? setupStatus?.provider_generation?.enabled);

    useEffect(() => {
        if (!selectedProvider) {
            if (selectedProviderId) {
                setSelectedProviderId("");
            }
            return;
        }
        if (selectedProvider.id !== selectedProviderId) {
            setSelectedProviderId(selectedProvider.id);
        }
    }, [selectedProvider, selectedProviderId]);

    useEffect(() => {
        if (!selectedProviderModel) {
            if (selectedModelId) {
                setSelectedModelId("");
            }
            return;
        }
        if (selectedProviderModel.id !== selectedModelId) {
            setSelectedModelId(selectedProviderModel.id);
        }
    }, [selectedModelId, selectedProviderModel]);

    useEffect(() => {
        if (!selectedModelSupportsMultiOutput && generateCount !== 1) {
            setGenerateCount(1);
        }
        if (!selectedModelSupportsReferences && selectedReferenceIds.length > 0) {
            setSelectedReferenceIds([]);
        }
        if (providerAspectRatios.length > 0 && !providerAspectRatios.includes(generateAspectRatio)) {
            setGenerateAspectRatio(providerAspectRatios[0]);
        }
    }, [
        generateAspectRatio,
        generateCount,
        providerAspectRatios,
        selectedModelSupportsMultiOutput,
        selectedModelSupportsReferences,
        selectedReferenceIds.length,
    ]);

    const loadEnvironmentIntoScene = async (
        sceneId: string,
        urlCandidates?: Record<string, string>,
        fileCandidates?: Record<string, string>,
        fallbackLane: "preview" | "reconstruction" = "preview",
    ) => {
        const fallbackUrls = defaultEnvironmentUrls(sceneId);
        const urls = {
            viewer: toProxyUrl(urlCandidates?.viewer ?? fallbackUrls.viewer),
            splats: toProxyUrl(urlCandidates?.splats ?? fallbackUrls.splats),
            cameras: toProxyUrl(urlCandidates?.cameras ?? fallbackUrls.cameras),
            metadata: toProxyUrl(urlCandidates?.metadata ?? fallbackUrls.metadata),
        };
        const metadata = await fetchEnvironmentMetadata(urls.metadata);
        let nextSceneGraph: any = null;
        onProgrammaticSceneChange?.();
        setSceneGraph((prev: any) => {
            nextSceneGraph = {
                ...prev,
                environment: {
                    id: sceneId,
                    lane: metadata?.lane ?? fallbackLane,
                    urls,
                    files: fileCandidates ?? null,
                    metadata,
                },
            };
            return nextSceneGraph;
        });
        setActiveScene(sceneId);
        return {
            metadata,
            sceneGraph: nextSceneGraph,
        };
    };

    const previewCapability = setupStatus?.capabilities?.preview;
    const reconstructionCapability = setupStatus?.capabilities?.reconstruction;
    const assetCapability = setupStatus?.capabilities?.asset;
    const setupTruth = setupStatus?.backend?.truth ?? "";
    const reconstructionBackendName = setupStatus?.reconstruction_backend?.name ?? "missing";
    const benchmarkStatusLabel = formatBandLabel(setupStatus?.benchmark_status?.status) || "not benchmarked";
    const releaseGateFailureCount = Object.values(setupStatus?.release_gates ?? {}).filter((value) => value === false).length;
    const minimumCaptureImages = captureSession?.minimum_images ?? setupStatus?.capture?.minimum_images ?? 8;
    const recommendedCaptureImages =
        captureSession?.recommended_images ?? setupStatus?.capture?.recommended_images ?? minimumCaptureImages;
    const reconstructionAvailable = Boolean(reconstructionCapability?.available);

    const triggerFilePicker = () => {
        if (backendMode === "offline") return;
        fileInputRef.current?.click();
    };

    const upsertJob = (job: JobRecord) => {
        setJobs((prev) => {
            const next = [...prev];
            const index = next.findIndex((item) => item.id === job.id);
            if (index >= 0) {
                next[index] = { ...next[index], ...job };
            } else {
                next.unshift(job);
            }
            return next
                .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
                .slice(0, 8);
        });
    };

    const findActiveJob = (type: JobType, imageId: string) =>
        jobs.find((job) => job.type === type && job.imageId === imageId && job.status === "processing");

    const formatJobTime = (value: string) => {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "just now";
        return date.toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
        });
    };

    const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = "";
        if (files.length === 0) return;

        setErrorText("");
        setStatusText("");
        setIsUploading(true);

        const uploadedItems: UploadItem[] = [];
        const failures: string[] = [];

        for (const file of files) {
            if (!isSupportedImageFile(file)) {
                failures.push(`${file.name}: unsupported file type. Use PNG, JPG, or WEBP stills.`);
                continue;
            }

            const localPreviewUrl = URL.createObjectURL(file);
            uploadPreviewUrlsRef.current.push(localPreviewUrl);

            try {
                const formData = new FormData();
                formData.append("file", file);

                const response = await fetch(`${MVP_API_BASE_URL}/upload`, {
                    method: "POST",
                    body: formData,
                });

                if (!response.ok) {
                    throw new Error(await extractApiError(response, `Upload failed (${response.status})`));
                }

                const payload = (await response.json()) as UploadResponse;
                uploadedItems.push({
                    ...payload,
                    sourceName: file.name,
                    previewUrl: localPreviewUrl,
                    uploadedAt: new Date().toISOString(),
                });
            } catch (error) {
                uploadPreviewUrlsRef.current = uploadPreviewUrlsRef.current.filter((value) => value !== localPreviewUrl);
                URL.revokeObjectURL(localPreviewUrl);
                failures.push(error instanceof Error ? `${file.name}: ${error.message}` : `${file.name}: upload failed`);
            }
        }

        if (uploadedItems.length > 0) {
            setUploads((prev) => [...uploadedItems.reverse(), ...prev]);
            setSelectedUploadId(uploadedItems[uploadedItems.length - 1].image_id);
            setStatusText(
                uploadedItems.length === 1
                    ? `Uploaded ${uploadedItems[0].sourceName}`
                    : `Uploaded ${uploadedItems.length} photos into the capture tray.`,
            );
        }

        if (failures.length > 0) {
            setErrorText(failures.join("\n"));
        }

        setIsUploading(false);
    };

    const buildGeneratedUploadItems = (generatedImages: UploadResponse[], provider?: ProviderCatalogEntry | null) =>
        generatedImages.map((image, index) => ({
            ...image,
            sourceName:
                truncateLabel(image.prompt, 42) ||
                `${provider?.label ?? image.provider ?? "Generated"} ${index + 1}`,
            previewUrl: toProxyUrl(image.url),
            uploadedAt: new Date().toISOString(),
        })) as UploadItem[];

    const appendGeneratedUploads = (generatedImages: UploadResponse[], provider?: ProviderCatalogEntry | null) => {
        const generatedItems = buildGeneratedUploadItems(generatedImages, provider);

        if (generatedItems.length === 0) {
            return generatedItems;
        }

        setUploads((prev) => [...generatedItems, ...prev]);
        setSelectedUploadId(generatedItems[0].image_id);
        return generatedItems;
    };

    const toggleReferenceSelection = (imageId: string) => {
        setSelectedReferenceIds((prev) => {
            if (prev.includes(imageId)) {
                return prev.filter((value) => value !== imageId);
            }
            if (selectedProviderMaxReferences > 0 && prev.length >= selectedProviderMaxReferences) {
                return [...prev.slice(1), imageId];
            }
            return [...prev, imageId];
        });
    };

    const runPreviewGeneration = async (upload: Pick<UploadItem, "image_id" | "sourceName">) => {
        if (previewGenerationLockRef.current) {
            setStatusText("World preview already running.");
            return null;
        }

        previewGenerationLockRef.current = upload.image_id;
        try {
            const existingJob = findActiveJob("environment", upload.image_id);
            if (existingJob) {
                setStatusText(`Preview already running: ${existingJob.id}`);
                return null;
            }

            onGenerationStart?.({
                kind: "preview",
                label: "Building world preview",
                detail: `Turning ${upload.sourceName} into a persistent world preview.`,
                inputLabel: upload.sourceName,
            });
            setStatusText("Analyzing selected still and building the world preview...");

            const response = await fetch(`${MVP_API_BASE_URL}/generate/environment`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ image_id: upload.image_id }),
            });
            if (!response.ok) {
                throw new Error(await extractApiError(response, `Preview generation failed (${response.status})`));
            }

            const payload = (await response.json()) as GenerateResponse;
            const jobId = payload.job_id ?? payload.scene_id;
            if (!jobId) {
                throw new Error("Missing job id from preview generation response.");
            }

            setStatusText("World preview queued. Current output stays visible until the new preview is ready...");

            upsertJob({
                id: jobId,
                type: "environment",
                imageId: upload.image_id,
                label: upload.sourceName,
                status: "processing",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });

            const finalJob = await pollJob(jobId);
            upsertJob({
                id: jobId,
                type: "environment",
                imageId: upload.image_id,
                label: upload.sourceName,
                status: finalJob.status,
                createdAt: finalJob.created_at ?? new Date().toISOString(),
                updatedAt: finalJob.updated_at ?? new Date().toISOString(),
                error: finalJob.error ?? undefined,
            });
            if (finalJob.status === "failed") {
                throw new Error(finalJob.error || "Preview generation failed.");
            }

            const sceneId = finalJob.result?.scene_id ?? payload.scene_id ?? jobId;
            const result = await loadEnvironmentIntoScene(
                sceneId,
                finalJob.result?.urls ?? payload.urls,
                finalJob.result?.files ?? undefined,
                "preview",
            );
            onGenerationSuccess?.({
                kind: "preview",
                label: "World preview ready",
                detail: `Loaded ${sceneId} from ${upload.sourceName}.`,
                inputLabel: upload.sourceName,
                sceneId,
                sceneGraph: result.sceneGraph,
            });
            return {
                sceneId,
                metadata: result.metadata,
                sceneGraph: result.sceneGraph,
            };
        } finally {
            if (previewGenerationLockRef.current === upload.image_id) {
                previewGenerationLockRef.current = null;
            }
        }
    };

    const generateImage = async ({ autoPreview }: { autoPreview: boolean }) => {
        const prompt = generatePrompt.trim();
        if (!selectedProvider || !selectedProviderModel) {
            setErrorText("No provider is ready for image generation.");
            return;
        }
        if (!prompt) {
            setErrorText("Prompt is required for provider generation.");
            return;
        }

        const jobKey = `${selectedProvider.id}:${selectedProviderModel.id}:${prompt}`;
        if (generatedImageLockRef.current) {
            setStatusText("Image generation already running.");
            return;
        }
        const existingJob = findActiveJob("generated_image", jobKey);
        if (existingJob) {
            setStatusText(`Image generation already running: ${existingJob.id}`);
            return;
        }

        generatedImageLockRef.current = jobKey;
        setIsGeneratingImage(true);
        setErrorText("");
        onGenerationStart?.({
            kind: "generated_image",
            label: autoPreview ? "Generating source still for a new world" : "Generating source still",
            detail: `${selectedProvider.label} is generating a still from your prompt.`,
            inputLabel: truncateLabel(prompt, 72),
        });
        setStatusText(
            autoPreview
                ? `Generating a source still with ${selectedProvider.label} before building the world...`
                : `Generating a source still with ${selectedProvider.label}...`,
        );

        try {
            const response = await fetch(`${MVP_API_BASE_URL}/generate/image`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    provider: selectedProvider.id,
                    model: selectedProviderModel.id,
                    prompt,
                    negative_prompt: selectedModelSupportsNegativePrompt ? generateNegativePrompt.trim() || undefined : undefined,
                    aspect_ratio: generateAspectRatio,
                    count: selectedModelSupportsMultiOutput ? generateCount : 1,
                    reference_image_ids: selectedModelSupportsReferences ? selectedReferenceIds : [],
                }),
            });
            if (!response.ok) {
                throw new Error(await extractApiError(response, `Image generation failed (${response.status})`));
            }

            const payload = (await response.json()) as GenerateResponse;
            if (!payload.job_id) {
                throw new Error("Missing job id from image generation response.");
            }

            upsertJob({
                id: payload.job_id,
                type: "generated_image",
                imageId: jobKey,
                label: `${selectedProvider.label} · ${truncateLabel(prompt, 36)}`,
                status: "processing",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });

            const finalJob = await pollJob(payload.job_id);
            upsertJob({
                id: payload.job_id,
                type: "generated_image",
                imageId: jobKey,
                label: `${selectedProvider.label} · ${truncateLabel(prompt, 36)}`,
                status: finalJob.status,
                createdAt: finalJob.created_at ?? new Date().toISOString(),
                updatedAt: finalJob.updated_at ?? new Date().toISOString(),
                error: finalJob.error ?? undefined,
            });

            if (finalJob.status === "failed") {
                throw new Error(finalJob.error || "Image generation failed.");
            }

            const generatedImages = Array.isArray(finalJob.result?.images) ? finalJob.result.images : [];
            if (generatedImages.length === 0) {
                throw new Error("Image generation completed without any usable outputs.");
            }

            const generatedItems = appendGeneratedUploads(generatedImages, selectedProvider);
            setIntakeMode("import");

            if (autoPreview && generatedItems.length > 0) {
                setStatusText("Generated still ready. Building the persistent world now...");
                const preview = await runPreviewGeneration(generatedItems[0]);
                if (!preview) {
                    return;
                }
                setStatusText(
                    `${preview?.metadata?.truth_label ?? "Preview"} ready: ${preview?.sceneId}${
                        preview?.metadata?.rendering?.color_encoding === "sh_dc_rgb" ? " · SH colorized" : ""
                    }`,
                );
                return;
            }

            onGenerationSuccess?.({
                kind: "generated_image",
                label: "Source still ready",
                detail:
                    generatedImages.length === 1
                        ? `Generated 1 still via ${selectedProvider.label}.`
                        : `Generated ${generatedImages.length} stills via ${selectedProvider.label}.`,
                inputLabel: truncateLabel(prompt, 72),
            });
            setStatusText(
                generatedImages.length === 1
                    ? `Generated 1 image via ${selectedProvider.label}.`
                    : `Generated ${generatedImages.length} images via ${selectedProvider.label}.`,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : "Image generation failed.";
            setErrorText(message);
            onGenerationError?.({
                kind: "generated_image",
                label: "Source still failed",
                detail: message,
            });
        } finally {
            if (generatedImageLockRef.current === jobKey) {
                generatedImageLockRef.current = null;
            }
            setIsGeneratingImage(false);
        }
    };

    const generatePreview = async () => {
        if (!selectedUpload) return;
        if (previewGenerationLockRef.current) {
            setStatusText("World preview already running.");
            return;
        }

        setIsGeneratingPreview(true);
        setErrorText("");
        setStatusText("Building a persistent world from the selected still...");

        try {
            const preview = await runPreviewGeneration(selectedUpload);
            if (!preview) {
                return;
            }
            setStatusText(
                `${preview?.metadata?.truth_label ?? "Preview"} ready: ${preview?.sceneId}${
                    preview?.metadata?.rendering?.color_encoding === "sh_dc_rgb" ? " · SH colorized" : ""
                }`,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : "Preview generation failed.";
            setErrorText(message);
            onGenerationError?.({
                kind: "preview",
                label: "World preview failed",
                detail: message,
            });
        } finally {
            setIsGeneratingPreview(false);
        }
    };

    const generateAsset = async () => {
        if (!selectedUpload) return;
        if (assetGenerationLockRef.current) {
            setStatusText("3D asset extraction already running.");
            return;
        }

        const lockKey = selectedUpload.image_id;
        const existingJob = findActiveJob("asset", selectedUpload.image_id);
        if (existingJob) {
            setStatusText(`Asset already running: ${existingJob.id}`);
            return;
        }

        assetGenerationLockRef.current = lockKey;
        setIsGeneratingAsset(true);
        setErrorText("");
        onGenerationStart?.({
            kind: "asset",
            label: "Extracting 3D asset",
            detail: `Turning ${selectedUpload.sourceName} into a reusable 3D asset.`,
            inputLabel: selectedUpload.sourceName,
        });
        setStatusText("Extracting a reusable 3D asset from the selected still...");

        try {
            const response = await fetch(`${MVP_API_BASE_URL}/generate/asset`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ image_id: selectedUpload.image_id }),
            });
            if (!response.ok) {
                throw new Error(await extractApiError(response, `Asset generation failed (${response.status})`));
            }

            const payload = (await response.json()) as GenerateResponse;
            const jobId = payload.job_id ?? payload.asset_id;
            if (!jobId) {
                throw new Error("Missing job id from asset generation response.");
            }

            upsertJob({
                id: jobId,
                type: "asset",
                imageId: selectedUpload.image_id,
                label: selectedUpload.sourceName,
                status: "processing",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });

            const finalJob = await pollJob(jobId);
            upsertJob({
                id: jobId,
                type: "asset",
                imageId: selectedUpload.image_id,
                label: selectedUpload.sourceName,
                status: finalJob.status,
                createdAt: finalJob.created_at ?? new Date().toISOString(),
                updatedAt: finalJob.updated_at ?? new Date().toISOString(),
                error: finalJob.error ?? undefined,
            });
            if (finalJob.status === "failed") {
                throw new Error(finalJob.error || "Asset generation failed.");
            }

            const assetId = finalJob.result?.asset_id ?? payload.asset_id ?? jobId;
            const fallbackUrls = defaultAssetUrls(assetId);
            const urls = {
                mesh: toProxyUrl(finalJob.result?.urls?.mesh ?? payload.urls?.mesh ?? fallbackUrls.mesh),
                texture: toProxyUrl(finalJob.result?.urls?.texture ?? payload.urls?.texture ?? fallbackUrls.texture),
                preview: toProxyUrl(finalJob.result?.urls?.preview ?? payload.urls?.preview ?? fallbackUrls.preview),
            };

            const newAsset = {
                id: assetId,
                name: assetId,
                mesh: urls.mesh,
                texture: urls.texture,
                preview: urls.preview,
                instanceId: `inst_${Date.now()}`,
                position: [0, 0, 0],
                rotation: [0, 0, 0],
                scale: [1, 1, 1],
            };
            onProgrammaticSceneChange?.();
            setAssetsList((prev: any[]) => [...prev, newAsset]);
            onGenerationSuccess?.({
                kind: "asset",
                label: "3D asset ready",
                detail: `Added ${assetId} to the local asset tray.`,
                inputLabel: selectedUpload.sourceName,
                assetId,
            });
            setStatusText(`Asset ready: ${assetId}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Asset generation failed.";
            setErrorText(message);
            onGenerationError?.({
                kind: "asset",
                label: "3D asset failed",
                detail: message,
            });
        } finally {
            if (assetGenerationLockRef.current === lockKey) {
                assetGenerationLockRef.current = null;
            }
            setIsGeneratingAsset(false);
        }
    };

    const ensureCaptureSession = async () => {
        if (captureSession) return captureSession;

        const response = await fetch(`${MVP_API_BASE_URL}/capture/session`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target_images: recommendedCaptureImages }),
        });
        if (!response.ok) {
            throw new Error(await extractApiError(response, `Capture session creation failed (${response.status})`));
        }

        const payload = (await response.json()) as CaptureSessionResponse;
        setCaptureSession(payload);
        return payload;
    };

    const addSelectedToCaptureSet = async () => {
        if (!selectedUpload) return;

        setIsUpdatingCapture(true);
        setErrorText("");
        setStatusText("Adding photo to capture set...");

        try {
            const session = await ensureCaptureSession();
            if (session.frames.some((frame) => frame.image_id === selectedUpload.image_id)) {
                setStatusText("Selected photo is already in the capture set.");
                return;
            }

            const response = await fetch(`${MVP_API_BASE_URL}/capture/session/${session.session_id}/frames`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ image_ids: [selectedUpload.image_id] }),
            });
            if (!response.ok) {
                throw new Error(await extractApiError(response, `Capture session update failed (${response.status})`));
            }

            const payload = (await response.json()) as CaptureSessionResponse;
            setCaptureSession(payload);
            const leadBlocker = Array.isArray(payload.reconstruction_blockers) ? payload.reconstruction_blockers[0] : null;
            setStatusText(
                payload.ready_for_reconstruction
                    ? `Capture set ready: ${payload.frame_count} views collected${
                          payload.quality_summary?.band ? ` · ${formatBandLabel(payload.quality_summary.band)}` : ""
                      }.`
                    : payload.frame_count >= payload.minimum_images && leadBlocker
                      ? `Capture set blocked: ${leadBlocker}`
                    : `Capture set updated: ${payload.frame_count}/${payload.minimum_images} views collected${
                          payload.quality_summary?.band ? ` · ${formatBandLabel(payload.quality_summary.band)}` : ""
                      }.`,
            );
        } catch (error) {
            setErrorText(error instanceof Error ? error.message : "Capture session update failed.");
        } finally {
            setIsUpdatingCapture(false);
        }
    };

    const startReconstruction = async () => {
        if (!captureSession) return;

        setIsStartingReconstruction(true);
        setErrorText("");
        onGenerationStart?.({
            kind: "reconstruction",
            label: "Fusing capture set into a persistent world",
            detail: `Reconstructing from ${captureSession.frame_count} capture views.`,
            inputLabel: `${captureSession.frame_count} capture views`,
        });
        setStatusText("Fusing the capture set into a persistent world...");

        try {
            const response = await fetch(`${MVP_API_BASE_URL}/reconstruct/session/${captureSession.session_id}`, {
                method: "POST",
            });
            if (!response.ok) {
                throw new Error(await extractApiError(response, `Reconstruction failed to start (${response.status})`));
            }

            const payload = (await response.json()) as CaptureSessionResponse;
            setCaptureSession(payload);

            const jobId = payload.job_id ?? payload.scene_id;
            if (!jobId) {
                throw new Error("Missing reconstruction job id.");
            }

            upsertJob({
                id: jobId,
                type: "reconstruction",
                imageId: captureSession.session_id,
                label: `${payload.frame_count} capture views`,
                status: "processing",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });

            const finalJob = await pollJob(jobId);
            upsertJob({
                id: jobId,
                type: "reconstruction",
                imageId: captureSession.session_id,
                label: `${payload.frame_count} capture views`,
                status: finalJob.status,
                createdAt: finalJob.created_at ?? new Date().toISOString(),
                updatedAt: finalJob.updated_at ?? new Date().toISOString(),
                error: finalJob.error ?? undefined,
            });
            if (finalJob.status === "failed") {
                throw new Error(finalJob.error || "Reconstruction failed.");
            }

            const sceneId = finalJob.result?.scene_id ?? payload.scene_id ?? jobId;
            const result = await loadEnvironmentIntoScene(
                sceneId,
                finalJob.result?.urls ?? payload.urls,
                finalJob.result?.files ?? undefined,
                "reconstruction",
            );
            setCaptureSession((prev) =>
                prev
                    ? {
                          ...prev,
                          status: "completed",
                          updated_at: new Date().toISOString(),
                          job_id: jobId,
                          scene_id: sceneId,
                          urls: finalJob.result?.urls ?? payload.urls,
                          last_error: undefined,
                      }
                    : prev,
            );
            onGenerationSuccess?.({
                kind: "reconstruction",
                label: "Reconstruction ready",
                detail: `Loaded ${sceneId} from ${payload.frame_count} capture views.`,
                inputLabel: `${payload.frame_count} capture views`,
                sceneId,
                sceneGraph: result.sceneGraph,
            });
            setStatusText(
                `${result.metadata?.truth_label ?? "Reconstruction"} ready: ${sceneId}${
                    result.metadata?.quality?.band ? ` · ${result.metadata.quality.band.replaceAll("_", " ")}` : ""
                }`,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : "Reconstruction failed to start.";
            setErrorText(message);
            onGenerationError?.({
                kind: "reconstruction",
                label: "Reconstruction failed",
                detail: message,
            });
        } finally {
            setIsStartingReconstruction(false);
        }
    };

    const backendCardClassName =
        clarityMode
            ? backendMode === "ready"
                ? "border-emerald-400/20 bg-[linear-gradient(180deg,rgba(8,22,19,0.96),rgba(6,10,12,0.96))]"
                : backendMode === "degraded"
                  ? "border-amber-400/20 bg-[linear-gradient(180deg,rgba(25,18,9,0.96),rgba(10,8,6,0.96))]"
                  : backendMode === "offline"
                    ? "border-rose-400/20 bg-[linear-gradient(180deg,rgba(26,12,14,0.96),rgba(11,6,8,0.96))]"
                    : "border-white/10 bg-[linear-gradient(180deg,rgba(12,17,25,0.96),rgba(7,10,15,0.96))]"
            : backendMode === "ready"
              ? "border-emerald-900/40 bg-emerald-950/20"
              : backendMode === "degraded"
                ? "border-amber-900/40 bg-amber-950/20"
                : backendMode === "offline"
                  ? "border-rose-900/40 bg-rose-950/20"
                  : "border-neutral-800 bg-neutral-900/60";
    const backendBadgeClassName =
        backendMode === "ready"
            ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-100"
            : backendMode === "degraded"
              ? "border-amber-300/25 bg-amber-400/10 text-amber-100"
              : backendMode === "offline"
                ? "border-rose-300/25 bg-rose-400/10 text-rose-100"
                : "border-cyan-300/25 bg-cyan-400/12 text-cyan-50";

    const laneCards = [
        {
            key: "preview",
            title: previewCapability?.label ?? "Instant Preview",
            summary: previewCapability?.summary ?? "Generate a quick single-photo splat preview.",
            truth: previewCapability?.truth ?? "Single-photo preview output.",
            available: Boolean(previewCapability?.available),
            tone: "emerald",
        },
        {
            key: "reconstruction",
            title: reconstructionCapability?.label ?? "Production Reconstruction",
            summary: reconstructionCapability?.summary ?? "Collect a multi-view capture set for faithful 3D.",
            truth: reconstructionCapability?.truth ?? "Needs a dedicated GPU reconstruction worker.",
            available: Boolean(reconstructionCapability?.available),
            tone: "amber",
        },
        {
            key: "asset",
            title: assetCapability?.label ?? "Single-Image Asset",
            summary: assetCapability?.summary ?? "Generate an object asset from one photo.",
            truth: assetCapability?.truth ?? "Object-focused generation lane.",
            available: Boolean(assetCapability?.available),
            tone: "blue",
        },
    ] as const;

    const connectedLaneCount = laneCards.filter((lane) => lane.available).length;
    const workspaceStatusLabel =
        backendMode === "ready"
            ? connectedLaneCount === laneCards.length
                ? "All lanes online"
                : "Limited lane coverage"
            : backendMode === "degraded"
              ? "Lane needs attention"
              : backendMode === "offline"
                ? "Services offline"
                : "Checking services";
    const workspaceStatusSummary =
        backendMode === "ready"
            ? connectedLaneCount === laneCards.length
                ? "Preview, reconstruction, and asset are connected for this session."
                : `${connectedLaneCount} of ${laneCards.length} production modes are connected. You can keep scouting while the missing lane recovers.`
            : backendMode === "degraded"
              ? "GAUSET is responding, but one production lane still needs attention."
              : backendMode === "offline"
                ? "The app cannot see local services yet. Reconnect them to intake stills and build the world."
                : "Confirming the current backend, storage, and lane capabilities.";
    const backendStatusDetail =
        backendMessage && backendMessage !== setupTruth && backendMessage !== workspaceStatusSummary ? backendMessage : "";
    const nextStep = selectedUpload
        ? {
              title: "Send the selected still into the right mode",
              body: reconstructionAvailable
                  ? "Use Preview for a fast scout pass, Asset for extraction, or keep stacking overlap for a faithful reconstruction."
                  : "You can still judge frame quality and build the capture set while the missing worker is restored.",
          }
        : captureSession?.ready_for_reconstruction
          ? {
                title: reconstructionAvailable ? "Kick off reconstruction" : "Capture set is ready",
                body: reconstructionAvailable
                    ? "You have enough overlap to move from scout stills into a faithful world build."
                    : "Your capture set is ready, but the reconstruction worker still needs to come online.",
            }
          : {
                title: "Start with the location",
                body:
                    backendMode === "offline"
                        ? "Reconnect local services, then import one hero still or a small orbit set to start building the scene."
                        : "Import a hero still for preview or asset work, or begin a multi-view capture set for reconstruction.",
            };
    const workspaceBadgeLabel =
        backendMode === "ready"
            ? connectedLaneCount === laneCards.length
                ? "Ready"
                : "Limited"
            : backendMode === "degraded"
              ? "Attention"
              : backendMode === "offline"
              ? "Offline"
              : "Checking";
    const showPreviewWorkspaceNavigation = clarityMode && Boolean(previewWorkspaceNavigation);
    return (
        <div
            className={
                clarityMode
                    ? "h-full overflow-y-auto bg-[linear-gradient(180deg,#0a1017_0%,#070b10_42%,#05070a_100%)] px-5 py-5 text-neutral-300"
                    : "h-full overflow-y-auto bg-neutral-950 px-4 py-4 text-neutral-300"
            }
        >
            {showPreviewWorkspaceNavigation ? (
                <div
                    className="sticky top-0 z-20 mb-4 rounded-[24px] border border-white/12 bg-[linear-gradient(180deg,rgba(10,16,24,0.96),rgba(7,11,17,0.98))] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.28)] backdrop-blur-xl"
                    data-testid="mvp-preview-workspace-nav"
                >
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-[10px] uppercase tracking-[0.24em] text-cyan-100/90">MVP preview</p>
                            <p className="mt-2 text-base font-semibold tracking-tight text-white">
                                {previewWorkspaceNavigation?.title ?? "Current workspace"}
                            </p>
                            <p className="mt-1 text-xs leading-5 text-neutral-400">
                                {previewWorkspaceNavigation?.note ?? "Back to start keeps this workspace in memory."}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={previewWorkspaceNavigation?.onBackToStart}
                            className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-3.5 py-2 text-[11px] font-medium uppercase tracking-[0.18em] text-white transition-colors hover:border-white/20 hover:bg-white/[0.08]"
                            data-testid="mvp-preview-back-to-start"
                        >
                            <ArrowLeft className="h-3.5 w-3.5" />
                            Back to start
                        </button>
                    </div>
                </div>
            ) : clarityMode ? (
                <div className="mb-4 rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,rgba(11,18,28,0.96),rgba(7,11,17,0.98))] p-4 shadow-[0_16px_34px_rgba(0,0,0,0.22)]">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                <p className="text-[10px] uppercase tracking-[0.28em] text-cyan-100/90">Persistent worlds</p>
                                <span className="text-[10px] uppercase tracking-[0.18em] text-neutral-300">Director workspace</span>
                            </div>
                            <h2
                                className="mt-2 text-[2.15rem] font-medium leading-[0.92] tracking-[-0.055em] text-white"
                                data-testid="mvp-shell-title"
                            >
                                GAUSET
                            </h2>
                        </div>
                        <span className="rounded-full border border-cyan-300/15 bg-cyan-400/8 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-cyan-100/75">
                            World-first
                        </span>
                    </div>
                    <p className="mt-3 text-[13px] leading-5 text-neutral-400">
                        Bring in scout stills, judge fidelity quickly, and move into the right world-building lane before the crew loses time.
                    </p>
                    <div className="mt-4 grid grid-cols-3 gap-2">
                        <div className="rounded-[18px] border border-white/8 bg-black/20 px-3 py-3">
                            <p className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">Modes online</p>
                            <p className="mt-1.5 text-sm font-medium tracking-tight text-white">
                                {connectedLaneCount}/{laneCards.length}
                            </p>
                        </div>
                        <div className="rounded-[18px] border border-white/8 bg-black/20 px-3 py-3">
                            <p className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">Capture target</p>
                            <p className="mt-1.5 text-sm font-medium tracking-tight text-white">{recommendedCaptureImages}</p>
                        </div>
                        <div className="rounded-[18px] border border-white/8 bg-black/20 px-3 py-3">
                            <p className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">Next milestone</p>
                            <p className="mt-1.5 text-sm font-medium tracking-tight text-white">
                                {captureSession?.ready_for_reconstruction ? "Reconstruct" : "Import"}
                            </p>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="mb-4">
                    <p className="text-[10px] uppercase tracking-[0.24em] text-neutral-300">Persistent worlds</p>
                    <div className="mt-2 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h2 className="text-xl font-semibold tracking-tight text-white" data-testid="mvp-shell-title">
                                GAUSET
                            </h2>
                            <p className="mt-1 text-xs leading-5 text-neutral-400">
                                Import or generate source stills, then route them into preview, reconstruction, or asset work.
                            </p>
                        </div>
                        <span
                            className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${backendBadgeClassName}`}
                        >
                            {workspaceBadgeLabel}
                        </span>
                    </div>
                </div>
            )}
            <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp"
                multiple
                className="hidden"
                onChange={handleUpload}
            />

            {clarityMode && !showPreviewWorkspaceNavigation ? (
                <div className="mb-5 rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,16,23,0.92),rgba(8,11,16,0.96))] p-4 shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-300">Start here</p>
                            <p className="mt-2 text-sm font-medium text-white">{nextStep.title}</p>
                            <p className="mt-1 text-xs leading-5 text-neutral-400">{nextStep.body}</p>
                        </div>
                        <span
                            className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${backendBadgeClassName}`}
                        >
                            {workspaceBadgeLabel}
                        </span>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2">
                        <div className="rounded-[18px] border border-white/10 bg-black/20 px-3 py-3">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-300">1. Create world</p>
                            <p className="mt-2 text-xs text-white">{previewCapability?.available ? "Ready to build" : "Waiting on preview lane"}</p>
                        </div>
                        <div className="rounded-[18px] border border-white/10 bg-black/20 px-3 py-3">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-300">2. Direct scene</p>
                            <p className="mt-2 text-xs text-white">Use views, pins, and notes after the world loads.</p>
                        </div>
                        <div className="rounded-[18px] border border-white/10 bg-black/20 px-3 py-3">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-300">3. Export result</p>
                            <p className="mt-2 text-xs text-white">Save versions and export when the scene is ready.</p>
                        </div>
                    </div>
                </div>
            ) : null}

            {!clarityMode ? (
                <div
                    className={`mb-5 rounded-[28px] border px-5 py-5 shadow-[0_18px_40px_rgba(0,0,0,0.24)] ${backendCardClassName}`}
                    data-testid="mvp-session-status"
                >
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-neutral-800 bg-black/20">
                                {backendMode === "ready" ? (
                                    <ShieldCheck className="h-4 w-4 text-emerald-300" />
                                ) : backendMode === "offline" ? (
                                    <AlertTriangle className="h-4 w-4 text-rose-300" />
                                ) : backendMode === "degraded" ? (
                                    <Cpu className="h-4 w-4 text-amber-200" />
                                ) : (
                                    <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />
                                )}
                            </div>
                            <div className="min-w-0">
                                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-500">Local backend</p>
                                <p className="mt-1 text-base font-semibold text-white">{workspaceStatusLabel}</p>
                            </div>
                        </div>
                        <span
                            className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${backendBadgeClassName}`}
                        >
                            {workspaceBadgeLabel}
                        </span>
                    </div>

                    <p className="mt-4 text-sm leading-6 text-neutral-300">{workspaceStatusSummary}</p>
                    {setupTruth ? <p className="mt-3 text-[11px] leading-5 text-neutral-500">{setupTruth}</p> : null}
                    {backendStatusDetail ? (
                        <p className="mt-2 text-[11px] leading-5 whitespace-pre-wrap text-neutral-500">{backendStatusDetail}</p>
                    ) : null}

                    <div className="mt-5 grid grid-cols-2 gap-3 text-[11px] text-neutral-300">
                        <div className="rounded-[18px] border border-neutral-800 bg-black/20 px-3.5 py-3">
                            <p className="text-[9px] uppercase tracking-[0.16em] text-neutral-500">Preview</p>
                            <p className="mt-1 text-white">{previewCapability?.available ? "Ready" : "Offline"}</p>
                        </div>
                        <div className="rounded-[18px] border border-neutral-800 bg-black/20 px-3.5 py-3">
                            <p className="text-[9px] uppercase tracking-[0.16em] text-neutral-500">Reconstruct</p>
                            <p className="mt-1 text-white">{reconstructionCapability?.available ? "Ready" : "Offline"}</p>
                        </div>
                        <div className="rounded-[18px] border border-neutral-800 bg-black/20 px-3.5 py-3">
                            <p className="text-[9px] uppercase tracking-[0.16em] text-neutral-500">Asset</p>
                            <p className="mt-1 text-white">{assetCapability?.available ? "Ready" : "Offline"}</p>
                        </div>
                        <div className="rounded-[18px] border border-neutral-800 bg-black/20 px-3.5 py-3">
                            <p className="text-[9px] uppercase tracking-[0.16em] text-neutral-500">Capture</p>
                            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-white">
                                <span>{recommendedCaptureImages} target</span>
                                <span className="text-neutral-500">/</span>
                                <span>{minimumCaptureImages} minimum</span>
                            </div>
                        </div>
                        <div className="rounded-[18px] border border-neutral-800 bg-black/20 px-3.5 py-3">
                            <p className="text-[9px] uppercase tracking-[0.16em] text-neutral-500">Recon worker</p>
                            <p className="mt-1 text-white">{formatBandLabel(reconstructionBackendName) || reconstructionBackendName}</p>
                        </div>
                        <div className="rounded-[18px] border border-neutral-800 bg-black/20 px-3.5 py-3">
                            <p className="text-[9px] uppercase tracking-[0.16em] text-neutral-500">Benchmark</p>
                            <p className="mt-1 text-white">{benchmarkStatusLabel}</p>
                        </div>
                        <div className="col-span-2 rounded-[18px] border border-neutral-800 bg-black/20 px-3.5 py-3">
                            <p className="text-[9px] uppercase tracking-[0.16em] text-neutral-500">Release gates</p>
                            <p className="mt-1 text-white">
                                {releaseGateFailureCount === 0
                                    ? "All tracked gates pass"
                                    : `${releaseGateFailureCount} promotion gate${releaseGateFailureCount === 1 ? "" : "s"} blocked`}
                            </p>
                        </div>
                    </div>

                    <div className="mt-4 rounded-[20px] border border-neutral-800 bg-black/20 px-4 py-3.5">
                        <p className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">Next move</p>
                        <p className="mt-1 text-sm text-white">{nextStep.title}</p>
                        <p className="mt-1 text-[11px] leading-5 text-neutral-400">{nextStep.body}</p>
                    </div>
                </div>
            ) : null}

            <div className="mb-3 flex rounded-[24px] border border-white/10 bg-black/20 p-1">
                <button
                    type="button"
                    onClick={() => setIntakeMode("import")}
                    className={`flex-1 rounded-[18px] px-4 py-2.5 text-xs font-medium uppercase tracking-[0.18em] transition-all ${
                        intakeMode === "import"
                            ? "bg-white text-black"
                            : "text-neutral-400 hover:bg-white/[0.04] hover:text-white"
                    }`}
                >
                    Import stills
                </button>
                <button
                    type="button"
                    onClick={() => setIntakeMode("generate")}
                    className={`flex-1 rounded-[18px] px-4 py-2.5 text-xs font-medium uppercase tracking-[0.18em] transition-all ${
                        intakeMode === "generate"
                            ? "bg-sky-400 text-black"
                            : "text-neutral-400 hover:bg-white/[0.04] hover:text-white"
                    }`}
                >
                    Generate still
                </button>
            </div>

            {intakeMode === "import" ? (
                <div
                    className={`mb-5 rounded-[24px] border p-5 transition-all group shadow-[0_16px_36px_rgba(0,0,0,0.2)] ${
                        backendMode === "offline"
                            ? "border-white/10 bg-black/30 cursor-not-allowed opacity-75"
                            : "border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.015))] hover:border-sky-400/35 hover:bg-white/[0.05] cursor-pointer"
                    }`}
                    onClick={triggerFilePicker}
                >
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                            <p className="text-[10px] uppercase tracking-[0.22em] text-neutral-500">Scene intake</p>
                            <p className="mt-3 text-xl font-medium tracking-tight text-white group-hover:text-sky-100">
                                {backendMode === "offline"
                                    ? "Reconnect local services"
                                    : isUploading
                                      ? "Importing scout stills"
                                      : "Bring in scout stills"}
                            </p>
                            <p className="mt-2 text-sm leading-6 text-neutral-400">
                                {backendMode === "offline"
                                    ? "Reconnect the local backend first so this workspace can intake stills and build scenes."
                                    : reconstructionAvailable
                                      ? "Use one frame for preview or asset work, or drop in a small orbit set for reconstruction."
                                      : "Use one frame for preview or asset work, or prepare an orbit set while reconstruction comes online."}
                            </p>
                        </div>
                        {isUploading ? (
                            <Loader2 className="h-8 w-8 shrink-0 animate-spin text-sky-400" />
                        ) : (
                            <Upload className="h-8 w-8 shrink-0 text-neutral-500 transition-colors group-hover:text-sky-300" />
                        )}
                    </div>

                    <div className="mt-5 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.18em] text-neutral-400">
                        <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">JPG / PNG / WEBP</span>
                        <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">Single still or orbit set</span>
                        <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">QC + lane routing</span>
                    </div>

                    <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-neutral-200">
                        {backendMode === "offline" ? "Backend required" : "Import scout stills"}
                        <ArrowRight className="h-3.5 w-3.5" />
                    </div>
                </div>
            ) : (
                <div className="mb-5 rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,24,38,0.8),rgba(10,14,19,0.92))] p-5 shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <p className="text-[10px] uppercase tracking-[0.22em] text-neutral-500">Prompt a source still</p>
                            <p className="mt-3 text-xl font-medium tracking-tight text-white">
                                {providersLoading ? "Loading providers" : "Generate a source still"}
                            </p>
                            <p className="mt-2 text-sm leading-6 text-neutral-400">
                                Create a still from a prompt, then either keep it as a reference image or turn it straight into a persistent world.
                            </p>
                        </div>
                        {isGeneratingImage ? (
                            <Loader2 className="h-8 w-8 shrink-0 animate-spin text-sky-400" />
                        ) : (
                            <Sparkles className="h-8 w-8 shrink-0 text-sky-300" />
                        )}
                    </div>

                    <div className="mt-5 space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <label className="space-y-2">
                                <span className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Provider</span>
                                <select
                                    value={selectedProvider?.id ?? ""}
                                    onChange={(event) => setSelectedProviderId(event.target.value)}
                                    className="w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-3 text-sm text-white outline-none"
                                >
                                    {imageProviders.map((provider) => (
                                        <option key={provider.id} value={provider.id}>
                                            {provider.label}{provider.available ? "" : " (Unavailable)"}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            <label className="space-y-2">
                                <span className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Model</span>
                                <select
                                    value={selectedProviderModel?.id ?? ""}
                                    onChange={(event) => setSelectedModelId(event.target.value)}
                                    className="w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-3 text-sm text-white outline-none"
                                >
                                    {(selectedProvider?.models ?? []).map((model) => (
                                        <option key={model.id} value={model.id}>
                                            {model.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        </div>

                        <label className="block space-y-2">
                            <span className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Prompt</span>
                            <textarea
                                value={generatePrompt}
                                onChange={(event) => setGeneratePrompt(event.target.value)}
                                rows={4}
                                className="w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-3 text-sm text-white outline-none placeholder:text-neutral-600"
                                placeholder="Example: warm cafe interior, window light, practical neon sign, grounded camera height"
                            />
                        </label>

                        {clarityMode ? (
                            <details className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                                <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-[0.18em] text-neutral-400">
                                    Advanced image controls
                                </summary>
                                <div className="mt-4 space-y-3">
                                    <label className="block space-y-2">
                                        <span className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Negative prompt</span>
                                        <input
                                            value={generateNegativePrompt}
                                            onChange={(event) => setGenerateNegativePrompt(event.target.value)}
                                            disabled={!selectedModelSupportsNegativePrompt}
                                            className="w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-3 text-sm text-white outline-none placeholder:text-neutral-600 disabled:opacity-50"
                                            placeholder="cartoon, text, watermark, low detail"
                                        />
                                        {!selectedModelSupportsNegativePrompt ? (
                                            <p className="text-[11px] text-neutral-500">
                                                {selectedProviderModel?.label ?? "This model"} does not expose negative prompting.
                                            </p>
                                        ) : null}
                                    </label>

                                    <div className="grid grid-cols-2 gap-3">
                                        <label className="space-y-2">
                                            <span className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Aspect ratio</span>
                                            <select
                                                value={generateAspectRatio}
                                                onChange={(event) => setGenerateAspectRatio(event.target.value)}
                                                className="w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-3 text-sm text-white outline-none"
                                            >
                                                {providerAspectRatios.map((ratio) => (
                                                    <option key={ratio} value={ratio}>
                                                        {ratio}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>

                                        <label className="space-y-2">
                                            <span className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Count</span>
                                            <select
                                                value={selectedModelSupportsMultiOutput ? generateCount : 1}
                                                onChange={(event) => setGenerateCount(Number(event.target.value))}
                                                disabled={!selectedModelSupportsMultiOutput}
                                                className="w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-3 text-sm text-white outline-none disabled:opacity-50"
                                            >
                                                {Array.from({ length: selectedProviderMaxOutputs }, (_, index) => index + 1).map((count) => (
                                                    <option key={count} value={count}>
                                                        {count}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                    </div>

                                    {selectedModelSupportsReferences ? (
                                        <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                                            <div className="flex items-center justify-between gap-3">
                                                <div>
                                                    <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Reference images</p>
                                                    <p className="mt-1 text-[11px] text-neutral-400">
                                                        Choose up to {selectedProviderMaxReferences} stills from the current tray.
                                                    </p>
                                                </div>
                                                <span className="text-[11px] text-neutral-500">
                                                    {selectedReferenceIds.length}/{selectedProviderMaxReferences}
                                                </span>
                                            </div>
                                            {uploads.length > 0 ? (
                                                <div className="mt-3 grid grid-cols-4 gap-2">
                                                    {uploads.map((upload) => {
                                                        const isSelected = selectedReferenceIds.includes(upload.image_id);
                                                        return (
                                                            <button
                                                                key={`reference-${upload.image_id}`}
                                                                type="button"
                                                                onClick={() => toggleReferenceSelection(upload.image_id)}
                                                                className={`relative aspect-square rounded-xl border bg-neutral-950 bg-cover bg-center transition-all ${
                                                                    isSelected ? "border-sky-400 shadow-lg shadow-sky-950/30" : "border-neutral-800"
                                                                }`}
                                                                style={{ backgroundImage: `url(${upload.previewUrl})` }}
                                                                title={upload.sourceName}
                                                            >
                                                                <span className="sr-only">{upload.sourceName}</span>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            ) : (
                                                <p className="mt-3 text-[11px] text-neutral-500">Import or generate at least one still before using references.</p>
                                            )}
                                        </div>
                                    ) : null}

                                    <div className="rounded-2xl border border-white/10 bg-black/25 p-3 text-[11px] text-neutral-400">
                                        {providersLoading
                                            ? "Loading provider catalog..."
                                            : !providerGenerationEnabled
                                              ? "Provider generation is disabled in this backend. Set GAUSET_ENABLE_PROVIDER_IMAGE_GEN=1."
                                              : !imageProviders.length
                                                ? "No image providers are registered in this backend."
                                                : selectedProvider?.available
                                                  ? `${selectedProvider.label} is connected.${selectedModelSupportsReferences ? " Reference-image prompting is available." : ""}`
                                                  : selectedProvider?.availability_reason ?? "This provider is not ready in the current backend."}
                                        {selectedProvider?.required_env?.length ? (
                                            <div className="mt-2 text-[10px] uppercase tracking-[0.14em] text-neutral-500">
                                                Required env: {selectedProvider.required_env.join(", ")}
                                            </div>
                                        ) : null}
                                        {selectedProvider?.setup_hint ? (
                                            <div className="mt-2 text-[11px] leading-5 text-neutral-500">{selectedProvider.setup_hint}</div>
                                        ) : null}
                                        {selectedProvider?.documentation_url ? (
                                            <a
                                                href={selectedProvider.documentation_url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="mt-2 inline-flex text-[11px] text-sky-300 transition-colors hover:text-sky-200"
                                            >
                                                Provider docs
                                            </a>
                                        ) : null}
                                    </div>
                                </div>
                            </details>
                        ) : (
                            <>
                                <label className="block space-y-2">
                                    <span className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Negative prompt</span>
                                    <input
                                        value={generateNegativePrompt}
                                        onChange={(event) => setGenerateNegativePrompt(event.target.value)}
                                        disabled={!selectedModelSupportsNegativePrompt}
                                        className="w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-3 text-sm text-white outline-none placeholder:text-neutral-600 disabled:opacity-50"
                                        placeholder="cartoon, text, watermark, low detail"
                                    />
                                    {!selectedModelSupportsNegativePrompt ? (
                                        <p className="text-[11px] text-neutral-500">
                                            {selectedProviderModel?.label ?? "This model"} does not expose negative prompting.
                                        </p>
                                    ) : null}
                                </label>

                                <div className="grid grid-cols-2 gap-3">
                                    <label className="space-y-2">
                                        <span className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Aspect ratio</span>
                                        <select
                                            value={generateAspectRatio}
                                            onChange={(event) => setGenerateAspectRatio(event.target.value)}
                                            className="w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-3 text-sm text-white outline-none"
                                        >
                                            {providerAspectRatios.map((ratio) => (
                                                <option key={ratio} value={ratio}>
                                                    {ratio}
                                                </option>
                                            ))}
                                        </select>
                                    </label>

                                    <label className="space-y-2">
                                        <span className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Count</span>
                                        <select
                                            value={selectedModelSupportsMultiOutput ? generateCount : 1}
                                            onChange={(event) => setGenerateCount(Number(event.target.value))}
                                            disabled={!selectedModelSupportsMultiOutput}
                                            className="w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-3 text-sm text-white outline-none disabled:opacity-50"
                                        >
                                            {Array.from({ length: selectedProviderMaxOutputs }, (_, index) => index + 1).map((count) => (
                                                <option key={count} value={count}>
                                                    {count}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                </div>

                                {selectedModelSupportsReferences ? (
                                    <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Reference images</p>
                                                <p className="mt-1 text-[11px] text-neutral-400">
                                                    Choose up to {selectedProviderMaxReferences} stills from the current tray.
                                                </p>
                                            </div>
                                            <span className="text-[11px] text-neutral-500">
                                                {selectedReferenceIds.length}/{selectedProviderMaxReferences}
                                            </span>
                                        </div>
                                        {uploads.length > 0 ? (
                                            <div className="mt-3 grid grid-cols-4 gap-2">
                                                {uploads.map((upload) => {
                                                    const isSelected = selectedReferenceIds.includes(upload.image_id);
                                                    return (
                                                        <button
                                                            key={`reference-${upload.image_id}`}
                                                            type="button"
                                                            onClick={() => toggleReferenceSelection(upload.image_id)}
                                                            className={`relative aspect-square rounded-xl border bg-neutral-950 bg-cover bg-center transition-all ${
                                                                isSelected ? "border-sky-400 shadow-lg shadow-sky-950/30" : "border-neutral-800"
                                                            }`}
                                                            style={{ backgroundImage: `url(${upload.previewUrl})` }}
                                                            title={upload.sourceName}
                                                        >
                                                            <span className="sr-only">{upload.sourceName}</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <p className="mt-3 text-[11px] text-neutral-500">Import or generate at least one still before using references.</p>
                                        )}
                                    </div>
                                ) : null}

                                <div className="rounded-2xl border border-white/10 bg-black/25 p-3 text-[11px] text-neutral-400">
                                    {providersLoading
                                        ? "Loading provider catalog..."
                                        : !providerGenerationEnabled
                                          ? "Provider generation is disabled in this backend. Set GAUSET_ENABLE_PROVIDER_IMAGE_GEN=1."
                                          : !imageProviders.length
                                            ? "No image providers are registered in this backend."
                                            : selectedProvider?.available
                                              ? `${selectedProvider.label} is connected.${selectedModelSupportsReferences ? " Reference-image prompting is available." : ""}`
                                              : selectedProvider?.availability_reason ?? "This provider is not ready in the current backend."}
                                    {selectedProvider?.required_env?.length ? (
                                        <div className="mt-2 text-[10px] uppercase tracking-[0.14em] text-neutral-500">
                                            Required env: {selectedProvider.required_env.join(", ")}
                                        </div>
                                    ) : null}
                                    {selectedProvider?.setup_hint ? (
                                        <div className="mt-2 text-[11px] leading-5 text-neutral-500">{selectedProvider.setup_hint}</div>
                                    ) : null}
                                    {selectedProvider?.documentation_url ? (
                                        <a
                                            href={selectedProvider.documentation_url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="mt-2 inline-flex text-[11px] text-sky-300 transition-colors hover:text-sky-200"
                                        >
                                            Provider docs
                                        </a>
                                    ) : null}
                                </div>
                            </>
                        )}

                        <div className="grid grid-cols-2 gap-3">
                            <button
                                type="button"
                                onClick={() => void generateImage({ autoPreview: false })}
                                disabled={
                                    backendMode === "offline" ||
                                    isGeneratingImage ||
                                    providersLoading ||
                                    !providerGenerationEnabled ||
                                    !selectedProvider ||
                                    !selectedProvider.available ||
                                    !selectedProviderModel
                                }
                                className="w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3.5 text-white font-medium transition-all hover:bg-white/[0.1] disabled:opacity-50 disabled:hover:bg-white/[0.06]"
                            >
                                {isGeneratingImage ? "Generating..." : "Generate source still"}
                            </button>
                            <button
                                type="button"
                                onClick={() => void generateImage({ autoPreview: true })}
                                disabled={
                                    backendMode === "offline" ||
                                    isGeneratingImage ||
                                    providersLoading ||
                                    !providerGenerationEnabled ||
                                    !selectedProvider ||
                                    !selectedProvider.available ||
                                    !selectedProviderModel ||
                                    !previewCapability?.available
                                }
                                className="w-full rounded-2xl bg-sky-400 px-4 py-3.5 text-black font-medium transition-all hover:bg-sky-300 disabled:opacity-50 disabled:hover:bg-sky-400"
                            >
                                {isGeneratingImage ? "Generating..." : "Generate still + build world"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {statusText && <p className="text-xs text-emerald-400 mb-4 whitespace-pre-wrap">{statusText}</p>}
            {errorText && <p className="text-xs text-rose-400 mb-4 whitespace-pre-wrap">{errorText}</p>}

            {uploads.length > 0 ? (
                <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300 pb-8">
                    <div
                        className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,24,38,0.76),rgba(10,14,19,0.9))] p-4"
                        data-testid="mvp-capture-tray"
                    >
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-500">Capture Tray</p>
                                <p className="mt-2 text-xs text-neutral-500">{uploads.length} uploaded photo{uploads.length === 1 ? "" : "s"}</p>
                            </div>
                            {selectedUpload ? (
                                <p className="text-[11px] text-neutral-400 truncate max-w-28 text-right">{selectedUpload.sourceName}</p>
                            ) : null}
                        </div>

                        <div className="mt-4 grid grid-cols-3 gap-2">
                            {uploads.map((upload) => {
                                const isSelected = upload.image_id === selectedUpload?.image_id;
                                return (
                                    <button
                                        key={upload.image_id}
                                        onClick={() => setSelectedUploadId(upload.image_id)}
                                        className={`relative aspect-square rounded-xl border bg-neutral-950 bg-cover bg-center text-left transition-all ${
                                            isSelected
                                                ? "border-blue-500/70 shadow-lg shadow-blue-950/30"
                                                : "border-neutral-800 hover:border-neutral-700"
                                        }`}
                                        style={{ backgroundImage: `url(${upload.previewUrl})` }}
                                        title={upload.sourceName}
                                    >
                                        {typeof upload.analysis?.technical_score === "number" ? (
                                            <span className="absolute right-1 top-1 rounded-md bg-black/70 px-1.5 py-1 text-[10px] text-white">
                                                {upload.analysis.technical_score.toFixed(0)}
                                            </span>
                                        ) : null}
                                        <span className="sr-only">{upload.sourceName}</span>
                                    </button>
                                );
                            })}
                        </div>

                        {selectedUpload && selectedUploadAnalysis ? (
                            <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-500">Frame QC</p>
                                        <p className="mt-1 text-sm text-white">{selectedUploadAnalysis.cinematic_use ?? "Capture analysis"}</p>
                                    </div>
                                    {typeof selectedUploadAnalysis.technical_score === "number" ? (
                                        <div className="rounded-lg border border-neutral-800 bg-black/20 px-2.5 py-2 text-right">
                                            <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Score</p>
                                            <p className="text-sm text-white">{selectedUploadAnalysis.technical_score.toFixed(1)}</p>
                                        </div>
                                    ) : null}
                                </div>
                                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-neutral-300">
                                    <div className="rounded-lg border border-neutral-800 bg-black/20 px-3 py-2">
                                        Sharpness {formatScore(selectedUploadAnalysis.sharpness_score)}
                                    </div>
                                    <div className="rounded-lg border border-neutral-800 bg-black/20 px-3 py-2">
                                        Exposure {formatScore(selectedUploadAnalysis.exposure_score)}
                                    </div>
                                    <div className="rounded-lg border border-neutral-800 bg-black/20 px-3 py-2">
                                        Contrast {formatScore(selectedUploadAnalysis.contrast_score)}
                                    </div>
                                    <div className="rounded-lg border border-neutral-800 bg-black/20 px-3 py-2">
                                        Grade {formatBandLabel(selectedUploadAnalysis.band)}
                                    </div>
                                </div>
                                {selectedUploadAnalysis.warnings?.length ? (
                                    <div className="mt-3 space-y-1">
                                        {selectedUploadAnalysis.warnings.map((warning) => (
                                            <p key={warning} className="text-[11px] text-amber-200">
                                                {warning}
                                            </p>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="mt-3 text-[11px] text-emerald-300">
                                        This frame is strong enough for preview, asset work, or capture-set inclusion.
                                    </p>
                                )}
                            </div>
                        ) : selectedUpload?.source_type === "generated" ? (
                            <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-3">
                                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-500">Generated Source</p>
                                <p className="mt-2 text-sm text-white">
                                    {selectedUpload.provider ?? "Provider output"} · {selectedUpload.model ?? "default model"}
                                </p>
                                <p className="mt-2 text-[11px] leading-5 text-neutral-400">
                                    {truncateLabel(selectedUpload.prompt, 120) || "Generated still ingested into the capture tray."}
                                </p>
                            </div>
                        ) : null}
                    </div>

                    <div className="space-y-3">
                        <button
                            onClick={generatePreview}
                            disabled={!selectedUpload || isGeneratingPreview || isGeneratingAsset || backendMode === "offline" || !previewCapability?.available}
                            className="w-full py-3.5 px-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-black font-medium flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:hover:bg-emerald-500 shadow-lg shadow-emerald-950/20"
                        >
                            {isGeneratingPreview ? <Loader2 className="animate-spin h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
                            {isGeneratingPreview ? "Building world preview..." : "Build world preview"}
                        </button>

                        <button
                            onClick={generateAsset}
                            disabled={!selectedUpload || isGeneratingPreview || isGeneratingAsset || backendMode === "offline" || !assetCapability?.available}
                            className="w-full py-3.5 px-4 rounded-2xl bg-sky-500 hover:bg-sky-400 text-black font-medium flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:hover:bg-sky-500 shadow-lg shadow-sky-950/20"
                        >
                            {isGeneratingAsset ? <Loader2 className="animate-spin h-5 w-5" /> : <Box className="h-5 w-5" />}
                            {isGeneratingAsset ? "Extracting 3D asset..." : "Extract 3D asset"}
                        </button>

                        <button
                            onClick={addSelectedToCaptureSet}
                            disabled={!selectedUpload || isUpdatingCapture || backendMode === "offline"}
                            className="w-full py-3.5 px-4 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] text-white font-medium flex items-center justify-center gap-2 transition-all border border-white/10 disabled:opacity-50 disabled:hover:bg-white/[0.04]"
                        >
                            {isUpdatingCapture ? <Loader2 className="animate-spin h-5 w-5" /> : <Upload className="h-5 w-5" />}
                            {isUpdatingCapture ? "Adding frame to capture set..." : "Add frame to capture set"}
                        </button>
                    </div>

                    <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,24,38,0.76),rgba(10,14,19,0.9))] p-4">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-500">Capture Set</p>
                                <p className="mt-2 text-sm text-white">
                                    {captureSession ? `${captureSession.frame_count} / ${captureSession.recommended_images} views` : "Not started"}
                                </p>
                            </div>
                            <div className="text-right text-[11px] text-neutral-500">
                                <p>{minimumCaptureImages} minimum</p>
                                <p>{recommendedCaptureImages} recommended</p>
                            </div>
                        </div>

                        <div className="mt-4 h-2 rounded-full bg-neutral-950 overflow-hidden">
                            <div
                                className="h-full bg-gradient-to-r from-blue-500 to-emerald-400 transition-all"
                                style={{ width: `${captureSession?.coverage_percent ?? 0}%` }}
                            />
                        </div>

                        <p className="mt-3 text-xs text-neutral-400">
                            {captureSession
                                ? captureSession.ready_for_reconstruction
                                    ? reconstructionAvailable
                                        ? "Capture minimum reached. Start reconstruction to build the fused scene."
                                        : "Capture minimum reached. A GPU reconstruction worker is still required for true 3DGS."
                                    : captureSetBlocked
                                      ? captureBlockers[0] ??
                                        `Capture minimum reached, but only ${captureUniqueFrameCount} unique views are available.`
                                    : `Add ${Math.max(captureSession.minimum_images - captureSession.frame_count, 0)} more overlapping photos to reach the minimum capture set.`
                                : "Start collecting 8-32 overlapping photos or a short orbit video for faithful reconstruction."}
                        </p>

                        {captureQualitySummary ? (
                            <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-500">Capture Quality</p>
                                        <p className="mt-1 text-sm text-white">
                                            {formatBandLabel(captureQualitySummary.readiness) ||
                                                formatBandLabel(captureQualitySummary.band) ||
                                                "pending"}
                                        </p>
                                        {captureQualitySummary.readiness ? (
                                            <p className="mt-1 text-[11px] text-neutral-500">
                                                {formatBandLabel(captureQualitySummary.band) || "pending"} operator grade
                                            </p>
                                        ) : null}
                                    </div>
                                    {typeof captureQualitySummary.score === "number" ? (
                                        <div className="rounded-lg border border-neutral-800 bg-black/20 px-2.5 py-2 text-right">
                                            <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Score</p>
                                            <p className="text-sm text-white">{captureQualitySummary.score.toFixed(1)}</p>
                                        </div>
                                    ) : null}
                                </div>
                                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-neutral-300">
                                    <div className="rounded-lg border border-neutral-800 bg-black/20 px-3 py-2">
                                        Sharp frames {captureQualitySummary.sharp_frame_count ?? 0}/{captureQualitySummary.frame_count ?? 0}
                                    </div>
                                    <div className="rounded-lg border border-neutral-800 bg-black/20 px-3 py-2">
                                        Unique views {captureUniqueFrameCount}/{captureQualitySummary.frame_count ?? 0}
                                    </div>
                                    <div className="rounded-lg border border-neutral-800 bg-black/20 px-3 py-2">
                                        Coverage {formatScore(captureQualitySummary.coverage_score)}
                                    </div>
                                    <div className="rounded-lg border border-neutral-800 bg-black/20 px-3 py-2">
                                        Duplicates {captureQualitySummary.duplicate_frames ?? 0}
                                        {captureDuplicateRatioPercent !== null ? ` · ${captureDuplicateRatioPercent}%` : ""}
                                    </div>
                                    <div className="rounded-lg border border-neutral-800 bg-black/20 px-3 py-2">
                                        Gate {formatBandLabel(captureQualitySummary.readiness) || "building"}
                                    </div>
                                </div>
                                {captureBlockers.length ? (
                                    <div className="mt-3 space-y-1">
                                        {captureBlockers.slice(0, 3).map((blocker) => (
                                            <p key={blocker} className="text-[11px] text-rose-200">
                                                {blocker}
                                            </p>
                                        ))}
                                    </div>
                                ) : null}
                                {captureQualitySummary.warnings?.length ? (
                                    <div className="mt-3 space-y-1">
                                        {captureQualitySummary.warnings.map((warning) => (
                                            <p key={warning} className="text-[11px] text-amber-200">
                                                {warning}
                                            </p>
                                        ))}
                                    </div>
                                ) : captureSession?.frame_count ? (
                                    <p className="mt-3 text-[11px] text-emerald-300">
                                        Capture set quality is trending in the right direction for a cleaner reconstruction pass.
                                    </p>
                                ) : null}
                                {captureNextActions.length ? (
                                    <div className="mt-3 space-y-1">
                                        {captureNextActions.slice(0, 3).map((action) => (
                                            <p key={action} className="text-[11px] text-sky-200">
                                                {action}
                                            </p>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        ) : null}

                        {captureSession?.guidance?.length ? (
                            <div className="mt-3 space-y-1 text-[11px] text-neutral-500">
                                {captureSession.guidance.slice(0, 2).map((tip) => (
                                    <p key={tip}>{tip}</p>
                                ))}
                            </div>
                        ) : null}

                        {captureSession?.frames?.length ? (
                            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                                {captureSession.frames.map((frame) => (
                                    <div key={frame.image_id} className="shrink-0">
                                        <div
                                            className="h-16 w-16 rounded-lg border border-neutral-800 bg-neutral-950 bg-cover bg-center"
                                            style={{ backgroundImage: `url(${toProxyUrl(frame.url)})` }}
                                        />
                                    </div>
                                ))}
                            </div>
                        ) : null}

                        <button
                            onClick={startReconstruction}
                            disabled={
                                !captureSession ||
                                !captureSession.ready_for_reconstruction ||
                                !reconstructionAvailable ||
                                isStartingReconstruction
                            }
                            className="mt-4 w-full py-3 px-4 rounded-2xl border border-amber-500/20 bg-amber-400/10 text-amber-100 font-medium transition-all disabled:opacity-50"
                        >
                            {isStartingReconstruction
                                ? "Starting Reconstruction..."
                                : captureSetBlocked
                                  ? "Resolve Capture Blockers"
                                  : reconstructionAvailable
                                    ? "Start Reconstruction"
                                    : "GPU Reconstruction Worker Not Connected"}
                        </button>
                    </div>
                </div>
            ) : (
                <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,24,38,0.7),rgba(10,14,19,0.86))] p-4 text-xs text-neutral-400">
                    Import or generate a hero still for a fast scout pass, or build a small overlapping capture set for a faithful reconstruction run.
                </div>
            )}

            <div className="mt-6 rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,24,38,0.76),rgba(10,14,19,0.9))] p-4">
                <div className="flex items-center gap-2 mb-3 text-[10px] font-bold text-neutral-500 uppercase tracking-[0.18em]">
                    <Clock3 className="h-3 w-3" />
                    Activity Log
                </div>
                {jobs.length > 0 ? (
                    <div className="space-y-2">
                        {jobs.map((job) => (
                            <div key={job.id} className="rounded-xl border border-neutral-800 bg-neutral-950/70 px-3 py-2">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-xs text-white truncate">
                                            {job.type === "environment"
                                                ? "Preview"
                                                : job.type === "reconstruction"
                                                  ? "Reconstruction"
                                                  : job.type === "generated_image"
                                                    ? "Generated Image"
                                                    : "Asset"}{" "}
                                            · {job.label}
                                        </p>
                                        <p className="text-[11px] text-neutral-500 font-mono truncate">{job.id}</p>
                                    </div>
                                    <div className="shrink-0">
                                        {job.status === "processing" ? (
                                            <Loader2 className="h-4 w-4 animate-spin text-blue-300" />
                                        ) : job.status === "completed" ? (
                                            <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                                        ) : (
                                            <AlertTriangle className="h-4 w-4 text-rose-300" />
                                        )}
                                    </div>
                                </div>
                                <div className="mt-2 flex items-center justify-between text-[11px] text-neutral-500">
                                    <span>{job.status}</span>
                                    <span>{formatJobTime(job.updatedAt)}</span>
                                </div>
                                {job.error && <p className="mt-2 text-[11px] text-rose-300 whitespace-pre-wrap">{job.error}</p>}
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-xs text-neutral-400">
                        Generated stills, world builds, reconstructions, and asset jobs appear here with a step-by-step status trail.
                    </p>
                )}
            </div>
        </div>
    );
}
