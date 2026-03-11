export type BackendMode = "checking" | "ready" | "degraded" | "offline";

export type GenerationLane = "preview" | "reconstruction" | "asset";

export type CaptureSessionStatus = "collecting" | "blocked" | "ready" | "queued" | "running" | "completed" | "unavailable";

export interface UploadResponse {
    image_id: string;
    filename: string;
    filepath: string;
    url?: string;
    analysis?: UploadImageAnalysis;
    source_type?: "upload" | "generated";
    provider?: string;
    model?: string;
    prompt?: string;
    generation_job_id?: string;
}

export interface BackendLaneCapability {
    available: boolean;
    label: string;
    summary: string;
    truth: string;
    lane_truth?: string;
    input_strategy: string;
    min_images: number;
    recommended_images: number;
}

export interface SetupStatusResponse {
    status: string;
    python_version?: string;
    backend?: {
        label?: string;
        kind?: string;
        deployment?: string;
        truth?: string;
        lane_truth?: string;
    };
    lane_truth?: {
        preview?: string;
        reconstruction?: string;
        asset?: string;
    };
    reconstruction_backend?: {
        name?: string;
        kind?: string;
        gpu_worker_connected?: boolean;
        native_gaussian_training?: boolean;
        world_class_ready?: boolean;
    };
    benchmark_status?: {
        status?: string;
        locked_suite?: string;
        summary?: string;
    };
    release_gates?: {
        truthful_preview_lane?: boolean;
        gpu_reconstruction_connected?: boolean;
        native_gaussian_training?: boolean;
        holdout_metrics?: boolean;
        market_benchmarking?: boolean;
    };
    capabilities?: {
        preview?: BackendLaneCapability;
        reconstruction?: BackendLaneCapability;
        asset?: BackendLaneCapability;
    };
    capture?: {
        minimum_images?: number;
        recommended_images?: number;
        max_images?: number;
        guidance?: string[];
    };
    models?: {
        preview_generator?: string;
        reconstruction_generator?: string;
        asset_generator?: string;
        ml_sharp?: boolean;
        triposr?: boolean;
    };
    directories?: {
        uploads?: boolean;
        assets?: boolean;
        scenes?: boolean;
    };
    torch?: {
        installed?: boolean;
        version?: string | null;
        mps_available?: boolean;
        error?: string;
    };
    errors?: {
        reconstruction_import?: string | null;
    };
    provider_generation?: ProviderGenerationSummary;
}

export interface ProviderGenerationSummary {
    enabled: boolean;
    available: boolean;
    image_provider_count: number;
    available_image_provider_count: number;
    video_provider_count: number;
    configured_image_providers?: string[];
    unavailable_image_providers?: string[];
}

export interface ProviderModelInfo {
    id: string;
    label: string;
    supports_prompt_only: boolean;
    supports_references: boolean;
    supports_multi_output: boolean;
    supports_negative_prompt: boolean;
}

export interface ProviderCatalogEntry {
    id: string;
    label: string;
    media_kind: "image" | "video";
    available: boolean;
    connection_status: string;
    summary: string;
    availability_reason?: string | null;
    supports_prompt_only: boolean;
    supports_references: boolean;
    supports_multi_output: boolean;
    models: ProviderModelInfo[];
    documentation_url?: string | null;
    setup_hint?: string | null;
    required_env?: string[];
    optional_env?: string[];
    supported_aspect_ratios?: string[];
    max_reference_images?: number;
    max_outputs?: number;
    default_model?: string | null;
}

export interface ProviderCatalogResponse {
    enabled: boolean;
    summary?: ProviderGenerationSummary;
    providers: ProviderCatalogEntry[];
}

export interface CaptureFrameRecord {
    image_id: string;
    filename: string;
    url: string;
    added_at: string;
    analysis?: UploadImageAnalysis;
}

