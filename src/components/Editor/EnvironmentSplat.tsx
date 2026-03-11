"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { LumaSplatsLoader, LumaSplatsThree } from "@lumaai/luma-web";
import * as THREE from "three";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import type { GeneratedEnvironmentMetadata } from "@/lib/mvp-product";
import { classifyViewerFailure, isSingleImagePreviewMetadata, resolveEnvironmentRenderSource, ViewerFallbackReason } from "@/lib/mvp-viewer";
import { SharpGaussianGpuSorter } from "./sharpGaussianGpuSort";

const SH_REST_COMPONENT_COUNT = 45;
const SH_MAX_BASIS_COUNT = SH_REST_COMPONENT_COUNT / 3;
const SH_C0 = 0.28209479177387814;
const TARGET_POINTS_PER_CHUNK = 16384;
const MAX_POINTS_PER_CHUNK = 32768;
const MAX_CHUNK_OCTREE_LEVEL = 6;
const PREVIEW_INTERACTION_POINT_BUDGET = 900_000;
const PREVIEW_INTERACTION_MAX_AXIS_PX = 56;
const PREVIEW_REST_MAX_AXIS_PX = 96;
const PREVIEW_SORT_THRESHOLD_MULTIPLIER = 2.5;
const PREVIEW_ORIENTATION_QUATERNION = new THREE.Quaternion(1, 0, 0, 0);
const DENSE_PREVIEW_POINT_BUDGET_HIGH_CAPABILITY = 2_000_000;
const DENSE_PREVIEW_POINT_BUDGET_DESKTOP = 1_500_000;
const DENSE_PREVIEW_POINT_BUDGET_LOW_MEMORY = 900_000;
const STANDARD_PREVIEW_POINT_BUDGET_HIGH_CAPABILITY = 1_500_000;
const STANDARD_PREVIEW_POINT_BUDGET_DESKTOP = 1_250_000;
const STANDARD_PREVIEW_POINT_BUDGET_LOW_MEMORY = 750_000;
const SHARP_PLY_CUSTOM_ATTRIBUTES = {
    shColor: ["f_dc_0", "f_dc_1", "f_dc_2"],
    splatShRest: Array.from({ length: SH_REST_COMPONENT_COUNT }, (_, index) => `f_rest_${index}`),
    splatOpacity: ["opacity"],
    splatScale: ["scale_0", "scale_1", "scale_2"],
    splatRotation: ["rot_0", "rot_1", "rot_2", "rot_3"],
};
const fallbackSplatColor = new THREE.Color("#8ad4ff");
const DIRECT_SORT_POSITION_EPSILON_SQ = 0.0001;
const DIRECT_SORT_ROTATION_EPSILON = 0.00004;
const DIRECT_ORDER_CULL_SENTINEL = 65504;
const DIRECT_GAUSSIAN_VERTEX_SHADER = `
precision highp float;
precision highp int;

in vec2 corner;

uniform sampler2D uCenterAlphaTexture;
uniform sampler2D uColorTexture;
uniform sampler2D uScaleTexture;
uniform sampler2D uRotationTexture;
uniform sampler2D uOrderTexture;
uniform vec2 uTextureSize;
uniform vec2 uOrderTextureSize;
uniform vec2 uViewport;
uniform float uCovarianceScale;
uniform float uMinAxisPx;
uniform float uMaxAxisPx;
uniform float uOrderTextureReady;
uniform float uCullSentinel;

flat out vec3 vColorPayload;
flat out float vAlpha;
flat out vec3 vViewDirection;
flat out ivec2 vTextureCoords;
out vec2 vLocalCoord;

ivec2 textureCoordsForIndex(uint index, vec2 textureSize) {
    uint width = uint(textureSize.x + 0.5);
    return ivec2(int(index % width), int(index / width));
}

mat3 quatToMat3(vec4 q) {
    vec4 nq = normalize(q);
    float x = nq.x;
    float y = nq.y;
    float z = nq.z;
    float w = nq.w;
    float xx = x * x;
    float yy = y * y;
    float zz = z * z;
    float xy = x * y;
    float xz = x * z;
    float yz = y * z;
    float wx = w * x;
    float wy = w * y;
    float wz = w * z;

    return mat3(
        1.0 - 2.0 * (yy + zz), 2.0 * (xy + wz), 2.0 * (xz - wy),
        2.0 * (xy - wz), 1.0 - 2.0 * (xx + zz), 2.0 * (yz + wx),
        2.0 * (xz + wy), 2.0 * (yz - wx), 1.0 - 2.0 * (xx + yy)
    );
}

void main() {
    uint payloadIndex = uint(gl_InstanceID);

    if (uOrderTextureReady > 0.5) {
        ivec2 orderCoords = textureCoordsForIndex(payloadIndex, uOrderTextureSize);
        vec4 orderPair = texelFetch(uOrderTexture, orderCoords, 0);

        if (orderPair.x >= uCullSentinel * 0.5) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            vColorPayload = vec3(0.0);
            vAlpha = 0.0;
            vViewDirection = vec3(0.0, 0.0, 1.0);
            vTextureCoords = ivec2(0);
            vLocalCoord = vec2(0.0);
            return;
        }

        payloadIndex = uint(orderPair.y + 0.5);
    }

    ivec2 coords = textureCoordsForIndex(payloadIndex, uTextureSize);
    vec4 centerAlpha = texelFetch(uCenterAlphaTexture, coords, 0);
    vec4 colorData = texelFetch(uColorTexture, coords, 0);
    vec4 scaleData = texelFetch(uScaleTexture, coords, 0);
    vec4 rotationData = texelFetch(uRotationTexture, coords, 0);

    vec3 instanceCenter = centerAlpha.xyz;
    float instanceAlpha = centerAlpha.w;
    vec3 instanceColor = colorData.rgb;
    vec3 instanceScale = scaleData.xyz;
    vec4 instanceRotation = rotationData;

    vec4 mvCenter4 = modelViewMatrix * vec4(instanceCenter, 1.0);
    vec3 mvCenter = mvCenter4.xyz;
    float depth = max(-mvCenter.z, 0.001);

    mat3 rotation = quatToMat3(instanceRotation);
    mat3 scaleMatrix = mat3(
        instanceScale.x, 0.0, 0.0,
        0.0, instanceScale.y, 0.0,
        0.0, 0.0, instanceScale.z
    );
    mat3 covarianceView = mat3(modelViewMatrix) * rotation * scaleMatrix * scaleMatrix * transpose(rotation) * transpose(mat3(modelViewMatrix));

    float fx = projectionMatrix[0][0] * 0.5 * uViewport.x;
    float fy = projectionMatrix[1][1] * 0.5 * uViewport.y;
    float x = mvCenter.x;
    float y = mvCenter.y;
    float z = depth;

    mat3 jacobian = mat3(
        fx / z, 0.0, -(fx * x) / (z * z),
        0.0, fy / z, -(fy * y) / (z * z),
        0.0, 0.0, 0.0
    );

    mat3 covariance2D = jacobian * covarianceView * transpose(jacobian);
    float covarianceXX = covariance2D[0][0] + 0.005;
    float covarianceXY = covariance2D[0][1];
    float covarianceYY = covariance2D[1][1] + 0.005;

    float trace = covarianceXX + covarianceYY;
    float determinant = max((covarianceXX * covarianceYY) - (covarianceXY * covarianceXY), 0.0);
    float discriminant = sqrt(max((trace * trace * 0.25) - determinant, 0.0));
    float lambdaMajor = max((trace * 0.5) + discriminant, 1e-5);
    float lambdaMinor = max((trace * 0.5) - discriminant, 1e-5);

    vec2 axisDirection = abs(covarianceXY) > 1e-6
        ? normalize(vec2(lambdaMajor - covarianceYY, covarianceXY))
        : vec2(1.0, 0.0);
    vec2 perpendicularDirection = vec2(-axisDirection.y, axisDirection.x);
    vec2 majorAxis = axisDirection * clamp(sqrt(lambdaMajor) * uCovarianceScale, uMinAxisPx, uMaxAxisPx);
    vec2 minorAxis = perpendicularDirection * clamp(sqrt(lambdaMinor) * uCovarianceScale, uMinAxisPx, uMaxAxisPx);

    vec2 pixelOffset = (corner.x * majorAxis) + (corner.y * minorAxis);
    vec2 ndcOffset = pixelOffset / vec2(0.5 * uViewport.x, 0.5 * uViewport.y);
    vec4 clipCenter = projectionMatrix * mvCenter4;
    vec3 ndcCenter = clipCenter.xyz / max(clipCenter.w, 1e-6);

    if (clipCenter.w <= 0.0 || abs(ndcCenter.x) > 1.02 || abs(ndcCenter.y) > 1.02 || ndcCenter.z < -1.0 || ndcCenter.z > 1.0) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        vColorPayload = vec3(0.0);
        vAlpha = 0.0;
        vViewDirection = vec3(0.0, 0.0, 1.0);
        vTextureCoords = coords;
        vLocalCoord = vec2(0.0);
        return;
    }

    gl_Position = clipCenter;
    gl_Position.xy += ndcOffset * clipCenter.w;

    vec3 worldCenter = (modelMatrix * vec4(instanceCenter, 1.0)).xyz;

    vColorPayload = instanceColor;
    vAlpha = instanceAlpha;
    vViewDirection = normalize(cameraPosition - worldCenter);
    vTextureCoords = coords;
    vLocalCoord = corner;
}
`;
const DIRECT_GAUSSIAN_FRAGMENT_SHADER = `
precision highp float;
precision highp int;
precision highp sampler2DArray;

uniform float uOpacityBoost;
uniform float uColorGain;
uniform float uColorPayloadIsLinear;
uniform float uColorPayloadIsSHDC;
uniform float uHasSphericalHarmonics;
uniform int uShBasisCount;
uniform sampler2DArray uShTexture;

flat in vec3 vColorPayload;
flat in float vAlpha;
flat in vec3 vViewDirection;
flat in ivec2 vTextureCoords;
in vec2 vLocalCoord;

out vec4 outColor;

float shComponent(int componentIndex) {
    int layer = componentIndex / 4;
    int lane = componentIndex - (layer * 4);
    vec4 packed = texelFetch(uShTexture, ivec3(vTextureCoords, layer), 0);

    if (lane == 0) {
        return packed.x;
    }
    if (lane == 1) {
        return packed.y;
    }
    if (lane == 2) {
        return packed.z;
    }
    return packed.w;
}

vec3 shBasisCoefficient(int basisIndex) {
    int baseIndex = basisIndex * 3;
    return vec3(
        shComponent(baseIndex + 0),
        shComponent(baseIndex + 1),
        shComponent(baseIndex + 2)
    );
}

vec3 linearToSrgb(vec3 linearColor) {
    vec3 clampedColor = clamp(linearColor, 0.0, 1.0);
    vec3 low = clampedColor * 12.92;
    vec3 high = 1.055 * pow(clampedColor, vec3(1.0 / 2.4)) - 0.055;
    bvec3 cutoff = lessThanEqual(clampedColor, vec3(0.0031308));
    return vec3(
        cutoff.x ? low.x : high.x,
        cutoff.y ? low.y : high.y,
        cutoff.z ? low.z : high.z
    );
}

vec3 decodeBaseAlbedo() {
    if (uColorPayloadIsSHDC > 0.5) {
        return max(vColorPayload * ${SH_C0} + vec3(0.5), vec3(0.0));
    }

    vec3 color = max(vColorPayload, vec3(0.0));
    if (uColorPayloadIsLinear > 0.5) {
        return linearToSrgb(color);
    }

    return clamp(color, 0.0, 1.0);
}

vec3 evaluateViewDependentColor() {
    vec3 color = decodeBaseAlbedo();

    if (uColorPayloadIsSHDC > 0.5 && uHasSphericalHarmonics > 0.5) {
        vec3 dir = normalize(vViewDirection);
        float x = dir.x;
        float y = dir.y;
        float z = dir.z;

        if (uShBasisCount > 0) color += (-0.4886025119029199 * y) * shBasisCoefficient(0);
        if (uShBasisCount > 1) color += (0.4886025119029199 * z) * shBasisCoefficient(1);
        if (uShBasisCount > 2) color += (-0.4886025119029199 * x) * shBasisCoefficient(2);

        if (uShBasisCount > 3) color += (1.0925484305920792 * x * y) * shBasisCoefficient(3);
        if (uShBasisCount > 4) color += (-1.0925484305920792 * y * z) * shBasisCoefficient(4);
        if (uShBasisCount > 5) color += (0.31539156525252005 * (3.0 * z * z - 1.0)) * shBasisCoefficient(5);
        if (uShBasisCount > 6) color += (-1.0925484305920792 * x * z) * shBasisCoefficient(6);
        if (uShBasisCount > 7) color += (0.5462742152960396 * (x * x - y * y)) * shBasisCoefficient(7);

        if (uShBasisCount > 8) color += (-0.5900435899266435 * y * (3.0 * x * x - y * y)) * shBasisCoefficient(8);
        if (uShBasisCount > 9) color += (2.890611442640554 * x * y * z) * shBasisCoefficient(9);
        if (uShBasisCount > 10) color += (-0.4570457994644658 * y * (5.0 * z * z - 1.0)) * shBasisCoefficient(10);
        if (uShBasisCount > 11) color += (0.3731763325901154 * z * (5.0 * z * z - 3.0)) * shBasisCoefficient(11);
        if (uShBasisCount > 12) color += (-0.4570457994644658 * x * (5.0 * z * z - 1.0)) * shBasisCoefficient(12);
        if (uShBasisCount > 13) color += (1.445305721320277 * z * (x * x - y * y)) * shBasisCoefficient(13);
        if (uShBasisCount > 14) color += (-0.5900435899266435 * x * (x * x - 3.0 * y * y)) * shBasisCoefficient(14);
    }

    return max(color, vec3(0.0));
}

void main() {
    float radiusSquared = dot(vLocalCoord, vLocalCoord);
    if (radiusSquared > 1.0) {
        discard;
    }

    float gaussian = exp(-8.0 * radiusSquared);
    float edgeFade = 1.0 - smoothstep(0.96, 1.0, radiusSquared);
    float alpha = clamp(vAlpha * uOpacityBoost * gaussian * edgeFade, 0.0, 1.0);

    if (alpha < 0.002) {
        discard;
    }

    outColor = vec4(clamp(evaluateViewDependentColor() * uColorGain, 0.0, 1.0), alpha);
}
`;
type EnvironmentSplatProps = {
    plyUrl?: string | null;
    viewerUrl?: string | null;
    metadata?: GeneratedEnvironmentMetadata | null;
    onPreviewBounds?: (bounds: PreviewBounds) => void;
    onFatalError?: (message: string, reason: ViewerFallbackReason) => void;
};

