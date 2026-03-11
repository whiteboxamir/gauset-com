"use client";

import type { GeneratedEnvironmentMetadata } from "@/lib/mvp-product";

const REAL_SPLAT_RENDERERS = new Set(["luma", "luma_web", "luma_capture", "luma_splats"]);
const SHARP_GAUSSIAN_RENDERERS = new Set(["sharp_gaussian_direct", "ply_gaussian_fallback", "sharp_ply"]);

export type EnvironmentRenderSourceMode = "luma" | "sharp" | "none";
export type ViewerFallbackReason =
    | "webgl_unavailable"
    | "webgl2_required"
    | "ext_color_buffer_float_required"
    | "texture_size_exceeded"
    | "context_lost"
    | "environment_render_failed";

export interface EnvironmentRenderSource {
    mode: EnvironmentRenderSourceMode;
    source: string;
}

export interface ViewerCapabilities {
    webglSupported: boolean;
    webgl2Supported: boolean;
    extColorBufferFloatSupported: boolean;
    maxTextureSize: number | null;
}

export interface ViewerCapabilityDecision {
    capabilities: ViewerCapabilities;
    renderSource: EnvironmentRenderSource;
    renderMode: "webgl" | "fallback";
    fallbackReason: ViewerFallbackReason | null;
    fallbackMessage: string;
}

let cachedViewerCapabilities: ViewerCapabilities | null = null;

function createDefaultViewerCapabilities(): ViewerCapabilities {
    return {
        webglSupported: true,
        webgl2Supported: true,
        extColorBufferFloatSupported: true,
        maxTextureSize: null,
    };
}

export function isLikelyLumaSource(source: string) {
    return /lumalabs\.ai\/capture\//i.test(source) || /\.(ksplat|splat)(\?.*)?$/i.test(source);
}

export function isSingleImagePreviewMetadata(metadata?: GeneratedEnvironmentMetadata | null) {
    const lane = String(metadata?.lane ?? "").trim().toLowerCase();
    const qualityTier = String(metadata?.quality_tier ?? "").trim().toLowerCase();
    const truthLabel = String(metadata?.truth_label ?? "").trim().toLowerCase();
    const sourceFormat = String(metadata?.rendering?.source_format ?? "").trim().toLowerCase();

    return (
        lane === "preview" &&
        (qualityTier.includes("single_image_preview") || sourceFormat.includes("dense_preview") || truthLabel === "instant preview")
    );
}

export function resolveEnvironmentRenderSource({
    plyUrl,
    viewerUrl,
    metadata,
}: {
    plyUrl?: string | null;
    viewerUrl?: string | null;
    metadata?: GeneratedEnvironmentMetadata | null;
}): EnvironmentRenderSource {
    const rendering = metadata?.rendering;
    const explicitRenderer = String(rendering?.viewer_renderer ?? "").trim().toLowerCase();
    const explicitSource = String(rendering?.viewer_source ?? "").trim();
    const preferredViewerSource = String(viewerUrl ?? explicitSource).trim();
    const preferredPlySource = String(plyUrl ?? "").trim();
    const isSingleImagePreview = isSingleImagePreviewMetadata(metadata);

    if (isSingleImagePreview && preferredPlySource) {
        return { mode: "sharp", source: preferredPlySource };
    }

    if (isSingleImagePreview) {
        return { mode: "none", source: "" };
    }

    if (preferredViewerSource && (REAL_SPLAT_RENDERERS.has(explicitRenderer) || isLikelyLumaSource(preferredViewerSource))) {
        return { mode: "luma", source: preferredViewerSource };
    }

    if (preferredPlySource && (REAL_SPLAT_RENDERERS.has(explicitRenderer) || isLikelyLumaSource(preferredPlySource))) {
        return { mode: "luma", source: preferredPlySource };
    }

    if (preferredPlySource && (SHARP_GAUSSIAN_RENDERERS.has(explicitRenderer) || explicitRenderer === "")) {
        return { mode: "sharp", source: preferredPlySource };
    }

    if (preferredPlySource) {
        return { mode: "sharp", source: preferredPlySource };
    }

    if (preferredViewerSource) {
        return { mode: "luma", source: preferredViewerSource };
    }

    return { mode: "none", source: "" };
}

export function probeViewerCapabilities() {
    if (cachedViewerCapabilities) {
        return cachedViewerCapabilities;
    }

    if (typeof document === "undefined") {
        return createDefaultViewerCapabilities();
    }

    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;

    const webgl2 = canvas.getContext("webgl2", { powerPreference: "high-performance" }) as WebGL2RenderingContext | null;
    const webgl =
        webgl2 ??
        (canvas.getContext("webgl", { powerPreference: "high-performance" }) as WebGLRenderingContext | null) ??
        (canvas.getContext("experimental-webgl", {
            powerPreference: "high-performance",
        }) as WebGLRenderingContext | null);
    const maxTextureSize = webgl ? Number(webgl.getParameter(webgl.MAX_TEXTURE_SIZE) ?? NaN) : NaN;

    cachedViewerCapabilities = {
        webglSupported: Boolean(webgl),
        webgl2Supported: Boolean(webgl2),
        extColorBufferFloatSupported: Boolean(webgl2?.getExtension("EXT_color_buffer_float")),
        maxTextureSize: Number.isFinite(maxTextureSize) && maxTextureSize > 0 ? maxTextureSize : null,
    };

    return cachedViewerCapabilities;
}

function createFallbackDecision(
    capabilities: ViewerCapabilities,
    renderSource: EnvironmentRenderSource,
    fallbackReason: ViewerFallbackReason,
    fallbackMessage: string,
): ViewerCapabilityDecision {
    return {
        capabilities,
        renderSource,
        renderMode: "fallback",
        fallbackReason,
        fallbackMessage,
    };
}

export function resolveViewerCapabilities({
    plyUrl,
    viewerUrl,
    metadata,
    capabilities = probeViewerCapabilities(),
}: {
    plyUrl?: string | null;
    viewerUrl?: string | null;
    metadata?: GeneratedEnvironmentMetadata | null;
    capabilities?: ViewerCapabilities;
}): ViewerCapabilityDecision {
    const renderSource = resolveEnvironmentRenderSource({ plyUrl, viewerUrl, metadata });

    if (!capabilities.webglSupported) {
        return createFallbackDecision(
            capabilities,
            renderSource,
            "webgl_unavailable",
            "WebGL could not be initialized in this environment.",
        );
    }

    if (renderSource.mode === "sharp" && !capabilities.webgl2Supported) {
        return createFallbackDecision(
            capabilities,
            renderSource,
            "webgl2_required",
            "This device does not expose WebGL2, so the sharp splat renderer cannot start.",
        );
    }

    if (renderSource.mode === "sharp" && !capabilities.extColorBufferFloatSupported) {
        return createFallbackDecision(
            capabilities,
            renderSource,
            "ext_color_buffer_float_required",
            "This device is missing EXT_color_buffer_float, so the sharp splat renderer cannot start.",
        );
    }

    return {
        capabilities,
        renderSource,
        renderMode: "webgl",
        fallbackReason: null,
        fallbackMessage: "",
    };
}

export function classifyViewerFailure(message: string): ViewerFallbackReason {
    const normalized = message.trim().toLowerCase();

    if (normalized.includes("texture size")) {
        return "texture_size_exceeded";
    }
    if (normalized.includes("context was lost")) {
        return "context_lost";
    }
    return "environment_render_failed";
}

export function clearViewerCapabilityCache() {
    cachedViewerCapabilities = null;
}