export interface CaptureSessionResponse {
    session_id: string;
    lane: "reconstruction";
    status: CaptureSessionStatus;
    created_at: string;
    updated_at: string;
    minimum_images: number;
    recommended_images: number;
    max_images: number;
    frame_count: number;
    coverage_percent: number;
    ready_for_reconstruction: boolean;
    frames: CaptureFrameRecord[];
    guidance: string[];
    reconstruction_blockers?: string[];
    job_id?: string;
    scene_id?: string;
    quality_summary?: CaptureQualitySummary;
    urls?: {
        viewer?: string;
        splats?: string;
        cameras?: string;
        metadata?: string;
        holdout_report?: string;
        capture_scorecard?: string;
        benchmark_report?: string;
    };
    last_error?: string;
}

export interface UploadImageAnalysis {
    technical_score?: number;
    band?: string;
    cinematic_use?: string;
    aspect_ratio?: number;
    sharpness_score?: number;
    exposure_score?: number;
    contrast_score?: number;
    saturation_score?: number;
    brightness_mean?: number;
    contrast_std?: number;
    saturation_mean?: number;
    file_hash?: string;
    warnings?: string[];
}

export interface CaptureQualitySummary {
    score?: number;
    coverage_score?: number;
    band?: string;
    readiness?: string;
    frame_count?: number;
    unique_frame_count?: number;
    duplicate_ratio?: number;
    sharp_frame_count?: number;
    duplicate_frames?: number;
    warnings?: string[];
    recommended_next_actions?: string[];
    reconstruction_gate?: {
        allowed?: boolean;
        label?: string;
        unique_frame_count?: number;
        minimum_sharp_frames?: number;
        blockers?: string[];
    };
}

export interface EnvironmentRenderingMetadata {
    color_encoding?: string;
    viewer_decode?: string;
    has_explicit_vertex_colors?: boolean;
    viewer_renderer?: string;
    source_format?: string;
    viewer_source?: string;
    apply_preview_orientation?: boolean;
    preview_density_multiplier?: number;
}

export interface EnvironmentDeliveryAxis {
    score?: number;
    status?: string;
    note?: string;
}

export interface EnvironmentDeliveryProfile {
    score?: number;
    readiness?: string;
    label?: string;
    summary?: string;
    recommended_viewer_mode?: string;
    blocking_issues?: string[];
    next_actions?: string[];
    axes?: {
        geometry?: EnvironmentDeliveryAxis;
        color?: EnvironmentDeliveryAxis;
        coverage?: EnvironmentDeliveryAxis;
        density?: EnvironmentDeliveryAxis;
    };
    render_targets?: {
        desktop_fps?: number;
        mobile_fps?: number;
        preferred_point_budget?: number;
    };
}

export interface EnvironmentQualityMetrics {
    score?: number;
    band?: string;
    capture_score?: number;
    warnings?: string[];
    alignment?: {
        score?: number;
        pair_count?: number;
        pose_pairs?: number;
        fallback_pairs?: number;
        zero_inlier_pairs?: number;
        pose_success_ratio?: number;
        average_matches?: number;
        average_inliers?: number;
        median_baseline?: number;
        warnings?: string[];
    };
    appearance?: {
        score?: number;
        mean_brightness?: number;
        mean_saturation?: number;
        mean_contrast?: number;
        exposure_span?: number;
        white_balance_span?: number;
        saturation_span?: number;
        warnings?: string[];
    };
}

export interface EnvironmentCaptureReport {
    status?: string;
    capture_mode?: string;
    frame_count?: number;
    coverage_score?: number;
    quality_band?: string;
    summary?: string;
    warnings?: string[];
    target_contract?: {
        minimum_images?: number;
        recommended_images?: number;
        maximum_images?: number;
        detail_pass_required?: boolean;
        locked_exposure_required?: boolean;
        height_variation_required?: boolean;
    };
}