type PreviewBounds = {
    center: [number, number, number];
    radius: number;
    forward?: [number, number, number];
};

type SharpGaussianChunk = {
    start: number;
    count: number;
    code: number;
    boundingBox: THREE.Box3;
    boundingSphere: THREE.Sphere;
};

type SharpGaussianOrderTexture = {
    texture: THREE.DataTexture;
    width: number;
    height: number;
    capacity: number;
    data: Float32Array;
};

type SharpGaussianPayload = {
    geometry: THREE.InstancedBufferGeometry;
    centerAlphaTexture: THREE.DataTexture;
    colorTexture: THREE.DataTexture;
    scaleTexture: THREE.DataTexture;
    rotationTexture: THREE.DataTexture;
    shTexture: THREE.DataArrayTexture;
    shTextureWidth: number;
    shTextureHeight: number;
    shTextureDepth: number;
    colorPayloadMode: "albedo_linear" | "albedo_srgb" | "sh_dc";
    shBasisCount: number;
    textureWidth: number;
    textureHeight: number;
    count: number;
    chunks: SharpGaussianChunk[];
    sceneRadius: number;
    previewFocus: {
        center: [number, number, number];
        radius: number;
        forward: [number, number, number];
    } | null;
    debugSamples: SharpGaussianDebugSample[];
};

type SerializedSharpGaussianChunk = {
    start: number;
    count: number;
    code: number;
    boundingBoxMin: [number, number, number];
    boundingBoxMax: [number, number, number];
    boundingSphereCenter: [number, number, number];
    boundingSphereRadius: number;
};

type SharpGaussianDebugSample = {
    sampleIndex: number;
    sourceIndex: number;
    position: [number, number, number];
    scale: [number, number, number];
    color: [number, number, number];
    colorPayloadMode: SharpGaussianPayload["colorPayloadMode"];
};

type SerializedSharpGaussianPayload = {
    centerAlphaData: Uint16Array;
    colorData: Uint16Array;
    scaleData: Uint16Array;
    rotationData: Uint16Array;
    shData: Uint16Array;
    shTextureWidth: number;
    shTextureHeight: number;
    shTextureDepth: number;
    colorPayloadMode: SharpGaussianPayload["colorPayloadMode"];
    shBasisCount: number;
    textureWidth: number;
    textureHeight: number;
    count: number;
    chunks: SerializedSharpGaussianChunk[];
    sceneRadius: number;
    boundingBoxMin: [number, number, number];
    boundingBoxMax: [number, number, number];
    boundingSphereCenter: [number, number, number];
    boundingSphereRadius: number;
    previewFocusCenter: [number, number, number];
    previewFocusRadius: number;
    previewFocusForward: [number, number, number];
    debugSamples: SharpGaussianDebugSample[];
};

type LumaSplatsThreeInternal = {
    lumaSplatsWebGL?: {
        enableEnd: boolean;
        maxSortAge: number;
        needsSort: boolean;
        sortAge: number;
        loader?: {
            streaming: boolean;
        };
        loadingAnimation: {
            enabled: boolean;
            particleRevealEnabled: boolean;
        };
        shaderParams: {
            tweakScale: number;
            loadR1: number;
            loadR2: number;
            revealR1: number;
            revealR2: number;
            solidR1: number;
            solidR2: number;
        };
    };
};

type NavigatorWithDeviceMemory = Navigator & {
    deviceMemory?: number;
};

function SplatStatusLabel({ text, tone = "loading" }: { text: string; tone?: "loading" | "error" }) {
    const borderClass = tone === "error" ? "border-rose-500/40 text-rose-200" : "border-neutral-700 text-neutral-300";
    return (
        <Html center>
            <div className={`rounded bg-neutral-950/85 px-3 py-1 text-xs ${borderClass} border`}>{text}</div>
        </Html>
    );
}

function clamp01(value: number) {
    return Math.min(1, Math.max(0, value));
}

function srgbByteOrUnitToUnit(value: number) {
    if (!Number.isFinite(value)) {
        return 0;
    }

    const normalized = value > 1 ? value / 255 : value;
    return clamp01(normalized);
}

function sigmoid(value: number) {
    return 1 / (1 + Math.exp(-value));
}

function isDenseFallbackPreviewMetadata(metadata?: GeneratedEnvironmentMetadata | null) {
    const qualityTier = String(metadata?.quality_tier ?? "").trim().toLowerCase();
    const sourceFormat = String(metadata?.rendering?.source_format ?? "").trim().toLowerCase();
    const sourceRenderer = String(metadata?.preview_enhancement?.source_renderer ?? "").trim().toLowerCase();

    return (
        qualityTier === "single_image_preview_dense_fallback" ||
        sourceFormat.includes("dense_preview_fallback") ||
        sourceRenderer === "gauset-depth-synth-fallback"
    );
}

function shouldApplyPreviewOrientation(metadata?: GeneratedEnvironmentMetadata | null) {
    if (typeof metadata?.rendering?.apply_preview_orientation === "boolean") {
        return metadata.rendering.apply_preview_orientation;
    }

    return isSingleImagePreviewMetadata(metadata);
}

function decodeSharpPlyHeader(source: ArrayBuffer) {
    const probeLength = Math.min(source.byteLength, 64 * 1024);
    const headerText = new TextDecoder("utf-8").decode(new Uint8Array(source, 0, probeLength));
    const headerEnd = headerText.indexOf("end_header");
    if (headerEnd === -1) {
        return "";
    }

    return headerText.slice(0, headerEnd + "end_header".length);
}

function resolveSharpPlyCustomPropertyMapping(source: ArrayBuffer) {
    const header = decodeSharpPlyHeader(source);
    const vertexProperties = new Set<string>();
    let insideVertexElement = false;

    for (const rawLine of header.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }

        if (line.startsWith("element ")) {
            insideVertexElement = /^element\s+vertex\s+\d+/i.test(line);
            continue;
        }

        if (!insideVertexElement || !line.startsWith("property ")) {
            continue;
        }

        const tokens = line.split(/\s+/);
        const propertyName = tokens[tokens.length - 1];
        if (propertyName) {
            vertexProperties.add(propertyName);
        }
    }

    const mapping: Record<string, string[]> = {};
    for (const [targetName, propertyNames] of Object.entries(SHARP_PLY_CUSTOM_ATTRIBUTES)) {
        const presentPropertyNames = propertyNames.filter((propertyName) => vertexProperties.has(propertyName));
        if (presentPropertyNames.length > 0) {
            mapping[targetName] = presentPropertyNames;
        }
    }

    return mapping;
}

