"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { LumaSplatsLoader, LumaSplatsThree } from "@lumaai/luma-web";
import * as THREE from "three";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import type { GeneratedEnvironmentMetadata } from "@/lib/mvp-product";
import { SharpGaussianGpuSorter } from "./sharpGaussianGpuSort";

const SH_REST_COMPONENT_COUNT = 45;
const SH_MAX_BASIS_COUNT = SH_REST_COMPONENT_COUNT / 3;
const TARGET_POINTS_PER_CHUNK = 16384;
const MAX_POINTS_PER_CHUNK = 32768;
const MAX_CHUNK_OCTREE_LEVEL = 6;
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
uniform float uHasRawColorCoefficients;
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

vec3 evaluateViewDependentColor() {
    if (uHasRawColorCoefficients < 0.5) {
        return max(vColorPayload, vec3(0.0));
    }

    vec3 color = vColorPayload * 0.28209479177387814;

    if (uHasSphericalHarmonics > 0.5) {
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

    return max(color + vec3(0.5), vec3(0.0));
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

    outColor = vec4(evaluateViewDependentColor(), alpha);
}
`;
const REAL_SPLAT_RENDERERS = new Set(["luma", "luma_web", "luma_capture", "luma_splats"]);
const SHARP_GAUSSIAN_RENDERERS = new Set(["sharp_gaussian_direct", "ply_gaussian_fallback", "sharp_ply"]);

type EnvironmentSplatProps = {
    plyUrl?: string | null;
    viewerUrl?: string | null;
    metadata?: GeneratedEnvironmentMetadata | null;
};

type SharpGaussianChunk = {
    start: number;
    count: number;
    code: number;
    boundingBox: THREE.Box3;
    boundingSphere: THREE.Sphere;
};

type SharpGaussianPayload = {
    geometry: THREE.InstancedBufferGeometry;
    centerAlphaTexture: THREE.DataTexture;
    colorTexture: THREE.DataTexture;
    scaleTexture: THREE.DataTexture;
    rotationTexture: THREE.DataTexture;
    shTexture: THREE.DataArrayTexture;
    shTextureDepth: number;
    hasRawColorCoefficients: boolean;
    shBasisCount: number;
    textureWidth: number;
    textureHeight: number;
    count: number;
    chunks: SharpGaussianChunk[];
    sceneRadius: number;
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

function clamp01(value: number) {
    return Math.min(1, Math.max(0, value));
}

function sigmoid(value: number) {
    return 1 / (1 + Math.exp(-value));
}

function isLikelyLumaSource(source: string) {
    return /lumalabs\.ai\/capture\//i.test(source) || /\.(ksplat|splat)(\?.*)?$/i.test(source);
}

function resolveEnvironmentRenderSource({ plyUrl, viewerUrl, metadata }: EnvironmentSplatProps) {
    const rendering = metadata?.rendering;
    const explicitRenderer = String(rendering?.viewer_renderer ?? "").trim().toLowerCase();
    const explicitSource = String(rendering?.viewer_source ?? "").trim();
    const preferredViewerSource = String(viewerUrl ?? explicitSource).trim();
    const preferredPlySource = String(plyUrl ?? "").trim();

    if (preferredViewerSource && (REAL_SPLAT_RENDERERS.has(explicitRenderer) || isLikelyLumaSource(preferredViewerSource))) {
        return { mode: "luma" as const, source: preferredViewerSource };
    }

    if (preferredPlySource && (REAL_SPLAT_RENDERERS.has(explicitRenderer) || isLikelyLumaSource(preferredPlySource))) {
        return { mode: "luma" as const, source: preferredPlySource };
    }

    if (preferredPlySource && (SHARP_GAUSSIAN_RENDERERS.has(explicitRenderer) || explicitRenderer === "")) {
        return { mode: "sharp" as const, source: preferredPlySource };
    }

    if (preferredPlySource) {
        return { mode: "sharp" as const, source: preferredPlySource };
    }

    if (preferredViewerSource) {
        return { mode: "luma" as const, source: preferredViewerSource };
    }

    return { mode: "none" as const, source: "" };
}

function resolveSharpPointBudget() {
    return Number.POSITIVE_INFINITY;
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

function createEmptySharpGaussianPayload() {
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
        shTextureDepth: 1,
        hasRawColorCoefficients: false,
        shBasisCount: 0,
        textureWidth: 1,
        textureHeight: 1,
        count: 0,
        chunks: [],
        sceneRadius: 1,
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

function buildSharpGaussianPayload(sourceGeometry: THREE.BufferGeometry, pointBudget: number, maxTextureSize: number): SharpGaussianPayload {
    const position = sourceGeometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!position || position.itemSize < 3 || position.count === 0) {
        return createEmptySharpGaussianPayload();
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
    const hasRawColorCoefficients = getFiniteAttributeComponentPrefix(shColor, 3) >= 3;
    const shBasisCount = hasRawColorCoefficients
        ? Math.min(SH_MAX_BASIS_COUNT, Math.floor(getFiniteAttributeComponentPrefix(shRest, SH_REST_COMPONENT_COUNT) / 3))
        : 0;
    const shRestComponentCount = shBasisCount * 3;
    const shTextureDepth = Math.max(1, Math.ceil(shRestComponentCount / 4));
    const shColorArray = hasRawColorCoefficients ? (shColor?.array as ArrayLike<number> | undefined) : undefined;
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
    const shData = new Uint16Array(texelCount * 4 * shTextureDepth);
    const fallbackLinearR = fallbackSplatColor.r;
    const fallbackLinearG = fallbackSplatColor.g;
    const fallbackLinearB = fallbackSplatColor.b;
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
            } else {
                colorData[texelOffset + 0] = toHalfFloat(fallbackLinearR);
                colorData[texelOffset + 1] = toHalfFloat(fallbackLinearG);
                colorData[texelOffset + 2] = toHalfFloat(fallbackLinearB);
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
        shTexture: createSharpGaussianArrayTexture(shData, textureWidth, textureHeight, shTextureDepth),
        shTextureDepth,
        hasRawColorCoefficients,
        shBasisCount,
        textureWidth,
        textureHeight,
        count: sampledCount,
        chunks,
        sceneRadius: Math.max(1e-3, sourceGeometry.boundingSphere?.radius ?? 1),
    };
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

function SharpGaussianEnvironmentSplat({ source }: { source: string }) {
    const { gl, size } = useThree();
    const meshRef = useRef<THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial> | null>(null);
    const sourceGeometry = useLoader(PLYLoader, source, (loader) => {
        loader.setCustomPropertyNameMapping(SHARP_PLY_CUSTOM_ATTRIBUTES);
    });
    const pointBudget = useMemo(() => resolveSharpPointBudget(), []);
    const payload = useMemo(
        () => buildSharpGaussianPayload(sourceGeometry, pointBudget, gl.capabilities.maxTextureSize),
        [gl.capabilities.maxTextureSize, pointBudget, sourceGeometry],
    );
    const material = useMemo(
        () =>
            new THREE.ShaderMaterial({
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
                    uShTexture: { value: payload.shTexture },
                    uHasRawColorCoefficients: { value: payload.hasRawColorCoefficients ? 1 : 0 },
                    uHasSphericalHarmonics: { value: payload.shBasisCount > 0 ? 1 : 0 },
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
            }),
        [payload.centerAlphaTexture, payload.colorTexture, payload.hasRawColorCoefficients, payload.rotationTexture, payload.scaleTexture, payload.shBasisCount, payload.shTexture, payload.textureHeight, payload.textureWidth],
    );
    const gpuSorterRef = useRef<SharpGaussianGpuSorter | null>(null);
    const hasSortedRef = useRef(false);
    const visibleChunkIndicesRef = useRef<number[]>([]);
    const frustumRef = useRef(new THREE.Frustum());
    const frustumMatrixRef = useRef(new THREE.Matrix4());
    const worldChunkSphereRef = useRef(new THREE.Sphere());
    const lastSortedCameraPositionRef = useRef(new THREE.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY));
    const lastSortedCameraQuaternionRef = useRef(new THREE.Quaternion());

    useEffect(() => {
        material.uniforms.uViewport.value.set(size.width * gl.getPixelRatio(), size.height * gl.getPixelRatio());
    }, [gl, material, size.height, size.width]);

    useEffect(() => {
        payload.geometry.instanceCount = 0;
        visibleChunkIndicesRef.current = [];
        gpuSorterRef.current?.dispose();
        gpuSorterRef.current = null;
        material.uniforms.uOrderTextureReady.value = 0;
        hasSortedRef.current = false;
        useLoader.clear(PLYLoader, source);
        releaseSharpSourceGeometry(sourceGeometry);

        return () => {
            gpuSorterRef.current?.dispose();
            gpuSorterRef.current = null;
            material.uniforms.uOrderTextureReady.value = 0;
            payload.geometry.instanceCount = 0;
            visibleChunkIndicesRef.current = [];
            hasSortedRef.current = false;
        };
    }, [material, payload, source, sourceGeometry]);

    useFrame(({ camera }) => {
        const mesh = meshRef.current;
        if (!mesh || payload.count === 0 || payload.chunks.length === 0) {
            payload.geometry.instanceCount = 0;
            material.uniforms.uOrderTextureReady.value = 0;
            return;
        }

        mesh.updateMatrixWorld();
        frustumMatrixRef.current.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        frustumRef.current.setFromProjectionMatrix(frustumMatrixRef.current);

        const nextVisibleChunkIndices: number[] = [];
        let visibleCount = 0;

        for (let chunkIndex = 0; chunkIndex < payload.chunks.length; chunkIndex += 1) {
            const chunk = payload.chunks[chunkIndex];
            worldChunkSphereRef.current.copy(chunk.boundingSphere).applyMatrix4(mesh.matrixWorld);
            if (!frustumRef.current.intersectsSphere(worldChunkSphereRef.current)) {
                continue;
            }

            nextVisibleChunkIndices.push(chunkIndex);
            visibleCount += chunk.count;
        }

        const visibilityChanged = !areSharpChunkSelectionsEqual(visibleChunkIndicesRef.current, nextVisibleChunkIndices);
        if (visibilityChanged) {
            visibleChunkIndicesRef.current = nextVisibleChunkIndices;
        }

        payload.geometry.instanceCount = visibleCount;
        if (visibleCount === 0) {
            gpuSorterRef.current?.setActiveIndices(new Uint32Array(0));
            material.uniforms.uOrderTextureReady.value = 0;
            hasSortedRef.current = false;
            return;
        }

        if (visibilityChanged || !gpuSorterRef.current) {
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
        if (!gpuSorter) {
            return;
        }
        const positionDeltaSq = lastSortedCameraPositionRef.current.distanceToSquared(camera.position);
        const translationDelta = Math.sqrt(positionDeltaSq);
        const quaternionAlignment = Math.min(1, Math.abs(lastSortedCameraQuaternionRef.current.dot(camera.quaternion)));
        const angularDelta = 2 * Math.acos(quaternionAlignment);
        const pureRotationDelta = positionDeltaSq <= DIRECT_SORT_POSITION_EPSILON_SQ;
        const pureRotationAngleThreshold = Math.max(DIRECT_SORT_ROTATION_EPSILON * 48, 0.004363323129985824);
        const viewMotionThreshold = Math.max(0.001, payload.sceneRadius * 0.00075);
        const canReuseSort =
            hasSortedRef.current &&
            ((pureRotationDelta && angularDelta <= pureRotationAngleThreshold) || translationDelta + payload.sceneRadius * angularDelta <= viewMotionThreshold);

        if (canReuseSort) {
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
        return () => {
            material.dispose();
        };
    }, [material]);

    useEffect(() => {
        return () => {
            payload.geometry.dispose();
            payload.centerAlphaTexture.dispose();
            payload.colorTexture.dispose();
            payload.scaleTexture.dispose();
            payload.rotationTexture.dispose();
            payload.shTexture.dispose();
        };
    }, [payload]);

    return <mesh ref={meshRef} geometry={payload.geometry} material={material} frustumCulled={false} />;
}

export default function EnvironmentSplat(props: EnvironmentSplatProps) {
    const resolved = resolveEnvironmentRenderSource(props);

    if (resolved.mode === "luma") {
        return <LumaEnvironmentSplat source={resolved.source} />;
    }

    if (resolved.mode === "sharp") {
        return <SharpGaussianEnvironmentSplat source={resolved.source} />;
    }

    return null;
}