export interface EnvironmentSfmReport {
    backend?: string;
    status?: string;
    pair_count?: number;
    pose_pairs?: number;
    verified_pose_pairs?: number;
    failed_pose_pairs?: number;
    pose_success_ratio?: number;
    average_inliers?: number;
    zero_inlier_pairs?: number;
    synthetic_camera_priors_used?: boolean;
    native_sfm?: boolean;
    warnings?: string[];
}

export interface EnvironmentTrainingReport {
    backend?: string;
    kind?: string;
    native_gaussian_training?: boolean;
    artifact_format?: string;
    viewer_renderer?: string;
    point_count?: number;
    world_class_ready?: boolean;
    summary?: string;
    caps?: {
        global_budget?: number;
        per_view_budget?: number;
    };
}

export interface EnvironmentHoldoutReport {
    status?: string;
    available?: boolean;
    metrics_available?: boolean;
    passed?: boolean;
    summary?: string;
    required_for_promotion?: boolean;
}

export interface EnvironmentComparisonReport {
    benchmark_status?: string;
    benchmarked?: boolean;
    summary?: string;
    market_baselines?: string[];
}

export interface EnvironmentReleaseGates {
    status?: string;
    hero_ready?: boolean;
    world_class_ready?: boolean;
    summary?: string;
    checks?: Record<string, boolean | undefined>;
    failed?: string[];
}

export interface EnvironmentPreviewEnhancement {
    source_renderer?: string;
    point_count_before?: number;
    point_count_after?: number;
    density?: {
        multiplier?: number;
        source_count?: number;
        output_count?: number;
        jitter_radius?: number;
        scale_shrink?: number;
    };
    exposure?: {
        profile?: string;
        dark_scene?: boolean;
        gain?: number;
        gamma?: number;
        saturation_boost?: number;
        target_mean?: number;
        target_p75?: number;
        max_gain?: number;
        min_gamma?: number;
        mean_luma_before?: number;
        mean_luma_after?: number;
        p75_luma_before?: number;
        p75_luma_after?: number;
    };
}

export interface GeneratedEnvironmentMetadata {
    lane?: "preview" | "reconstruction";
    truth_label?: string;
    reference_image?: string;
    input_image?: string;
    preview_projection?: string;
    quality_tier?: string;
    faithfulness?: string;
    lane_truth?: string;
    capture_mode?: string;
    reconstruction_status?: string;
    reconstruction_backend?: string;
    training_backend?: string;
    benchmark_status?: string;
    model?: string;
    mode?: string;
    generator?: string;
    point_count?: number;
    frame_count?: number;
    recommended_capture?: string;
    rendering?: EnvironmentRenderingMetadata;
    capture?: EnvironmentCaptureReport;
    sfm?: EnvironmentSfmReport;
    training?: EnvironmentTrainingReport;
    holdout?: EnvironmentHoldoutReport;
    comparison?: EnvironmentComparisonReport;
    release_gates?: EnvironmentReleaseGates;
    quality?: EnvironmentQualityMetrics;
    delivery?: EnvironmentDeliveryProfile;
    preview_enhancement?: EnvironmentPreviewEnhancement;
    source_camera?: {
        position?: [number, number, number];
        target?: [number, number, number];
        up?: [number, number, number];
        focal_length_px?: number;
        resolution_px?: [number, number];
        fov_degrees?: number;
    };
}