function resolvePreviewSourcePointCount(metadata?: GeneratedEnvironmentMetadata | null) {
    const explicitSourceCount = Number(metadata?.preview_enhancement?.density?.source_count ?? NaN);
    if (Number.isFinite(explicitSourceCount) && explicitSourceCount > 0) {
        return explicitSourceCount;
    }

    const preferredPointBudget = Number(metadata?.delivery?.render_targets?.preferred_point_budget ?? metadata?.point_count ?? NaN);
    const previewDensityMultiplier = Number(
        metadata?.preview_enhancement?.density?.multiplier ?? metadata?.rendering?.preview_density_multiplier ?? NaN,
    );

    if (Number.isFinite(preferredPointBudget) && preferredPointBudget > 0 && Number.isFinite(previewDensityMultiplier) && previewDensityMultiplier > 1) {
        return Math.max(1, Math.round(preferredPointBudget / previewDensityMultiplier));
    }

    return null;
}

function resolveSharpPointBudget(
    metadata?: GeneratedEnvironmentMetadata | null,
    maxTextureSize?: number | null,
) {
    if (!isSingleImagePreviewMetadata(metadata)) {
        return Number.POSITIVE_INFINITY;
    }

    const deviceMemory =
        typeof navigator !== "undefined" && typeof (navigator as NavigatorWithDeviceMemory).deviceMemory === "number"
            ? (navigator as NavigatorWithDeviceMemory).deviceMemory ?? null
            : null;
    const hardwareConcurrency =
        typeof navigator !== "undefined" && typeof navigator.hardwareConcurrency === "number" ? navigator.hardwareConcurrency : null;
    const lowMemoryDevice = deviceMemory !== null && deviceMemory <= 4;
    const coarsePointerDevice = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
    const hasDenseShPreview = String(metadata?.rendering?.color_encoding ?? "").trim().toLowerCase() === "sh_dc_rgb";
    const hasDenseFallbackPreview = isDenseFallbackPreviewMetadata(metadata);
    const metadataBudget = Number(
        metadata?.delivery?.render_targets?.preferred_point_budget ?? metadata?.point_count ?? Number.POSITIVE_INFINITY,
    );
    const sourcePointCount = resolvePreviewSourcePointCount(metadata);
    const highCapabilityDevice =
        !coarsePointerDevice &&
        !lowMemoryDevice &&
        (deviceMemory === null || deviceMemory >= 8) &&
        (hardwareConcurrency === null || hardwareConcurrency >= 8) &&
        (maxTextureSize === null || maxTextureSize === undefined || maxTextureSize >= 8192);

    const budgetCap = hasDenseShPreview
        ? lowMemoryDevice || coarsePointerDevice
            ? DENSE_PREVIEW_POINT_BUDGET_LOW_MEMORY
            : highCapabilityDevice
              ? DENSE_PREVIEW_POINT_BUDGET_HIGH_CAPABILITY
              : DENSE_PREVIEW_POINT_BUDGET_DESKTOP
        : lowMemoryDevice || coarsePointerDevice
          ? STANDARD_PREVIEW_POINT_BUDGET_LOW_MEMORY
          : highCapabilityDevice
            ? STANDARD_PREVIEW_POINT_BUDGET_HIGH_CAPABILITY
            : STANDARD_PREVIEW_POINT_BUDGET_DESKTOP;

    if (hasDenseFallbackPreview && Number.isFinite(metadataBudget) && metadataBudget > 0) {
        return Math.min(metadataBudget, budgetCap);
    }

    if (sourcePointCount !== null) {
        const sourceScaledTarget =
            hasDenseShPreview && highCapabilityDevice
                ? Math.round(sourcePointCount * 1.7)
                : hasDenseShPreview
                  ? Math.round(sourcePointCount * 1.25)
                  : sourcePointCount;
        return Math.min(
            metadataBudget,
            Math.max(
                lowMemoryDevice || coarsePointerDevice ? Math.min(sourcePointCount, budgetCap) : sourcePointCount,
                Math.min(sourceScaledTarget, budgetCap),
            ),
        );
    }

    if (Number.isFinite(metadataBudget) && metadataBudget > 0) {
        return Math.min(metadataBudget, budgetCap);
    }

    return budgetCap;
}

function resolvePreviewOpacityBoost(metadata?: GeneratedEnvironmentMetadata | null) {
    if (!isSingleImagePreviewMetadata(metadata)) {
        return 1;
    }

    const liftedMeanLuma = Number(metadata?.preview_enhancement?.exposure?.mean_luma_after ?? NaN);

    if (isDenseFallbackPreviewMetadata(metadata)) {
        if (!Number.isFinite(liftedMeanLuma)) {
            return 1.16;
        }
        if (liftedMeanLuma < 0.38) {
            return 1.3;
        }
        if (liftedMeanLuma < 0.48) {
            return 1.2;
        }
        return 1.12;
    }

    if (!Number.isFinite(liftedMeanLuma)) {
        return 1.12;
    }
    if (liftedMeanLuma < 0.14) {
        return 1.7;
    }
    if (liftedMeanLuma < 0.22) {
        return 1.48;
    }
    if (liftedMeanLuma < 0.3) {
        return 1.28;
    }
    return 1.08;
}

function resolvePreviewColorGain(metadata?: GeneratedEnvironmentMetadata | null) {
    if (!isSingleImagePreviewMetadata(metadata)) {
        return 1;
    }

    const liftedMeanLuma = Number(metadata?.preview_enhancement?.exposure?.mean_luma_after ?? NaN);
    if (!Number.isFinite(liftedMeanLuma)) {
        return 1.05;
    }
    if (liftedMeanLuma < 0.12) {
        return 1.95;
    }
    if (liftedMeanLuma < 0.18) {
        return 1.65;
    }
    if (liftedMeanLuma < 0.28) {
        return 1.35;
    }
    if (liftedMeanLuma < 0.38) {
        return 1.15;
    }
    return 1;
}

function createSharpGaussianTexture(data: Uint16Array, width: number, height: number) {
    const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
    texture.colorSpace = THREE.NoColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.flipY = false;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    return texture;
}

function createSharpGaussianArrayTexture(data: Uint16Array, width: number, height: number, depth: number) {
    const texture = new THREE.DataArrayTexture(data, width, height, depth);
    texture.type = THREE.HalfFloatType;
    texture.format = THREE.RGBAFormat;
    texture.colorSpace = THREE.NoColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.flipY = false;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    return texture;
}

function createSharpGaussianOrderTexture(data: Float32Array, width: number, height: number) {
    const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
    texture.colorSpace = THREE.NoColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.flipY = false;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    return texture;
}

function resolveSharpGaussianOrderTextureSize(count: number) {
    const safeCount = Math.max(1, Math.ceil(count));
    const width = Math.max(1, Math.ceil(Math.sqrt(safeCount)));
    const height = Math.max(1, Math.ceil(safeCount / width));
    return {
        width,
        height,
        capacity: width * height,
    };
}

function createSharpGaussianOrderTexturePayload(activeIndices: Uint32Array, cullSentinel: number): SharpGaussianOrderTexture {
    const { width, height, capacity } = resolveSharpGaussianOrderTextureSize(activeIndices.length);
    const data = new Float32Array(capacity * 4);

    for (let index = 0; index < capacity; index += 1) {
        const baseOffset = index * 4;
        data[baseOffset + 0] = cullSentinel;
    }

    for (let index = 0; index < activeIndices.length; index += 1) {
        const baseOffset = index * 4;
        data[baseOffset + 0] = 0;
        data[baseOffset + 1] = activeIndices[index];
        data[baseOffset + 2] = 1;
    }

    const orderTexture = {
        texture: createSharpGaussianOrderTexture(data, width, height),
        width,
        height,
        capacity,
        data,
    };

    return orderTexture;
}

function syncSharpGaussianOrderTexturePayload(
    current: SharpGaussianOrderTexture | null,
    activeIndices: Uint32Array,
    cullSentinel: number,
) {
    const nextSize = resolveSharpGaussianOrderTextureSize(activeIndices.length);
    if (!current || current.capacity !== nextSize.capacity || current.width !== nextSize.width || current.height !== nextSize.height) {
        current?.texture.dispose();
        return createSharpGaussianOrderTexturePayload(activeIndices, cullSentinel);
    }

    current.data.fill(0);
    for (let index = 0; index < current.capacity; index += 1) {
        current.data[index * 4] = cullSentinel;
    }

    for (let index = 0; index < activeIndices.length; index += 1) {
        const baseOffset = index * 4;
        current.data[baseOffset + 0] = 0;
        current.data[baseOffset + 1] = activeIndices[index];
        current.data[baseOffset + 2] = 1;
    }

    current.texture.needsUpdate = true;
    return current;
}

type MutableBufferArray = THREE.BufferAttribute["array"];

function applyPreviewOrientationToSourceGeometry(sourceGeometry: THREE.BufferGeometry) {
    const position = sourceGeometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (position && position.itemSize >= 3) {
        const positionArray = position.array as MutableBufferArray;
        for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
            const offset = vertexIndex * position.itemSize;
            positionArray[offset + 1] = -Number(positionArray[offset + 1]);
            positionArray[offset + 2] = -Number(positionArray[offset + 2]);
        }
        position.needsUpdate = true;
    }

    const rotation = sourceGeometry.getAttribute("splatRotation") as THREE.BufferAttribute | undefined;
    if (rotation && rotation.itemSize >= 4) {
        const rotationArray = rotation.array as MutableBufferArray;
        const quaternion = new THREE.Quaternion();
        for (let vertexIndex = 0; vertexIndex < rotation.count; vertexIndex += 1) {
            const offset = vertexIndex * rotation.itemSize;
            quaternion.set(
                Number(rotationArray[offset + 0]),
                Number(rotationArray[offset + 1]),
                Number(rotationArray[offset + 2]),
                Number(rotationArray[offset + 3]),
            );
            quaternion.premultiply(PREVIEW_ORIENTATION_QUATERNION);
            rotationArray[offset + 0] = quaternion.x;
            rotationArray[offset + 1] = quaternion.y;
            rotationArray[offset + 2] = quaternion.z;
            rotationArray[offset + 3] = quaternion.w;
        }
        rotation.needsUpdate = true;
    }

    sourceGeometry.boundingBox = null;
    sourceGeometry.boundingSphere = null;
    sourceGeometry.computeBoundingBox();
    sourceGeometry.computeBoundingSphere();
}

function getFiniteAttributeComponentPrefix(attribute?: THREE.BufferAttribute, maxComponents = attribute?.itemSize ?? 0) {
    if (!attribute) {
        return 0;
    }

    const array = attribute.array as ArrayLike<number>;
    const sampleCount = Math.min(attribute.count, 16);
    const clampedComponentCount = Math.min(attribute.itemSize, maxComponents);

    for (let componentIndex = 0; componentIndex < clampedComponentCount; componentIndex += 1) {
        for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
            const value = Number(array[sampleIndex * attribute.itemSize + componentIndex]);
            if (!Number.isFinite(value)) {
                return componentIndex;
            }
        }
    }

    return clampedComponentCount;
}

function getFiniteAttributeRange(attribute?: THREE.BufferAttribute, maxComponents = attribute?.itemSize ?? 0) {
    if (!attribute) {
        return null;
    }

    const array = attribute.array as ArrayLike<number>;
    const componentCount = Math.min(attribute.itemSize, maxComponents);
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;

    for (let vertexIndex = 0; vertexIndex < attribute.count; vertexIndex += 1) {
        const baseOffset = vertexIndex * attribute.itemSize;
        for (let componentIndex = 0; componentIndex < componentCount; componentIndex += 1) {
            const value = Number(array[baseOffset + componentIndex]);
            if (!Number.isFinite(value)) {
                continue;
            }
            min = Math.min(min, value);
            max = Math.max(max, value);
        }
    }

    if (!Number.isFinite(min) || !Number.isFinite(max)) {
        return null;
    }

    return { min, max };
}

function inferSharpGaussianColorPayloadMode(
    baseColor: THREE.BufferAttribute | undefined,
    shColor: THREE.BufferAttribute | undefined,
    metadata?: GeneratedEnvironmentMetadata | null,
) {
    if (getFiniteAttributeComponentPrefix(baseColor, 3) >= 3) {
        return "albedo_linear" as const;
    }

    if (getFiniteAttributeComponentPrefix(shColor, 3) < 3) {
        return "albedo_linear" as const;
    }

    if (String(metadata?.rendering?.color_encoding ?? "").trim().toLowerCase() === "sh_dc_rgb") {
        return "sh_dc" as const;
    }

    const range = getFiniteAttributeRange(shColor, 3);
    if (!range) {
        return "albedo_linear" as const;
    }

    if (range.min < -0.01) {
        return "sh_dc" as const;
    }

    if (range.max <= 1.001 || range.max >= 4.0) {
        return "albedo_srgb" as const;
    }

    return "sh_dc" as const;
}

function createEmptySharpGaussianPayload(): SharpGaussianPayload {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.instanceCount = 0;
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute("corner", new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));

    return {
        geometry,
        centerAlphaTexture: createSharpGaussianTexture(new Uint16Array(4), 1, 1),
        colorTexture: createSharpGaussianTexture(new Uint16Array(4), 1, 1),
        scaleTexture: createSharpGaussianTexture(new Uint16Array(4), 1, 1),
        rotationTexture: createSharpGaussianTexture(new Uint16Array(4), 1, 1),
        shTexture: createSharpGaussianArrayTexture(new Uint16Array(4), 1, 1, 1),
        shTextureWidth: 1,
        shTextureHeight: 1,
        shTextureDepth: 1,
        colorPayloadMode: "albedo_linear" as const,
        shBasisCount: 0,
        textureWidth: 1,
        textureHeight: 1,
        count: 0,
        chunks: [],
        sceneRadius: 1,
        previewFocus: null,
        debugSamples: [],
    };
}

function resolveSharpChunkOctreeLevel(pointCount: number) {
    const targetChunkCount = Math.max(1, Math.ceil(pointCount / TARGET_POINTS_PER_CHUNK));
    let level = 0;
    let chunkCapacity = 1;

    while (level < MAX_CHUNK_OCTREE_LEVEL && chunkCapacity < targetChunkCount) {
        chunkCapacity *= 8;
        level += 1;
    }

    return level;
}