function normalizeEnvironmentString(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function deriveStorageUrlFromAbsolutePath(value: unknown) {
    const normalized = normalizeEnvironmentString(value);
    if (!normalized) {
        return "";
    }

    if (normalized.startsWith("/storage/")) {
        return normalized;
    }

    const uploadsIndex = normalized.lastIndexOf("/uploads/");
    if (uploadsIndex >= 0) {
        return `/storage${normalized.slice(uploadsIndex)}`;
    }

    const scenesIndex = normalized.lastIndexOf("/scenes/");
    if (scenesIndex >= 0) {
        return `/storage${normalized.slice(scenesIndex)}`;
    }

    return "";
}

function containsReferenceOnlyFlag(value: unknown) {
    return normalizeEnvironmentString(value).toLowerCase().includes("reference-only");
}

export function resolveEnvironmentRenderState(environment: any) {
    const urls = environment?.urls && typeof environment.urls === "object" ? environment.urls : {};
    const metadata = environment?.metadata && typeof environment.metadata === "object" ? environment.metadata : null;
    const rendering = metadata?.rendering && typeof metadata.rendering === "object" ? metadata.rendering : null;
    const quality = metadata?.quality && typeof metadata.quality === "object" ? metadata.quality : null;
    const delivery = metadata?.delivery && typeof metadata.delivery === "object" ? metadata.delivery : null;
    const warnings = Array.isArray(quality?.warnings) ? quality.warnings : [];

    const viewerUrl = normalizeEnvironmentString(urls?.viewer) || normalizeEnvironmentString(rendering?.viewer_source);
    const splatUrl = normalizeEnvironmentString(urls?.splats);
    const truthLabel = normalizeEnvironmentString(metadata?.truth_label).toLowerCase();
    const qualityTier = normalizeEnvironmentString(metadata?.quality_tier).toLowerCase();
    const sourceFormat = normalizeEnvironmentString(rendering?.source_format).toLowerCase();
    const isSingleImagePreview =
        normalizeEnvironmentString(metadata?.lane).toLowerCase() === "preview" &&
        (qualityTier.includes("single_image_preview") || sourceFormat.includes("dense_preview") || truthLabel === "instant preview");
    const sourceInputImage =
        deriveStorageUrlFromAbsolutePath(metadata?.input_image) || normalizeEnvironmentString(metadata?.input_image);
    const previewProjectionImage =
        normalizeEnvironmentString(urls?.preview_projection) ||
        normalizeEnvironmentString(metadata?.preview_projection) ||
        (isSingleImagePreview ? sourceInputImage : "");
    const referenceImage =
        normalizeEnvironmentString(environment?.demo_reference_image) ||
        previewProjectionImage ||
        normalizeEnvironmentString(metadata?.reference_image) ||
        sourceInputImage ||
        normalizeEnvironmentString(environment?.previewImage) ||
        "";
    const hasRenderableOutput = Boolean(splatUrl || viewerUrl);
    const isReferenceOnlyDemo =
        Boolean(referenceImage) &&
        !hasRenderableOutput &&
        (Boolean(normalizeEnvironmentString(environment?.demo_reference_image)) ||
            containsReferenceOnlyFlag(metadata?.truth_label) ||
            normalizeEnvironmentString(quality?.band).toLowerCase() === "reference_only" ||
            containsReferenceOnlyFlag(delivery?.label) ||
            warnings.some((warning: string) => containsReferenceOnlyFlag(warning)));
    const isLegacyDemoWorld =
        Boolean(referenceImage) &&
        !hasRenderableOutput &&
        !isReferenceOnlyDemo &&
        (/demo world/i.test(normalizeEnvironmentString(environment?.statusLabel)) ||
            /demo world/i.test(normalizeEnvironmentString(environment?.label)));

    return {
        viewerUrl,
        splatUrl,
        previewProjectionImage: previewProjectionImage || null,
        referenceImage: referenceImage || null,
        hasRenderableOutput,
        isReferenceOnlyDemo,
        isLegacyDemoWorld,
    };
}

type LegacySetupStatusResponse = SetupStatusResponse & {
    storage_mode?: string;
    generator?: {
        environment?: string;
        asset?: string;
        reconstruction?: string;
    };
};

function inferLaneAvailability(payload: LegacySetupStatusResponse, lane: "preview" | "reconstruction" | "asset") {
    const explicit = payload.capabilities?.[lane]?.available;
    if (typeof explicit === "boolean") {
        return explicit;
    }

    if (lane === "preview") {
        return Boolean(payload.models?.preview_generator ?? payload.generator?.environment ?? payload.models?.ml_sharp);
    }
    if (lane === "asset") {
        return Boolean(payload.models?.asset_generator ?? payload.generator?.asset ?? payload.models?.triposr);
    }
    return Boolean(payload.models?.reconstruction_generator ?? payload.generator?.reconstruction);
}

export function normalizeSetupStatus(raw: unknown): SetupStatusResponse {
    const payload = (raw && typeof raw === "object" ? raw : {}) as LegacySetupStatusResponse;
    const previewAvailable = inferLaneAvailability(payload, "preview");
    const reconstructionAvailable = inferLaneAvailability(payload, "reconstruction");
    const assetAvailable = inferLaneAvailability(payload, "asset");

    const backendTruth =
        payload.backend?.truth ??
        (previewAvailable && assetAvailable && reconstructionAvailable
            ? "Preview, reconstruction, and asset generation lanes are available."
            : previewAvailable && assetAvailable
              ? "Single-photo preview and asset generation are available. Multi-view reconstruction is not connected in this backend."
              : previewAvailable
                ? "Single-photo preview is available in this backend."
                : assetAvailable
                  ? "Single-image asset generation is available in this backend."
                  : reconstructionAvailable
                    ? "Capture-based reconstruction is available in this backend."
                    : undefined);

    return {
        ...payload,
        backend: {
            label:
                payload.backend?.label ??
                (payload.storage_mode === "vercel" ? "Production Preview Backend" : "Generation Backend"),
            kind: payload.backend?.kind ?? payload.storage_mode ?? "generation",
            deployment: payload.backend?.deployment ?? payload.storage_mode,
            truth: backendTruth,
            lane_truth: payload.backend?.lane_truth,
        },
        lane_truth: payload.lane_truth,
        reconstruction_backend: payload.reconstruction_backend,
        benchmark_status: payload.benchmark_status,
        release_gates: payload.release_gates,
        capabilities: {
            preview: {
                available: previewAvailable,
                label: payload.capabilities?.preview?.label ?? "Instant Preview",
                summary: payload.capabilities?.preview?.summary ?? "Generate a single-photo Gaussian preview for nearby camera moves.",
                truth: payload.capabilities?.preview?.truth ?? "This is a synthesized preview, not a faithful multi-view reconstruction.",
                lane_truth: payload.capabilities?.preview?.lane_truth,
                input_strategy: payload.capabilities?.preview?.input_strategy ?? "1 photo",
                min_images: payload.capabilities?.preview?.min_images ?? 1,
                recommended_images: payload.capabilities?.preview?.recommended_images ?? 1,
            },
            reconstruction: {
                available: reconstructionAvailable,
                label: payload.capabilities?.reconstruction?.label ?? "Production Reconstruction",
                summary:
                    payload.capabilities?.reconstruction?.summary ??
                    "Collect a multi-view capture set and reconstruct a faithful scene.",
                truth:
                    payload.capabilities?.reconstruction?.truth ??
                    "This lane requires overlapping captures and a dedicated reconstruction worker.",
                lane_truth: payload.capabilities?.reconstruction?.lane_truth,
                input_strategy: payload.capabilities?.reconstruction?.input_strategy ?? "8-32 overlapping photos or short orbit video",
                min_images: payload.capabilities?.reconstruction?.min_images ?? payload.capture?.minimum_images ?? 8,
                recommended_images:
                    payload.capabilities?.reconstruction?.recommended_images ?? payload.capture?.recommended_images ?? 12,
            },
            asset: {
                available: assetAvailable,
                label: payload.capabilities?.asset?.label ?? "Single-Image Asset",
                summary: payload.capabilities?.asset?.summary ?? "Generate a hero prop mesh from one reference image.",
                truth: payload.capabilities?.asset?.truth ?? "This lane is object-focused generation, not environment reconstruction.",
                lane_truth: payload.capabilities?.asset?.lane_truth,
                input_strategy: payload.capabilities?.asset?.input_strategy ?? "1 photo",
                min_images: payload.capabilities?.asset?.min_images ?? 1,
                recommended_images: payload.capabilities?.asset?.recommended_images ?? 1,
            },
        },
        directories: {
            uploads: payload.directories?.uploads ?? true,
            assets: payload.directories?.assets ?? true,
            scenes: payload.directories?.scenes ?? true,
        },
    };
}

export function describeEnvironment(environment: any) {
    const lane = typeof environment?.lane === "string" ? environment.lane : environment?.metadata?.lane;
    const renderState = resolveEnvironmentRenderState(environment);
    const laneTruth =
        typeof environment?.metadata?.lane_truth === "string" ? environment.metadata.lane_truth.replaceAll("_", " ") : null;
    const reconstructionStatus =
        typeof environment?.metadata?.reconstruction_status === "string"
            ? environment.metadata.reconstruction_status.replaceAll("_", " ")
            : null;
    const qualityBand =
        typeof environment?.metadata?.quality?.band === "string"
            ? environment.metadata.quality.band.replaceAll("_", " ")
            : null;
    const deliveryLabel =
        typeof environment?.metadata?.delivery?.label === "string" ? environment.metadata.delivery.label : null;
    const colorEncoding =
        typeof environment?.metadata?.rendering?.color_encoding === "string" ? environment.metadata.rendering.color_encoding : null;
    const previewIsLrm =
        lane === "preview" &&
        (typeof environment?.metadata?.training_backend === "string"
            ? environment.metadata.training_backend === "ml_sharp_gpu_worker"
            : typeof environment?.metadata?.rendering?.source_format === "string" &&
              environment.metadata.rendering.source_format === "sharp_ply_dense_preview");
    const legacyStatusLabel = normalizeEnvironmentString(environment?.statusLabel);
    const legacyLabel = normalizeEnvironmentString(environment?.label);
    const label =
        renderState.isReferenceOnlyDemo
            ? "Reference-only Demo"
            : renderState.isLegacyDemoWorld
              ? legacyStatusLabel || legacyLabel || "Demo World Loaded"
            : lane === "reconstruction"
            ? environment?.metadata?.release_gates?.world_class_ready
                ? "Benchmarked Reconstruction Loaded"
                : "Hybrid Reconstruction Loaded"
            : lane === "preview"
              ? previewIsLrm
                  ? "Image-to-Splat Preview Loaded"
                  : "Preview Loaded"
              : environment
                ? "Environment Loaded"
                : "Awaiting Environment";
    const badge =
        renderState.isReferenceOnlyDemo || renderState.isLegacyDemoWorld
            ? "DEMO"
        : lane === "reconstruction"
            ? environment?.metadata?.release_gates?.world_class_ready
                ? "3DGS"
                : "HYBRID"
            : lane === "preview"
              ? "PREVIEW"
              : "ENV";
    const note =
        renderState.isReferenceOnlyDemo
            ? "Reference-only onboarding state"
        : renderState.isLegacyDemoWorld
          ? "Legacy demo world state"
        : lane === "reconstruction"
            ? environment?.metadata?.release_gates?.world_class_ready
                ? "Benchmarked multi-view reconstruction"
                : "Hybrid local reconstruction"
            : lane === "preview"
              ? previewIsLrm
                  ? "Single-photo AI splat preview"
                  : "Single-photo synthesized preview"
              : "No environment yet";
    const detailParts: string[] = [];
    if (laneTruth) {
        detailParts.push(laneTruth);
    }
    if (reconstructionStatus) {
        detailParts.push(reconstructionStatus);
    }
    if (deliveryLabel) {
        detailParts.push(deliveryLabel);
    }
    if (qualityBand) {
        detailParts.push(qualityBand);
    }
    if (colorEncoding === "sh_dc_rgb") {
        detailParts.push("colorized from SH coefficients");
    }
    return {
        lane: lane === "reconstruction" ? "reconstruction" : lane === "preview" ? "preview" : null,
        label,
        badge,
        note,
        detail: detailParts.join(" · "),
    };
}