function computeSharpChunkBounds(sourceIndices: number[], positionArray: Float32Array) {
    const boundingBox = new THREE.Box3();
    const boundsMin = boundingBox.min;
    const boundsMax = boundingBox.max;

    boundsMin.set(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    boundsMax.set(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);

    for (let index = 0; index < sourceIndices.length; index += 1) {
        const sourceIndex = sourceIndices[index] * 3;
        const x = positionArray[sourceIndex + 0];
        const y = positionArray[sourceIndex + 1];
        const z = positionArray[sourceIndex + 2];
        boundsMin.x = Math.min(boundsMin.x, x);
        boundsMin.y = Math.min(boundsMin.y, y);
        boundsMin.z = Math.min(boundsMin.z, z);
        boundsMax.x = Math.max(boundsMax.x, x);
        boundsMax.y = Math.max(boundsMax.y, y);
        boundsMax.z = Math.max(boundsMax.z, z);
    }

    const boundingSphere = boundingBox.getBoundingSphere(new THREE.Sphere());
    return { boundingBox, boundingSphere };
}

function computeSharpChunkOctant(positionArray: Float32Array, sourceIndex: number, center: THREE.Vector3) {
    const offset = sourceIndex * 3;
    let octant = 0;

    if (positionArray[offset + 0] >= center.x) {
        octant |= 1;
    }
    if (positionArray[offset + 1] >= center.y) {
        octant |= 2;
    }
    if (positionArray[offset + 2] >= center.z) {
        octant |= 4;
    }

    return octant;
}

function computeSharpChunkBoundsForOctant(bounds: THREE.Box3, octant: number) {
    const childBounds = bounds.clone();
    const center = bounds.getCenter(new THREE.Vector3());

    if ((octant & 1) === 0) {
        childBounds.max.x = center.x;
    } else {
        childBounds.min.x = center.x;
    }
    if ((octant & 2) === 0) {
        childBounds.max.y = center.y;
    } else {
        childBounds.min.y = center.y;
    }
    if ((octant & 4) === 0) {
        childBounds.max.z = center.z;
    } else {
        childBounds.min.z = center.z;
    }

    return childBounds;
}

function appendSharpGaussianChunks(
    sourceIndices: number[],
    positionArray: Float32Array,
    bounds: THREE.Box3,
    level: number,
    code: number,
    target: Array<{ sourceIndices: number[]; code: number; boundingBox: THREE.Box3; boundingSphere: THREE.Sphere }>,
) {
    if (sourceIndices.length === 0) {
        return;
    }

    if (sourceIndices.length <= MAX_POINTS_PER_CHUNK || level >= MAX_CHUNK_OCTREE_LEVEL) {
        for (let start = 0; start < sourceIndices.length; start += MAX_POINTS_PER_CHUNK) {
            const chunkSourceIndices = sourceIndices.slice(start, start + MAX_POINTS_PER_CHUNK);
            const { boundingBox, boundingSphere } = computeSharpChunkBounds(chunkSourceIndices, positionArray);
            target.push({
                sourceIndices: chunkSourceIndices,
                code,
                boundingBox,
                boundingSphere,
            });
        }
        return;
    }

    const center = bounds.getCenter(new THREE.Vector3());
    const childBuckets = Array.from({ length: 8 }, () => [] as number[]);

    for (let index = 0; index < sourceIndices.length; index += 1) {
        const sourceIndex = sourceIndices[index];
        childBuckets[computeSharpChunkOctant(positionArray, sourceIndex, center)].push(sourceIndex);
    }

    for (let octant = 0; octant < childBuckets.length; octant += 1) {
        if (childBuckets[octant].length === 0) {
            continue;
        }

        appendSharpGaussianChunks(
            childBuckets[octant],
            positionArray,
            computeSharpChunkBoundsForOctant(bounds, octant),
            level + 1,
            (code << 3) | octant,
            target,
        );
    }
}

// Retained for local diagnostics while the worker path remains the production parser.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildSharpGaussianPayload(
    sourceGeometry: THREE.BufferGeometry,
    pointBudget: number,
    maxTextureSize: number,
    metadata?: GeneratedEnvironmentMetadata | null,
): SharpGaussianPayload {
    const position = sourceGeometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!position || position.itemSize < 3 || position.count === 0) {
        return createEmptySharpGaussianPayload();
    }

    if (shouldApplyPreviewOrientation(metadata)) {
        applyPreviewOrientationToSourceGeometry(sourceGeometry);
    }

    if (!sourceGeometry.boundingSphere) {
        sourceGeometry.computeBoundingSphere();
    }
    if (!sourceGeometry.boundingBox) {
        sourceGeometry.computeBoundingBox();
    }

    const totalCount = position.count;
    const sampledCount = Number.isFinite(pointBudget) ? Math.min(totalCount, Math.max(1, Math.round(pointBudget))) : totalCount;
    const textureWidth = Math.min(maxTextureSize, Math.max(1, Math.ceil(Math.sqrt(sampledCount))));
    const textureHeight = Math.ceil(sampledCount / textureWidth);

    if (textureHeight > maxTextureSize) {
        throw new Error(`Ultra splat renderer exceeded the available WebGL texture size (${maxTextureSize}).`);
    }

    const shColor = sourceGeometry.getAttribute("shColor") as THREE.BufferAttribute | undefined;
    const baseColor = sourceGeometry.getAttribute("color") as THREE.BufferAttribute | undefined;
    const shRest = sourceGeometry.getAttribute("splatShRest") as THREE.BufferAttribute | undefined;
    if (!sourceGeometry.getAttribute("splatAlpha")) {
        const opacity = sourceGeometry.getAttribute("splatOpacity") as THREE.BufferAttribute | undefined;
        const alphaValues = new Float32Array(totalCount);
        alphaValues.fill(0.92);
        if (opacity && opacity.itemSize >= 1) {
            const opacityArray = opacity.array as ArrayLike<number>;
            for (let index = 0; index < opacity.count; index += 1) {
                alphaValues[index] = clamp01(sigmoid(Number(opacityArray[index])));
            }
        }
        sourceGeometry.setAttribute("splatAlpha", new THREE.Float32BufferAttribute(alphaValues, 1));
    }

    const alpha = sourceGeometry.getAttribute("splatAlpha") as THREE.BufferAttribute | undefined;
    const scale = sourceGeometry.getAttribute("splatScale") as THREE.BufferAttribute | undefined;
    const rotation = sourceGeometry.getAttribute("splatRotation") as THREE.BufferAttribute | undefined;
    const positionArray = position.array as Float32Array;
    const colorPayloadMode = inferSharpGaussianColorPayloadMode(baseColor, shColor, metadata);
    const hasRawColorCoefficients = colorPayloadMode === "sh_dc";
    const shBasisCount = hasRawColorCoefficients
        ? Math.min(SH_MAX_BASIS_COUNT, Math.floor(getFiniteAttributeComponentPrefix(shRest, SH_REST_COMPONENT_COUNT) / 3))
        : 0;
    const shRestComponentCount = shBasisCount * 3;
    const shTextureDepth = shBasisCount > 0 ? Math.max(1, Math.ceil(shRestComponentCount / 4)) : 1;
    const shTextureWidth = shBasisCount > 0 ? textureWidth : 1;
    const shTextureHeight = shBasisCount > 0 ? textureHeight : 1;
    const shColorArray = hasRawColorCoefficients ? (shColor?.array as ArrayLike<number> | undefined) : undefined;
    const baseColorArray = colorPayloadMode === "albedo_linear" ? (baseColor?.array as ArrayLike<number> | undefined) : undefined;
    const srgbColorArray = colorPayloadMode === "albedo_srgb" ? (shColor?.array as ArrayLike<number> | undefined) : undefined;
    const shRestArray = shBasisCount > 0 ? (shRest?.array as ArrayLike<number> | undefined) : undefined;
    const alphaArray = alpha?.array as ArrayLike<number> | undefined;
    const scaleArray = scale?.array as ArrayLike<number> | undefined;
    const rotationArray = rotation?.array as ArrayLike<number> | undefined;
    const sampledSourceIndices = new Array<number>(sampledCount);
    const rootBounds = sourceGeometry.boundingBox?.clone() ?? new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    const rootLevel = resolveSharpChunkOctreeLevel(sampledCount);
    const rootBuckets = new Map<number, { sourceIndices: number[]; bounds: THREE.Box3 }>();

    for (let sampleIndex = 0; sampleIndex < sampledCount; sampleIndex += 1) {
        const sourceIndex = sampledCount === totalCount ? sampleIndex : Math.min(totalCount - 1, Math.floor((sampleIndex * totalCount) / sampledCount));
        sampledSourceIndices[sampleIndex] = sourceIndex;
    }

    if (rootLevel === 0) {
        rootBuckets.set(0, { sourceIndices: sampledSourceIndices, bounds: rootBounds.clone() });
    } else {
        for (let sampleIndex = 0; sampleIndex < sampledCount; sampleIndex += 1) {
            const sourceIndex = sampledSourceIndices[sampleIndex];
            let code = 0;
            let nodeBounds = rootBounds.clone();

            for (let level = 0; level < rootLevel; level += 1) {
                const octant = computeSharpChunkOctant(positionArray, sourceIndex, nodeBounds.getCenter(new THREE.Vector3()));
                code = (code << 3) | octant;
                nodeBounds = computeSharpChunkBoundsForOctant(nodeBounds, octant);
            }

            const bucket = rootBuckets.get(code);
            if (bucket) {
                bucket.sourceIndices.push(sourceIndex);
            } else {
                rootBuckets.set(code, {
                    sourceIndices: [sourceIndex],
                    bounds: nodeBounds,
                });
            }
        }
    }

    const chunkBuckets: Array<{ sourceIndices: number[]; code: number; boundingBox: THREE.Box3; boundingSphere: THREE.Sphere }> = [];
    rootBuckets.forEach((bucket, code) => {
        appendSharpGaussianChunks(bucket.sourceIndices, positionArray, bucket.bounds, rootLevel, code, chunkBuckets);
    });
    chunkBuckets.sort((left, right) => left.code - right.code);

    const texelCount = textureWidth * textureHeight;
    const toHalfFloat = THREE.DataUtils.toHalfFloat;
    const centerAlphaData = new Uint16Array(texelCount * 4);
    const colorData = new Uint16Array(texelCount * 4);
    const scaleData = new Uint16Array(texelCount * 4);
    const rotationData = new Uint16Array(texelCount * 4);
    const shData = new Uint16Array(shBasisCount > 0 ? texelCount * 4 * shTextureDepth : 4);
    const fallbackLinearR = fallbackSplatColor.r;
    const fallbackLinearG = fallbackSplatColor.g;
    const fallbackLinearB = fallbackSplatColor.b;
    const fallbackSrgb = fallbackSplatColor.clone().convertLinearToSRGB();
    const chunks: SharpGaussianChunk[] = [];
    let sampleOffset = 0;

    for (let chunkIndex = 0; chunkIndex < chunkBuckets.length; chunkIndex += 1) {
        const chunkBucket = chunkBuckets[chunkIndex];
        const chunkStart = sampleOffset;
        const chunkSourceIndices = chunkBucket.sourceIndices;

        for (let localIndex = 0; localIndex < chunkSourceIndices.length; localIndex += 1) {
            const sourceIndex = chunkSourceIndices[localIndex];
            const centerOffset = sourceIndex * 3;
            const texelOffset = sampleOffset * 4;
            const positionX = positionArray[centerOffset + 0];
            const positionY = positionArray[centerOffset + 1];
            const positionZ = positionArray[centerOffset + 2];
            const alphaValue = alphaArray ? Number(alphaArray[sourceIndex]) : 0.92;

            centerAlphaData[texelOffset + 0] = toHalfFloat(positionX);
            centerAlphaData[texelOffset + 1] = toHalfFloat(positionY);
            centerAlphaData[texelOffset + 2] = toHalfFloat(positionZ);
            centerAlphaData[texelOffset + 3] = toHalfFloat(alphaValue);

            if (shColorArray) {
                colorData[texelOffset + 0] = toHalfFloat(Number(shColorArray[centerOffset + 0]));
                colorData[texelOffset + 1] = toHalfFloat(Number(shColorArray[centerOffset + 1]));
                colorData[texelOffset + 2] = toHalfFloat(Number(shColorArray[centerOffset + 2]));
            } else if (baseColorArray) {
                colorData[texelOffset + 0] = toHalfFloat(clamp01(Number(baseColorArray[centerOffset + 0])));
                colorData[texelOffset + 1] = toHalfFloat(clamp01(Number(baseColorArray[centerOffset + 1])));
                colorData[texelOffset + 2] = toHalfFloat(clamp01(Number(baseColorArray[centerOffset + 2])));
            } else if (srgbColorArray) {
                colorData[texelOffset + 0] = toHalfFloat(srgbByteOrUnitToUnit(Number(srgbColorArray[centerOffset + 0])));
                colorData[texelOffset + 1] = toHalfFloat(srgbByteOrUnitToUnit(Number(srgbColorArray[centerOffset + 1])));
                colorData[texelOffset + 2] = toHalfFloat(srgbByteOrUnitToUnit(Number(srgbColorArray[centerOffset + 2])));
            } else {
                if (colorPayloadMode === "albedo_linear") {
                    colorData[texelOffset + 0] = toHalfFloat(fallbackLinearR);
                    colorData[texelOffset + 1] = toHalfFloat(fallbackLinearG);
                    colorData[texelOffset + 2] = toHalfFloat(fallbackLinearB);
                } else {
                    colorData[texelOffset + 0] = toHalfFloat(fallbackSrgb.r);
                    colorData[texelOffset + 1] = toHalfFloat(fallbackSrgb.g);
                    colorData[texelOffset + 2] = toHalfFloat(fallbackSrgb.b);
                }
            }
            colorData[texelOffset + 3] = toHalfFloat(1);

            if (scaleArray) {
                scaleData[texelOffset + 0] = toHalfFloat(Math.exp(Number(scaleArray[centerOffset + 0])));
                scaleData[texelOffset + 1] = toHalfFloat(Math.exp(Number(scaleArray[centerOffset + 1])));
                scaleData[texelOffset + 2] = toHalfFloat(Math.exp(Number(scaleArray[centerOffset + 2])));
            } else {
                scaleData[texelOffset + 0] = toHalfFloat(0.02);
                scaleData[texelOffset + 1] = toHalfFloat(0.02);
                scaleData[texelOffset + 2] = toHalfFloat(0.02);
            }
            scaleData[texelOffset + 3] = 0;

            if (rotationArray) {
                const rotationOffset = sourceIndex * 4;
                rotationData[texelOffset + 0] = toHalfFloat(Number(rotationArray[rotationOffset + 0]));
                rotationData[texelOffset + 1] = toHalfFloat(Number(rotationArray[rotationOffset + 1]));
                rotationData[texelOffset + 2] = toHalfFloat(Number(rotationArray[rotationOffset + 2]));
                rotationData[texelOffset + 3] = toHalfFloat(Number(rotationArray[rotationOffset + 3]));
            } else {
                rotationData[texelOffset + 0] = 0;
                rotationData[texelOffset + 1] = 0;
                rotationData[texelOffset + 2] = 0;
                rotationData[texelOffset + 3] = toHalfFloat(1);
            }

            if (shRestArray && shRest) {
                const shRestOffset = sourceIndex * shRest.itemSize;
                for (let componentIndex = 0; componentIndex < shRestComponentCount; componentIndex += 1) {
                    const layer = Math.floor(componentIndex / 4);
                    const lane = componentIndex % 4;
                    const targetOffset = ((layer * texelCount) + sampleOffset) * 4 + lane;
                    const value = Number(shRestArray[shRestOffset + componentIndex]);
                    shData[targetOffset] = toHalfFloat(Number.isFinite(value) ? value : 0);
                }
            }

            sampleOffset += 1;
        }

        chunks.push({
            start: chunkStart,
            count: chunkSourceIndices.length,
            code: chunkBucket.code,
            boundingBox: chunkBucket.boundingBox,
            boundingSphere: chunkBucket.boundingSphere,
        });
    }

    const geometry = new THREE.InstancedBufferGeometry();
    geometry.instanceCount = 0;
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute("corner", new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
    geometry.boundingSphere = sourceGeometry.boundingSphere?.clone() ?? null;
    geometry.boundingBox = sourceGeometry.boundingBox?.clone() ?? null;

    return {
        geometry,
        centerAlphaTexture: createSharpGaussianTexture(centerAlphaData, textureWidth, textureHeight),
        colorTexture: createSharpGaussianTexture(colorData, textureWidth, textureHeight),
        scaleTexture: createSharpGaussianTexture(scaleData, textureWidth, textureHeight),
        rotationTexture: createSharpGaussianTexture(rotationData, textureWidth, textureHeight),
        shTexture: createSharpGaussianArrayTexture(shData, shTextureWidth, shTextureHeight, shTextureDepth),
        shTextureWidth,
        shTextureHeight,
        shTextureDepth,
        colorPayloadMode,
        shBasisCount,
        textureWidth,
        textureHeight,
        count: sampledCount,
        chunks,
        sceneRadius: Math.max(1e-3, sourceGeometry.boundingSphere?.radius ?? 1),
        previewFocus: sourceGeometry.boundingSphere
              ? {
                  center: [
                      sourceGeometry.boundingSphere.center.x,
                      sourceGeometry.boundingSphere.center.y,
                      sourceGeometry.boundingSphere.center.z,
                  ],
                  radius: Math.max(1e-3, sourceGeometry.boundingSphere.radius),
                  forward: [0, 0, 1],
              }
            : null,
        debugSamples: [],
    };
}

function buildSharpGaussianPayloadFromSerialized(data: SerializedSharpGaussianPayload): SharpGaussianPayload {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.instanceCount = 0;
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute("corner", new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
    geometry.boundingBox = new THREE.Box3(
        new THREE.Vector3(...data.boundingBoxMin),
        new THREE.Vector3(...data.boundingBoxMax),
    );
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(...data.boundingSphereCenter), data.boundingSphereRadius);

    return {
        geometry,
        centerAlphaTexture: createSharpGaussianTexture(data.centerAlphaData, data.textureWidth, data.textureHeight),
        colorTexture: createSharpGaussianTexture(data.colorData, data.textureWidth, data.textureHeight),
        scaleTexture: createSharpGaussianTexture(data.scaleData, data.textureWidth, data.textureHeight),
        rotationTexture: createSharpGaussianTexture(data.rotationData, data.textureWidth, data.textureHeight),
        shTexture: createSharpGaussianArrayTexture(data.shData, data.shTextureWidth, data.shTextureHeight, data.shTextureDepth),
        shTextureWidth: data.shTextureWidth,
        shTextureHeight: data.shTextureHeight,
        shTextureDepth: data.shTextureDepth,
        colorPayloadMode: data.colorPayloadMode,
        shBasisCount: data.shBasisCount,
        textureWidth: data.textureWidth,
        textureHeight: data.textureHeight,
        count: data.count,
        chunks: data.chunks.map((chunk) => ({
            start: chunk.start,
            count: chunk.count,
            code: chunk.code,
            boundingBox: new THREE.Box3(new THREE.Vector3(...chunk.boundingBoxMin), new THREE.Vector3(...chunk.boundingBoxMax)),
            boundingSphere: new THREE.Sphere(new THREE.Vector3(...chunk.boundingSphereCenter), chunk.boundingSphereRadius),
        })),
        sceneRadius: data.sceneRadius,
        previewFocus: {
            center: data.previewFocusCenter,
            radius: Math.max(1e-3, data.previewFocusRadius),
            forward: data.previewFocusForward,
        },
        debugSamples: data.debugSamples,
    };
}

function disposeSharpGaussianPayload(payload: SharpGaussianPayload) {
    payload.geometry.dispose();
    payload.centerAlphaTexture.dispose();
    payload.colorTexture.dispose();
    payload.scaleTexture.dispose();
    payload.rotationTexture.dispose();
    payload.shTexture.dispose();
}

// Retained for local diagnostics while the worker path remains the production parser.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function parseSharpGeometryFromBuffer(sourceBuffer: ArrayBuffer) {
    const loader = new PLYLoader();
    // Only map properties present in the current file. Requesting absent SH channels causes
    // PLYLoader to allocate enormous undefined-filled arrays for dense worker outputs.
    loader.setCustomPropertyNameMapping(resolveSharpPlyCustomPropertyMapping(sourceBuffer));
    return loader.parse(sourceBuffer);
}

async function buildSharpGaussianPayloadInWorker({
    sourceBuffer,
    pointBudget,
    maxTextureSize,
    metadata,
    onProgress,
    onWorkerCreated,
}: {
    sourceBuffer: ArrayBuffer;
    pointBudget: number;
    maxTextureSize: number;
    metadata?: GeneratedEnvironmentMetadata | null;
    onProgress?: (message: string) => void;
    onWorkerCreated?: (worker: Worker) => void;
}) {
    const worker = new Worker(new URL("./sharpGaussianPlyWorker.ts", import.meta.url), { type: "module" });
    onWorkerCreated?.(worker);

    return await new Promise<SharpGaussianPayload>((resolve, reject) => {
        const cleanup = () => {
            worker.onmessage = null;
            worker.onerror = null;
        };

        worker.onmessage = (event: MessageEvent) => {
            const data = event.data as
                | { type: "progress"; label?: string }
                | { type: "success"; payload: SerializedSharpGaussianPayload }
                | { type: "error"; message?: string; stack?: string };

            if (data.type === "progress") {
                if (typeof data.label === "string") {
                    onProgress?.(data.label);
                }
                return;
            }

            cleanup();

            if (data.type === "success") {
                resolve(buildSharpGaussianPayloadFromSerialized(data.payload));
                return;
            }

            const error = new Error(data.message || "Worker parse failed.");
            if (data.stack) {
                error.stack = data.stack;
            }
            reject(error);
        };

        worker.onerror = (event) => {
            cleanup();
            reject(event.error instanceof Error ? event.error : new Error(event.message || "Worker parse failed."));
        };

        worker.postMessage(
            {
                type: "parse",
                buffer: sourceBuffer,
                pointBudget,
                maxTextureSize,
                colorEncoding: metadata?.rendering?.color_encoding ?? null,
                applyPreviewOrientation: shouldApplyPreviewOrientation(metadata),
            },
            [sourceBuffer],
        );
    });
}

function areSharpChunkSelectionsEqual(left: number[], right: number[]) {
    if (left.length !== right.length) {
        return false;
    }

    for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) {
            return false;
        }
    }

    return true;
}

function buildVisibleSharpGaussianActiveIndices(payload: SharpGaussianPayload, visibleChunkIndices: number[], visibleCount: number) {
    const activeIndices = new Uint32Array(visibleCount);
    let offset = 0;

    for (let chunkCursor = 0; chunkCursor < visibleChunkIndices.length; chunkCursor += 1) {
        const chunk = payload.chunks[visibleChunkIndices[chunkCursor]];
        for (let localIndex = 0; localIndex < chunk.count; localIndex += 1) {
            activeIndices[offset] = chunk.start + localIndex;
            offset += 1;
        }
    }

    return activeIndices;
}

function buildDepthOrderedSharpGaussianActiveIndices(
    payload: SharpGaussianPayload,
    visibleChunkCandidates: Array<{ chunkIndex: number; distanceSq: number }>,
    visibleCount: number,
) {
    const sortedCandidates = [...visibleChunkCandidates].sort((left, right) => right.distanceSq - left.distanceSq);
    const activeIndices = new Uint32Array(visibleCount);
    let offset = 0;

    for (let chunkCursor = 0; chunkCursor < sortedCandidates.length; chunkCursor += 1) {
        const chunk = payload.chunks[sortedCandidates[chunkCursor].chunkIndex];
        for (let localIndex = 0; localIndex < chunk.count; localIndex += 1) {
            activeIndices[offset] = chunk.start + localIndex;
            offset += 1;
        }
    }

    return activeIndices;
}

function selectPreviewInteractionChunks(
    payload: SharpGaussianPayload,
    visibleChunkCandidates: Array<{ chunkIndex: number; distanceSq: number }>,
    pointBudget: number,
) {
    if (visibleChunkCandidates.length === 0) {
        return {
            chunkIndices: [] as number[],
            visibleCount: 0,
        };
    }

    const sortedCandidates = [...visibleChunkCandidates].sort((left, right) => left.distanceSq - right.distanceSq);
    const selectedChunkIndices: number[] = [];
    let visibleCount = 0;

    for (let candidateIndex = 0; candidateIndex < sortedCandidates.length; candidateIndex += 1) {
        const chunkIndex = sortedCandidates[candidateIndex].chunkIndex;
        const chunk = payload.chunks[chunkIndex];

        if (selectedChunkIndices.length > 0 && visibleCount + chunk.count > pointBudget) {
            continue;
        }

        selectedChunkIndices.push(chunkIndex);
        visibleCount += chunk.count;

        if (visibleCount >= pointBudget) {
            break;
        }
    }

    if (selectedChunkIndices.length === 0) {
        const firstChunkIndex = sortedCandidates[0].chunkIndex;
        selectedChunkIndices.push(firstChunkIndex);
        visibleCount = payload.chunks[firstChunkIndex]?.count ?? 0;
    }

    selectedChunkIndices.sort((left, right) => left - right);

    return {
        chunkIndices: selectedChunkIndices,
        visibleCount,
    };
}

// Retained for local diagnostics while the worker path remains the production parser.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function releaseSharpSourceGeometry(sourceGeometry: THREE.BufferGeometry) {
    for (const attributeName of Object.keys(sourceGeometry.attributes)) {
        sourceGeometry.deleteAttribute(attributeName);
    }
    sourceGeometry.setIndex(null);
    sourceGeometry.dispose();
}

function configureLumaForUltra(splat: LumaSplatsThree, camera: THREE.Camera) {
    const internal = splat as unknown as LumaSplatsThreeInternal;
    const lumaSplatsWebGL = internal.lumaSplatsWebGL;
    if (!lumaSplatsWebGL) {
        return;
    }

    const sceneRadius = Math.max(1e-3, splat.boundingSphere?.radius ?? 1);
    const settledRadius = sceneRadius * 1.001;

    lumaSplatsWebGL.enableEnd = false;
    lumaSplatsWebGL.maxSortAge = 1;
    lumaSplatsWebGL.needsSort = true;
    lumaSplatsWebGL.sortAge = lumaSplatsWebGL.maxSortAge;
    if (lumaSplatsWebGL.loader) {
        lumaSplatsWebGL.loader.streaming = false;
    }
    lumaSplatsWebGL.loadingAnimation.enabled = false;
    lumaSplatsWebGL.loadingAnimation.particleRevealEnabled = false;
    lumaSplatsWebGL.shaderParams.tweakScale = 1;
    lumaSplatsWebGL.shaderParams.loadR1 = sceneRadius;
    lumaSplatsWebGL.shaderParams.loadR2 = settledRadius;
    lumaSplatsWebGL.shaderParams.revealR1 = sceneRadius;
    lumaSplatsWebGL.shaderParams.revealR2 = settledRadius;
    lumaSplatsWebGL.shaderParams.solidR1 = sceneRadius;
    lumaSplatsWebGL.shaderParams.solidR2 = settledRadius;

    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
        const direction = new THREE.Vector3();
        camera.getWorldDirection(direction);
        lumaSplatsWebGL.needsSort = true;
        lumaSplatsWebGL.sortAge = lumaSplatsWebGL.maxSortAge;
        void direction;
    }
}

function LumaEnvironmentSplat({ source }: { source: string }) {
    const loader = useMemo(() => new LumaSplatsLoader(source, false), [source]);
    const splat = useMemo(
        () =>
            new LumaSplatsThree({
                loader,
                enableThreeShaderIntegration: true,
                loadingAnimationEnabled: false,
                particleRevealEnabled: false,
                onBeforeRender: (_renderer, _scene, camera, currentSplat) => {
                    configureLumaForUltra(currentSplat, camera);
                },
            }),
        [loader],
    );

    useEffect(() => {
        splat.frustumCulled = false;
        splat.loadingAnimationEnabled = false;
        splat.particleRevealEnabled = false;

        return () => {
            splat.dispose();
        };
    }, [splat]);

    return <primitive object={splat} position={[0, 0, 0]} />;
}

function SharpGaussianEnvironmentSplat({
    source,
    metadata,
    onPreviewBounds,
    onFatalError,
}: {
    source: string;
    metadata?: GeneratedEnvironmentMetadata | null;
    onPreviewBounds?: (bounds: PreviewBounds) => void;
    onFatalError?: (message: string, reason: ViewerFallbackReason) => void;
}) {
    const { gl, size } = useThree();
    const meshRef = useRef<THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial> | null>(null);
    const pointBudget = useMemo(
        () => resolveSharpPointBudget(metadata, gl.capabilities.maxTextureSize),
        [gl.capabilities.maxTextureSize, metadata],
    );
    const isSingleImagePreview = useMemo(() => isSingleImagePreviewMetadata(metadata), [metadata]);
    const opacityBoost = useMemo(() => resolvePreviewOpacityBoost(metadata), [metadata]);
    const colorGain = useMemo(() => resolvePreviewColorGain(metadata), [metadata]);
    const payloadRef = useRef<SharpGaussianPayload | null>(null);
    const [payload, setPayload] = useState<SharpGaussianPayload | null>(null);
    const [loadState, setLoadState] = useState<{ phase: "loading" | "ready" | "error"; message: string }>({
        phase: "loading",
        message: "Fetching environment splat...",
    });
    const material = useMemo(
        () =>
            payload
                ? new THREE.ShaderMaterial({
                      glslVersion: THREE.GLSL3,
                      uniforms: {
                          uCenterAlphaTexture: { value: payload.centerAlphaTexture },
                          uColorTexture: { value: payload.colorTexture },
                          uScaleTexture: { value: payload.scaleTexture },
                          uRotationTexture: { value: payload.rotationTexture },
                          uOrderTexture: { value: payload.centerAlphaTexture },
                          uTextureSize: { value: new THREE.Vector2(payload.textureWidth, payload.textureHeight) },
                          uOrderTextureSize: { value: new THREE.Vector2(1, 1) },
                          uViewport: { value: new THREE.Vector2(1, 1) },
                          uCovarianceScale: { value: 1.0 },
                          uMinAxisPx: { value: 0.08 },
                          uMaxAxisPx: { value: 96.0 },
                          uOpacityBoost: { value: 1.0 },
                          uColorGain: { value: 1.0 },
                          uShTexture: { value: payload.shTexture },
                          uColorPayloadIsLinear: { value: payload.colorPayloadMode === "albedo_linear" ? 1 : 0 },
                          uColorPayloadIsSHDC: { value: payload.colorPayloadMode === "sh_dc" ? 1 : 0 },
                          uHasSphericalHarmonics: { value: payload.shBasisCount > 0 && !isSingleImagePreview ? 1 : 0 },
                          uShBasisCount: { value: payload.shBasisCount },
                          uOrderTextureReady: { value: 0 },
                          uCullSentinel: { value: 65504 },
                      },
                      vertexShader: DIRECT_GAUSSIAN_VERTEX_SHADER,
                      fragmentShader: DIRECT_GAUSSIAN_FRAGMENT_SHADER,
                      transparent: true,
                      depthWrite: false,
                      depthTest: true,
                      blending: THREE.NormalBlending,
                      toneMapped: false,
                  })
                : null,
        [isSingleImagePreview, payload],
    );
    const gpuSorterRef = useRef<SharpGaussianGpuSorter | null>(null);
    const cpuOrderTextureRef = useRef<SharpGaussianOrderTexture | null>(null);
    const hasSortedRef = useRef(false);
    const visibleChunkIndicesRef = useRef<number[]>([]);
    const frustumRef = useRef(new THREE.Frustum());
    const frustumMatrixRef = useRef(new THREE.Matrix4());
    const worldChunkSphereRef = useRef(new THREE.Sphere());
    const lastSortedCameraPositionRef = useRef(new THREE.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY));
    const lastSortedCameraQuaternionRef = useRef(new THREE.Quaternion());
    const lastFrameCameraPositionRef = useRef(new THREE.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY));
    const lastFrameCameraQuaternionRef = useRef(new THREE.Quaternion());
    const loadGenerationRef = useRef(0);
    useEffect(() => {
        const previousPayload = payloadRef.current;
        payloadRef.current = payload;
        if (previousPayload && previousPayload !== payload) {
            disposeSharpGaussianPayload(previousPayload);
        }
    }, [payload]);

    useEffect(() => {
        return () => {
            if (payloadRef.current) {
                disposeSharpGaussianPayload(payloadRef.current);
                payloadRef.current = null;
            }
            cpuOrderTextureRef.current?.texture.dispose();
            cpuOrderTextureRef.current = null;
        };
    }, []);

    useEffect(() => {
        const loadGeneration = loadGenerationRef.current + 1;
        loadGenerationRef.current = loadGeneration;
        let ignore = false;
        const abortController = new AbortController();
        let parseWorker: Worker | null = null;
        let loadStartTimer: number | null = null;

        const isStale = () => ignore || abortController.signal.aborted || loadGenerationRef.current !== loadGeneration;
        const terminateParseWorker = () => {
            parseWorker?.terminate();
            parseWorker = null;
        };

        gpuSorterRef.current?.dispose();
        gpuSorterRef.current = null;
        cpuOrderTextureRef.current?.texture.dispose();
        cpuOrderTextureRef.current = null;
        hasSortedRef.current = false;
        visibleChunkIndicesRef.current = [];
        lastSortedCameraPositionRef.current.set(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
        lastSortedCameraQuaternionRef.current.identity();
        lastFrameCameraPositionRef.current.set(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
        lastFrameCameraQuaternionRef.current.identity();
        setPayload(null);
        setLoadState({
            phase: "loading",
            message: "Fetching environment splat...",
        });

        const loadPayload = async () => {
            try {
                if (typeof Worker === "undefined") {
                    throw new Error("Environment splat parsing requires Web Worker support.");
                }

                const response = await fetch(source, {
                    cache: "force-cache",
                    signal: abortController.signal,
                });

                if (!response.ok) {
                    throw new Error(`Could not load ${source}: ${response.status} ${response.statusText}`.trim());
                }

                const arrayBuffer = await response.arrayBuffer();
                if (isStale()) {
                    return;
                }

                setLoadState({
                    phase: "loading",
                    message: `Parsing environment splat in worker (${Math.max(1, Math.round(arrayBuffer.byteLength / (1024 * 1024)))}MB)...`,
                });

                const nextPayload = await buildSharpGaussianPayloadInWorker({
                    sourceBuffer: arrayBuffer,
                    pointBudget,
                    maxTextureSize: gl.capabilities.maxTextureSize,
                    metadata,
                    onProgress: (message) => {
                        if (!isStale()) {
                            setLoadState({
                                phase: "loading",
                                message,
                            });
                        }
                    },
                    onWorkerCreated: (worker) => {
                        if (isStale()) {
                            worker.terminate();
                            return;
                        }
                        parseWorker = worker;
                    },
                });
                terminateParseWorker();

                if (isStale()) {
                    disposeSharpGaussianPayload(nextPayload);
                    return;
                }

                setPayload(nextPayload);
                setLoadState({
                    phase: "ready",
                    message: "Environment splat loaded.",
                });
            } catch (error) {
                if (isStale()) {
                    return;
                }

                const message = error instanceof Error ? error.message : "Environment splat failed to load.";
                console.error(`[EnvironmentSplat] Failed to load ${source}`, error);
                setPayload(null);
                setLoadState({
                    phase: "error",
                    message,
                });
                onFatalError?.(message, classifyViewerFailure(message));
            } finally {
                terminateParseWorker();
            }
        };

        // Defer kickoff so the first Strict Mode mount can cleanly cancel before spawning
        // duplicate fetches/workers, while real mounts still start on the next task.
        loadStartTimer = window.setTimeout(() => {
            loadStartTimer = null;
            if (isStale()) {
                return;
            }
            void loadPayload();
        }, 0);

        return () => {
            ignore = true;
            if (loadStartTimer !== null) {
                window.clearTimeout(loadStartTimer);
                loadStartTimer = null;
            }
            abortController.abort();
            terminateParseWorker();
            cpuOrderTextureRef.current?.texture.dispose();
            cpuOrderTextureRef.current = null;
        };
    }, [gl.capabilities.maxTextureSize, metadata, onFatalError, pointBudget, source]);

    useEffect(() => {
        if (!material) {
            return;
        }

        material.uniforms.uViewport.value.set(size.width * gl.getPixelRatio(), size.height * gl.getPixelRatio());
    }, [gl, material, size.height, size.width]);

    useEffect(() => {
        if (!material) {
            return;
        }

        material.uniforms.uOpacityBoost.value = opacityBoost;
    }, [material, opacityBoost]);

    useEffect(() => {
        if (!material) {
            return;
        }

        material.uniforms.uColorGain.value = colorGain;
    }, [colorGain, material]);

    useEffect(() => {
        if (!material || !payload) {
            return;
        }

        const lastSortedCameraPosition = lastSortedCameraPositionRef.current;
        const lastSortedCameraQuaternion = lastSortedCameraQuaternionRef.current;
        const lastFrameCameraPosition = lastFrameCameraPositionRef.current;
        const lastFrameCameraQuaternion = lastFrameCameraQuaternionRef.current;

        payload.geometry.instanceCount = 0;
        visibleChunkIndicesRef.current = [];
        gpuSorterRef.current?.dispose();
        gpuSorterRef.current = null;
        cpuOrderTextureRef.current?.texture.dispose();
        cpuOrderTextureRef.current = null;
        material.uniforms.uOrderTextureReady.value = 0;
        material.uniforms.uMaxAxisPx.value = isSingleImagePreview ? PREVIEW_REST_MAX_AXIS_PX : 96.0;
        hasSortedRef.current = false;
        lastSortedCameraPositionRef.current.set(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
        lastSortedCameraQuaternionRef.current.identity();
        lastFrameCameraPositionRef.current.set(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
        lastFrameCameraQuaternionRef.current.identity();

        return () => {
            gpuSorterRef.current?.dispose();
            gpuSorterRef.current = null;
            cpuOrderTextureRef.current?.texture.dispose();
            cpuOrderTextureRef.current = null;
            material.uniforms.uOrderTextureReady.value = 0;
            material.uniforms.uMaxAxisPx.value = 96.0;
            payload.geometry.instanceCount = 0;
            visibleChunkIndicesRef.current = [];
            hasSortedRef.current = false;
            lastSortedCameraPosition.set(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
            lastSortedCameraQuaternion.identity();
            lastFrameCameraPosition.set(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
            lastFrameCameraQuaternion.identity();
        };
    }, [isSingleImagePreview, material, payload]);

    useFrame(({ camera }) => {
        if (!payload || !material) {
            return;
        }

        const mesh = meshRef.current;
        if (!mesh || payload.count === 0 || payload.chunks.length === 0) {
            payload.geometry.instanceCount = 0;
            material.uniforms.uOrderTextureReady.value = 0;
            return;
        }

        let previewInteractionActive = false;
        if (isSingleImagePreview) {
            if (!Number.isFinite(lastFrameCameraPositionRef.current.x)) {
                lastFrameCameraPositionRef.current.copy(camera.position);
                lastFrameCameraQuaternionRef.current.copy(camera.quaternion);
            } else {
                const frameTranslationDelta = lastFrameCameraPositionRef.current.distanceTo(camera.position);
                const frameQuaternionAlignment = Math.min(1, Math.abs(lastFrameCameraQuaternionRef.current.dot(camera.quaternion)));
                const frameAngularDelta = 2 * Math.acos(frameQuaternionAlignment);
                const frameTranslationThreshold = Math.max(0.0002, payload.sceneRadius * 0.0002);
                const frameAngularThreshold = 0.0012;
                previewInteractionActive =
                    frameTranslationDelta > frameTranslationThreshold || frameAngularDelta > frameAngularThreshold;
            }
        }

        material.uniforms.uMaxAxisPx.value =
            isSingleImagePreview && previewInteractionActive ? PREVIEW_INTERACTION_MAX_AXIS_PX : PREVIEW_REST_MAX_AXIS_PX;
        lastFrameCameraPositionRef.current.copy(camera.position);
        lastFrameCameraQuaternionRef.current.copy(camera.quaternion);

        mesh.updateMatrixWorld();
        frustumMatrixRef.current.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        frustumRef.current.setFromProjectionMatrix(frustumMatrixRef.current);

        const visibleChunkCandidates: Array<{ chunkIndex: number; distanceSq: number }> = [];

        for (let chunkIndex = 0; chunkIndex < payload.chunks.length; chunkIndex += 1) {
            const chunk = payload.chunks[chunkIndex];
            worldChunkSphereRef.current.copy(chunk.boundingSphere).applyMatrix4(mesh.matrixWorld);
            const cameraInsideChunk = worldChunkSphereRef.current.containsPoint(camera.position);
            if (!cameraInsideChunk && !frustumRef.current.intersectsSphere(worldChunkSphereRef.current)) {
                continue;
            }

            visibleChunkCandidates.push({
                chunkIndex,
                distanceSq: worldChunkSphereRef.current.center.distanceToSquared(camera.position),
            });
        }

        const nextVisibleSelection =
            isSingleImagePreview && previewInteractionActive
                ? selectPreviewInteractionChunks(payload, visibleChunkCandidates, PREVIEW_INTERACTION_POINT_BUDGET)
                : {
                      chunkIndices: visibleChunkCandidates.map((candidate) => candidate.chunkIndex),
                      visibleCount: visibleChunkCandidates.reduce(
                          (count, candidate) => count + payload.chunks[candidate.chunkIndex].count,
                          0,
                      ),
                  };
        const nextVisibleChunkIndices = nextVisibleSelection.chunkIndices;
        const visibleCount = nextVisibleSelection.visibleCount;

        const visibilityChanged = !areSharpChunkSelectionsEqual(visibleChunkIndicesRef.current, nextVisibleChunkIndices);
        if (visibilityChanged) {
            visibleChunkIndicesRef.current = nextVisibleChunkIndices;
        }

        payload.geometry.instanceCount = visibleCount;
        if (visibleCount === 0) {
            gpuSorterRef.current?.setActiveIndices(new Uint32Array(0));
            cpuOrderTextureRef.current?.texture.dispose();
            cpuOrderTextureRef.current = null;
            material.uniforms.uOrderTextureReady.value = 0;
            hasSortedRef.current = false;
            return;
        }

        const visibleChunkDistanceMap = new Map<number, number>();
        for (let candidateIndex = 0; candidateIndex < visibleChunkCandidates.length; candidateIndex += 1) {
            const candidate = visibleChunkCandidates[candidateIndex];
            visibleChunkDistanceMap.set(candidate.chunkIndex, candidate.distanceSq);
        }
        const orderedVisibleChunkCandidates = nextVisibleChunkIndices.map((chunkIndex) => ({
            chunkIndex,
            distanceSq: visibleChunkDistanceMap.get(chunkIndex) ?? Number.POSITIVE_INFINITY,
        }));

        if (isSingleImagePreview) {
            const needsOrderRefresh = visibilityChanged || !cpuOrderTextureRef.current;
            if (needsOrderRefresh) {
                const activeIndices = buildDepthOrderedSharpGaussianActiveIndices(
                    payload,
                    orderedVisibleChunkCandidates,
                    visibleCount,
                );
                gpuSorterRef.current?.dispose();
                gpuSorterRef.current = null;
                cpuOrderTextureRef.current = syncSharpGaussianOrderTexturePayload(
                    cpuOrderTextureRef.current,
                    activeIndices,
                    DIRECT_ORDER_CULL_SENTINEL,
                );
                material.uniforms.uOrderTexture.value = cpuOrderTextureRef.current.texture;
                material.uniforms.uOrderTextureSize.value.set(cpuOrderTextureRef.current.width, cpuOrderTextureRef.current.height);
                material.uniforms.uCullSentinel.value = DIRECT_ORDER_CULL_SENTINEL;
                material.uniforms.uOrderTextureReady.value = 1;
                lastSortedCameraPositionRef.current.copy(camera.position);
                lastSortedCameraQuaternionRef.current.copy(camera.quaternion);
                hasSortedRef.current = true;
                return;
            }
        } else if (visibilityChanged || !gpuSorterRef.current) {
            const activeIndices = buildVisibleSharpGaussianActiveIndices(payload, nextVisibleChunkIndices, visibleCount);
            const currentSorter = gpuSorterRef.current;
            const shouldRecreateSorter =
                !currentSorter ||
                currentSorter.sortCapacity < visibleCount ||
                currentSorter.sortCapacity > Math.max(4096, visibleCount * 4);

            if (shouldRecreateSorter) {
                currentSorter?.dispose();
                gpuSorterRef.current = new SharpGaussianGpuSorter({
                    renderer: gl,
                    centerAlphaTexture: payload.centerAlphaTexture,
                    payloadTextureWidth: payload.textureWidth,
                    payloadTextureHeight: payload.textureHeight,
                    activeIndices,
                });
                material.uniforms.uOrderTextureSize.value.set(gpuSorterRef.current.orderTextureWidth, gpuSorterRef.current.orderTextureHeight);
                material.uniforms.uCullSentinel.value = gpuSorterRef.current.cullSentinel;
            } else if (currentSorter) {
                currentSorter.setActiveIndices(activeIndices);
            }

            cpuOrderTextureRef.current?.texture.dispose();
            cpuOrderTextureRef.current = null;
            const gpuSorter = gpuSorterRef.current;
            if (!gpuSorter) {
                return;
            }

            gpuSorter.update(camera);
            material.uniforms.uOrderTexture.value = gpuSorter.getTexture();
            material.uniforms.uOrderTextureReady.value = 1;
            lastSortedCameraPositionRef.current.copy(camera.position);
            lastSortedCameraQuaternionRef.current.copy(camera.quaternion);
            hasSortedRef.current = true;
            return;
        }

        const gpuSorter = gpuSorterRef.current;
        if (!isSingleImagePreview && !gpuSorter) {
            return;
        }
        const positionDeltaSq = lastSortedCameraPositionRef.current.distanceToSquared(camera.position);
        const translationDelta = Math.sqrt(positionDeltaSq);
        const quaternionAlignment = Math.min(1, Math.abs(lastSortedCameraQuaternionRef.current.dot(camera.quaternion)));
        const angularDelta = 2 * Math.acos(quaternionAlignment);
        const pureRotationDelta = positionDeltaSq <= DIRECT_SORT_POSITION_EPSILON_SQ;
        const sortThresholdMultiplier = isSingleImagePreview ? PREVIEW_SORT_THRESHOLD_MULTIPLIER : 1;
        const pureRotationAngleThreshold = Math.max(DIRECT_SORT_ROTATION_EPSILON * 48, 0.004363323129985824) * sortThresholdMultiplier;
        const viewMotionThreshold = Math.max(0.001, payload.sceneRadius * 0.00075) * sortThresholdMultiplier;
        const canReuseSort =
            hasSortedRef.current &&
            ((pureRotationDelta && angularDelta <= pureRotationAngleThreshold) || translationDelta + payload.sceneRadius * angularDelta <= viewMotionThreshold);

        if (canReuseSort) {
            return;
        }

        if (isSingleImagePreview) {
            const activeIndices = buildDepthOrderedSharpGaussianActiveIndices(
                payload,
                orderedVisibleChunkCandidates,
                visibleCount,
            );
            cpuOrderTextureRef.current = syncSharpGaussianOrderTexturePayload(
                cpuOrderTextureRef.current,
                activeIndices,
                DIRECT_ORDER_CULL_SENTINEL,
            );
            material.uniforms.uOrderTexture.value = cpuOrderTextureRef.current.texture;
            material.uniforms.uOrderTextureSize.value.set(cpuOrderTextureRef.current.width, cpuOrderTextureRef.current.height);
            material.uniforms.uCullSentinel.value = DIRECT_ORDER_CULL_SENTINEL;
            material.uniforms.uOrderTextureReady.value = 1;
            lastSortedCameraPositionRef.current.copy(camera.position);
            lastSortedCameraQuaternionRef.current.copy(camera.quaternion);
            hasSortedRef.current = true;
            return;
        }

        if (!gpuSorter) {
            return;
        }
        gpuSorter.update(camera);
        material.uniforms.uOrderTexture.value = gpuSorter.getTexture();
        material.uniforms.uOrderTextureReady.value = 1;
        lastSortedCameraPositionRef.current.copy(camera.position);
        lastSortedCameraQuaternionRef.current.copy(camera.quaternion);
        hasSortedRef.current = true;
    });

    useEffect(() => {
        if (!material) {
            return;
        }

        return () => {
            material.dispose();
        };
    }, [material]);

    useEffect(() => {
        if (!payload || !onPreviewBounds || !isSingleImagePreview) {
            return;
        }

        const sphere = payload.previewFocus ?? (payload.geometry.boundingSphere
            ? {
                  center: [
                      payload.geometry.boundingSphere.center.x,
                      payload.geometry.boundingSphere.center.y,
                      payload.geometry.boundingSphere.center.z,
                  ] as [number, number, number],
                  radius: payload.geometry.boundingSphere.radius,
                  forward: [0, 0, 1] as [number, number, number],
              }
            : null);
        if (!sphere) {
            return;
        }

        onPreviewBounds({
            center: sphere.center,
            radius: Math.max(1e-3, sphere.radius),
            forward: sphere.forward,
        });
    }, [isSingleImagePreview, onPreviewBounds, payload]);

    if (loadState.phase === "error") {
        return <SplatStatusLabel text={`Environment splat failed: ${loadState.message}`} tone="error" />;
    }

    if (!payload || !material) {
        return <SplatStatusLabel text={loadState.message} />;
    }

    return (
        <mesh
            ref={meshRef}
            geometry={payload.geometry}
            material={material}
            frustumCulled={false}
        />
    );
}

export default function EnvironmentSplat(props: EnvironmentSplatProps) {
    const resolved = resolveEnvironmentRenderSource(props);

    if (resolved.mode === "luma") {
        return <LumaEnvironmentSplat source={resolved.source} />;
    }

    if (resolved.mode === "sharp") {
        return (
            <SharpGaussianEnvironmentSplat
                source={resolved.source}
                metadata={props.metadata}
                onPreviewBounds={props.onPreviewBounds}
                onFatalError={props.onFatalError}
            />
        );
    }

    return null;
}
