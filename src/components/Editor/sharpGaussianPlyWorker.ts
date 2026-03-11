/// <reference lib="webworker" />

import { DataUtils } from "three";

const SH_REST_COMPONENT_COUNT = 45;
const SH_MAX_BASIS_COUNT = SH_REST_COMPONENT_COUNT / 3;
const TARGET_POINTS_PER_CHUNK = 16384;
const MAX_POINTS_PER_CHUNK = 32768;
const MAX_CHUNK_OCTREE_LEVEL = 6;
const PROGRESS_INTERVAL = 262144;
const HALF_FLOAT_MAX = 65504;
const DEFAULT_SPLAT_SCALE = 0.02;
const PREVIEW_FOCUS_SAMPLE_TARGET = 16384;
const PREVIEW_FOCUS_MIN_QUANTILE = 0.12;
const PREVIEW_FOCUS_MAX_QUANTILE = 0.88;
const PREVIEW_FOCUS_RADIUS_QUANTILE = 0.9;
const PREVIEW_FOCUS_RADIUS_MARGIN = 1.08;

type ColorPayloadMode = "albedo_linear" | "albedo_srgb" | "sh_dc";

type WorkerProperty = {
    name: string;
    type: string;
    offset: number;
    size: number;
};

type WorkerElement = {
    name: string;
    count: number;
    properties: WorkerProperty[];
    stride: number;
};

type WorkerHeader = {
    format: string;
    headerLength: number;
    elements: WorkerElement[];
};

type WorkerBounds = {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
};

type WorkerChunk = {
    sourceIndices: number[];
    code: number;
    bounds: WorkerBounds;
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

type SerializedSharpGaussianDebugSample = {
    sampleIndex: number;
    sourceIndex: number;
    position: [number, number, number];
    scale: [number, number, number];
    color: [number, number, number];
    colorPayloadMode: ColorPayloadMode;
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
    colorPayloadMode: ColorPayloadMode;
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
    debugSamples: SerializedSharpGaussianDebugSample[];
};

type ParseRequest = {
    type: "parse";
    buffer: ArrayBuffer;
    pointBudget: number;
    maxTextureSize: number;
    colorEncoding?: string | null;
    applyPreviewOrientation?: boolean;
};

const PROPERTY_SIZES: Record<string, number> = {
    char: 1,
    uchar: 1,
    int8: 1,
    uint8: 1,
    short: 2,
    ushort: 2,
    int16: 2,
    uint16: 2,
    int: 4,
    uint: 4,
    int32: 4,
    uint32: 4,
    float: 4,
    float32: 4,
    double: 8,
    float64: 8,
};

function clamp01(value: number) {
    return Math.min(1, Math.max(0, value));
}

function sigmoid(value: number) {
    return 1 / (1 + Math.exp(-value));
}

function srgbByteOrUnitToUnit(value: number) {
    if (!Number.isFinite(value)) {
        return 0;
    }

    const normalized = value > 1 ? value / 255 : value;
    return clamp01(normalized);
}

function srgbUnitToLinear(value: number) {
    const normalized = clamp01(value);
    if (normalized <= 0.04045) {
        return normalized / 12.92;
    }
    return ((normalized + 0.055) / 1.055) ** 2.4;
}

function rotatePreviewOrientationPosition(y: number, z: number) {
    return {
        y: -y,
        z: -z,
    };
}

function rotatePreviewOrientationQuaternion(x: number, y: number, z: number, w: number) {
    return {
        x: w,
        y: -z,
        z: y,
        w: -x,
    };
}

function boundsCenter(bounds: WorkerBounds) {
    return [
        (bounds.minX + bounds.maxX) * 0.5,
        (bounds.minY + bounds.maxY) * 0.5,
        (bounds.minZ + bounds.maxZ) * 0.5,
    ] as const;
}

function boundsSphere(bounds: WorkerBounds) {
    const center = boundsCenter(bounds);
    const dx = bounds.maxX - center[0];
    const dy = bounds.maxY - center[1];
    const dz = bounds.maxZ - center[2];
    return {
        center,
        radius: Math.sqrt(dx * dx + dy * dy + dz * dz),
    };
}

function sanitizeFinite(value: number, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}

function sanitizeBounds(bounds: WorkerBounds): WorkerBounds {
    let minX = sanitizeFinite(bounds.minX, 0);
    let minY = sanitizeFinite(bounds.minY, 0);
    let minZ = sanitizeFinite(bounds.minZ, 0);
    let maxX = sanitizeFinite(bounds.maxX, minX);
    let maxY = sanitizeFinite(bounds.maxY, minY);
    let maxZ = sanitizeFinite(bounds.maxZ, minZ);

    if (maxX < minX) [minX, maxX] = [maxX, minX];
    if (maxY < minY) [minY, maxY] = [maxY, minY];
    if (maxZ < minZ) [minZ, maxZ] = [maxZ, minZ];

    return { minX, minY, minZ, maxX, maxY, maxZ };
}

function sanitizeRadius(radius: number) {
    return Number.isFinite(radius) && radius > 1e-6 ? radius : 1e-3;
}

function sanitizePositiveInteger(value: number, label: string) {
    const normalized = Math.floor(sanitizeFinite(value, 0));
    if (!Number.isSafeInteger(normalized) || normalized < 1) {
        throw new Error(`${label} must be a positive integer.`);
    }
    return normalized;
}

function sanitizeHalfFloatValue(value: number, fallback = 0) {
    const finite = sanitizeFinite(value, fallback);
    return Math.min(HALF_FLOAT_MAX, Math.max(-HALF_FLOAT_MAX, finite));
}

function sanitizeNonNegativeHalfFloatValue(value: number, fallback = 0) {
    return Math.min(HALF_FLOAT_MAX, Math.max(0, sanitizeHalfFloatValue(value, fallback)));
}

function quantileFromSorted(values: number[], quantile: number) {
    if (values.length === 0) {
        return 0;
    }

    if (values.length === 1) {
        return values[0];
    }

    const normalizedQuantile = Math.min(1, Math.max(0, quantile));
    const position = normalizedQuantile * (values.length - 1);
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.min(values.length - 1, Math.ceil(position));
    if (lowerIndex === upperIndex) {
        return values[lowerIndex];
    }

    const weight = position - lowerIndex;
    return (values[lowerIndex] * (1 - weight)) + (values[upperIndex] * weight);
}

function normalizeVector3(
    x: number,
    y: number,
    z: number,
    fallback: readonly [number, number, number] = [0, 0, 1],
): [number, number, number] {
    const length = Math.hypot(x, y, z);
    if (!Number.isFinite(length) || length <= 1e-6) {
        return [fallback[0], fallback[1], fallback[2]];
    }
    return [x / length, y / length, z / length];
}

function resolvePreviewFocusSphere(
    positions: Float32Array,
    sampledCount: number,
    fallbackSphere: { center: readonly [number, number, number]; radius: number },
) {
    const sampleTarget = Math.min(sampledCount, PREVIEW_FOCUS_SAMPLE_TARGET);
    if (sampleTarget < 8) {
        return {
            center: [fallbackSphere.center[0], fallbackSphere.center[1], fallbackSphere.center[2]] as [number, number, number],
            radius: sanitizeRadius(fallbackSphere.radius),
            forward: [0, 0, 1] as [number, number, number],
        };
    }

    const stride = Math.max(1, Math.floor(sampledCount / sampleTarget));
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];
    for (let sampleIndex = 0; sampleIndex < sampledCount && xs.length < sampleTarget; sampleIndex += stride) {
        const positionOffset = sampleIndex * 3;
        xs.push(positions[positionOffset + 0]);
        ys.push(positions[positionOffset + 1]);
        zs.push(positions[positionOffset + 2]);
    }

    const lastPositionOffset = Math.max(0, (sampledCount - 1) * 3);
    if (
        xs.length > 0 &&
        (xs[xs.length - 1] !== positions[lastPositionOffset + 0] ||
            ys[ys.length - 1] !== positions[lastPositionOffset + 1] ||
            zs[zs.length - 1] !== positions[lastPositionOffset + 2])
    ) {
        xs.push(positions[lastPositionOffset + 0]);
        ys.push(positions[lastPositionOffset + 1]);
        zs.push(positions[lastPositionOffset + 2]);
    }

    const sortedX = [...xs].sort((left, right) => left - right);
    const sortedY = [...ys].sort((left, right) => left - right);
    const sortedZ = [...zs].sort((left, right) => left - right);

    const center: [number, number, number] = [
        sanitizeFinite(
            (quantileFromSorted(sortedX, PREVIEW_FOCUS_MIN_QUANTILE) + quantileFromSorted(sortedX, PREVIEW_FOCUS_MAX_QUANTILE)) * 0.5,
            fallbackSphere.center[0],
        ),
        sanitizeFinite(
            (quantileFromSorted(sortedY, PREVIEW_FOCUS_MIN_QUANTILE) + quantileFromSorted(sortedY, PREVIEW_FOCUS_MAX_QUANTILE)) * 0.5,
            fallbackSphere.center[1],
        ),
        sanitizeFinite(
            (quantileFromSorted(sortedZ, PREVIEW_FOCUS_MIN_QUANTILE) + quantileFromSorted(sortedZ, PREVIEW_FOCUS_MAX_QUANTILE)) * 0.5,
            fallbackSphere.center[2],
        ),
    ];

    const spans = [
        Math.max(1e-6, quantileFromSorted(sortedX, PREVIEW_FOCUS_MAX_QUANTILE) - quantileFromSorted(sortedX, PREVIEW_FOCUS_MIN_QUANTILE)),
        Math.max(1e-6, quantileFromSorted(sortedY, PREVIEW_FOCUS_MAX_QUANTILE) - quantileFromSorted(sortedY, PREVIEW_FOCUS_MIN_QUANTILE)),
        Math.max(1e-6, quantileFromSorted(sortedZ, PREVIEW_FOCUS_MAX_QUANTILE) - quantileFromSorted(sortedZ, PREVIEW_FOCUS_MIN_QUANTILE)),
    ] as const;
    const primaryAxis = spans[0] <= spans[1] && spans[0] <= spans[2] ? 0 : spans[1] <= spans[2] ? 1 : 2;
    const secondaryAxis = spans[0] >= spans[1] && spans[0] >= spans[2] ? 0 : spans[1] >= spans[2] ? 1 : 2;
    const rawForward: [number, number, number] = [0, 0, 0];
    rawForward[primaryAxis] = 1;
    if (secondaryAxis !== primaryAxis) {
        rawForward[secondaryAxis] = 0.28;
    } else {
        rawForward[2] = 0.28;
    }

    const distances: number[] = [];
    const distanceStride = Math.max(1, Math.floor(sampledCount / Math.max(1, xs.length)));
    for (let sampleIndex = 0; sampleIndex < sampledCount; sampleIndex += distanceStride) {
        const positionOffset = sampleIndex * 3;
        const dx = positions[positionOffset + 0] - center[0];
        const dy = positions[positionOffset + 1] - center[1];
        const dz = positions[positionOffset + 2] - center[2];
        distances.push(Math.sqrt((dx * dx) + (dy * dy) + (dz * dz)));
    }

    distances.sort((left, right) => left - right);
    const quantileRadius = sanitizeFinite(quantileFromSorted(distances, PREVIEW_FOCUS_RADIUS_QUANTILE), fallbackSphere.radius);
    const minimumRadius = Math.max(1e-3, fallbackSphere.radius * 0.08);
    const radius = Math.min(
        sanitizeRadius(fallbackSphere.radius),
        Math.max(minimumRadius, quantileRadius * PREVIEW_FOCUS_RADIUS_MARGIN),
    );

    return {
        center,
        radius: sanitizeRadius(radius),
        forward: normalizeVector3(rawForward[0], rawForward[1], rawForward[2]),
    };
}

function toSafeHalfFloat(value: number, fallback = 0) {
    return DataUtils.toHalfFloat(sanitizeHalfFloatValue(value, fallback));
}

function resolveTextureDimensions(sampledCount: number, maxTextureSize: number) {
    const safeSampledCount = sanitizePositiveInteger(sampledCount, "Sample count");
    const safeMaxTextureSize = sanitizePositiveInteger(maxTextureSize, "WebGL max texture size");
    const width = sanitizePositiveInteger(
        Math.min(safeMaxTextureSize, Math.max(1, Math.ceil(Math.sqrt(safeSampledCount)))),
        "Texture width",
    );
    const height = sanitizePositiveInteger(Math.ceil(safeSampledCount / width), "Texture height");

    if (width > safeMaxTextureSize || height > safeMaxTextureSize) {
        throw new Error(`Ultra splat renderer exceeded the available WebGL texture size (${safeMaxTextureSize}).`);
    }

    const texelCount = width * height;
    if (!Number.isSafeInteger(texelCount) || texelCount < safeSampledCount) {
        throw new Error("Ultra splat worker produced invalid texture dimensions.");
    }

    return {
        width,
        height,
        texelCount,
        maxTextureSize: safeMaxTextureSize,
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

function computeChunkBounds(sourceIndices: number[], positionArray: Float32Array): WorkerBounds {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < sourceIndices.length; index += 1) {
        const offset = sourceIndices[index] * 3;
        const x = positionArray[offset + 0];
        const y = positionArray[offset + 1];
        const z = positionArray[offset + 2];
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        minZ = Math.min(minZ, z);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        maxZ = Math.max(maxZ, z);
    }

    return { minX, minY, minZ, maxX, maxY, maxZ };
}

function computeSharpChunkOctant(positionArray: Float32Array, sourceIndex: number, centerX: number, centerY: number, centerZ: number) {
    const offset = sourceIndex * 3;
    let octant = 0;

    if (positionArray[offset + 0] >= centerX) octant |= 1;
    if (positionArray[offset + 1] >= centerY) octant |= 2;
    if (positionArray[offset + 2] >= centerZ) octant |= 4;

    return octant;
}

function computeSharpChunkBoundsForOctant(bounds: WorkerBounds, octant: number): WorkerBounds {
    const center = boundsCenter(bounds);
    return {
        minX: (octant & 1) === 0 ? bounds.minX : center[0],
        minY: (octant & 2) === 0 ? bounds.minY : center[1],
        minZ: (octant & 4) === 0 ? bounds.minZ : center[2],
        maxX: (octant & 1) === 0 ? center[0] : bounds.maxX,
        maxY: (octant & 2) === 0 ? center[1] : bounds.maxY,
        maxZ: (octant & 4) === 0 ? center[2] : bounds.maxZ,
    };
}

function appendSharpGaussianChunks(
    sourceIndices: number[],
    positionArray: Float32Array,
    bounds: WorkerBounds,
    level: number,
    code: number,
    target: WorkerChunk[],
) {
    if (sourceIndices.length === 0) {
        return;
    }

    if (sourceIndices.length <= MAX_POINTS_PER_CHUNK || level >= MAX_CHUNK_OCTREE_LEVEL) {
        for (let start = 0; start < sourceIndices.length; start += MAX_POINTS_PER_CHUNK) {
            const chunkSourceIndices = sourceIndices.slice(start, start + MAX_POINTS_PER_CHUNK);
            target.push({
                sourceIndices: chunkSourceIndices,
                code,
                bounds: computeChunkBounds(chunkSourceIndices, positionArray),
            });
        }
        return;
    }

    const center = boundsCenter(bounds);
    const childBuckets = Array.from({ length: 8 }, () => [] as number[]);

    for (let index = 0; index < sourceIndices.length; index += 1) {
        const sourceIndex = sourceIndices[index];
        childBuckets[computeSharpChunkOctant(positionArray, sourceIndex, center[0], center[1], center[2])].push(sourceIndex);
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

function computeCodeForPoint(x: number, y: number, z: number, bounds: WorkerBounds, level: number) {
    let minX = bounds.minX;
    let minY = bounds.minY;
    let minZ = bounds.minZ;
    let maxX = bounds.maxX;
    let maxY = bounds.maxY;
    let maxZ = bounds.maxZ;
    let code = 0;

    for (let cursor = 0; cursor < level; cursor += 1) {
        const centerX = (minX + maxX) * 0.5;
        const centerY = (minY + maxY) * 0.5;
        const centerZ = (minZ + maxZ) * 0.5;
        let octant = 0;

        if (x >= centerX) {
            octant |= 1;
            minX = centerX;
        } else {
            maxX = centerX;
        }

        if (y >= centerY) {
            octant |= 2;
            minY = centerY;
        } else {
            maxY = centerY;
        }

        if (z >= centerZ) {
            octant |= 4;
            minZ = centerZ;
        } else {
            maxZ = centerZ;
        }

        code = (code << 3) | octant;
    }

    return code;
}

function readHeader(bytes: Uint8Array) {
    let index = 0;
    let line = "";
    const lines: string[] = [];
    const hasCrLf = /^ply\r\n/.test(new TextDecoder().decode(bytes.subarray(0, 5)));

    while (index < bytes.length) {
        const char = String.fromCharCode(bytes[index]);
        index += 1;

        if (char !== "\n" && char !== "\r") {
            line += char;
            continue;
        }

        if (line !== "") {
            lines.push(line);
            if (line === "end_header") {
                break;
            }
            line = "";
        }
    }

    if (hasCrLf) {
        index += 1;
    }

    return {
        headerText: lines.join("\r") + "\r",
        headerLength: index,
    };
}

function parseHeader(data: ArrayBuffer): WorkerHeader {
    const bytes = new Uint8Array(data);
    const { headerText, headerLength } = readHeader(bytes);
    const lines = headerText.split(/\r\n|\r|\n/);

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const rawLine = lines[lineIndex].trim();
        if (!rawLine) {
            continue;
        }

        const tokens = rawLine.split(/\s+/);
        const lineType = tokens.shift();
        if (!lineType) {
            continue;
        }

        if (lineType === "format") {
            const format = tokens[0] ?? "";
            return {
                format,
                headerLength,
                elements: parseHeaderElements(lines),
            };
        }
    }

    throw new Error("PLY header is missing a format line.");
}

function parseHeaderElements(lines: string[]): WorkerElement[] {
    const elements: WorkerElement[] = [];
    let currentElement: WorkerElement | null = null;

    const flushElement = () => {
        if (currentElement) {
            elements.push(currentElement);
        }
    };

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const rawLine = lines[lineIndex].trim();
        if (!rawLine) {
            continue;
        }

        const tokens = rawLine.split(/\s+/);
        const lineType = tokens.shift();
        if (!lineType) {
            continue;
        }

        if (lineType === "element") {
            flushElement();
            currentElement = {
                name: tokens[0] ?? "",
                count: Number(tokens[1] ?? 0),
                properties: [],
                stride: 0,
            };
            continue;
        }

        if (lineType === "property" && currentElement) {
            if (tokens[0] === "list") {
                throw new Error("PLY list properties are not supported by the ultra splat worker.");
            }

            const propertyType = tokens[0] ?? "";
            const propertyName = tokens[1] ?? "";
            const propertySize = PROPERTY_SIZES[propertyType];

            if (!propertySize) {
                throw new Error(`Unsupported PLY property type: ${propertyType}`);
            }

            currentElement.properties.push({
                name: propertyName,
                type: propertyType,
                offset: currentElement.stride,
                size: propertySize,
            });
            currentElement.stride += propertySize;
        }
    }

    flushElement();
    return elements;
}

function makeScalarReader(dataView: DataView, offset: number, type: string, littleEndian: boolean) {
    switch (type) {
        case "char":
        case "int8":
            return (vertexOffset: number) => dataView.getInt8(vertexOffset + offset);
        case "uchar":
        case "uint8":
            return (vertexOffset: number) => dataView.getUint8(vertexOffset + offset);
        case "short":
        case "int16":
            return (vertexOffset: number) => dataView.getInt16(vertexOffset + offset, littleEndian);
        case "ushort":
        case "uint16":
            return (vertexOffset: number) => dataView.getUint16(vertexOffset + offset, littleEndian);
        case "int":
        case "int32":
            return (vertexOffset: number) => dataView.getInt32(vertexOffset + offset, littleEndian);
        case "uint":
        case "uint32":
            return (vertexOffset: number) => dataView.getUint32(vertexOffset + offset, littleEndian);
        case "float":
        case "float32":
            return (vertexOffset: number) => dataView.getFloat32(vertexOffset + offset, littleEndian);
        case "double":
        case "float64":
            return (vertexOffset: number) => dataView.getFloat64(vertexOffset + offset, littleEndian);
        default:
            throw new Error(`Unsupported PLY scalar type: ${type}`);
    }
}

function findProperty(propertyMap: Map<string, WorkerProperty>, aliases: string[]) {
    for (let aliasIndex = 0; aliasIndex < aliases.length; aliasIndex += 1) {
        const property = propertyMap.get(aliases[aliasIndex]);
        if (property) {
            return property;
        }
    }

    return null;
}

function inferColorPayloadMode({
    hasBaseColor,
    hasShColor,
    shColorMin,
    shColorMax,
    colorEncoding,
}: {
    hasBaseColor: boolean;
    hasShColor: boolean;
    shColorMin: number;
    shColorMax: number;
    colorEncoding?: string | null;
}): ColorPayloadMode {
    if (hasBaseColor) {
        return "albedo_linear";
    }

    if (!hasShColor) {
        return "albedo_linear";
    }

    if (String(colorEncoding ?? "").trim().toLowerCase() === "sh_dc_rgb") {
        return "sh_dc";
    }

    if (shColorMin < -0.01) {
        return "sh_dc";
    }

    if (shColorMax <= 1.001 || shColorMax >= 4.0) {
        return "albedo_srgb";
    }

    return "sh_dc";
}

function postProgress(label: string) {
    if (typeof self !== "undefined" && typeof self.postMessage === "function") {
        self.postMessage({ type: "progress", label });
    }
}

export function parsePackedSharpGaussianPayload({
    buffer,
    pointBudget,
    maxTextureSize,
    colorEncoding,
    applyPreviewOrientation = false,
}: {
    buffer: ArrayBuffer;
    pointBudget: number;
    maxTextureSize: number;
    colorEncoding?: string | null;
    applyPreviewOrientation?: boolean;
}): SerializedSharpGaussianPayload {
    const header = parseHeader(buffer);
    if (header.format !== "binary_little_endian") {
        throw new Error(`Ultra splat worker only supports binary_little_endian PLY files, received ${header.format || "unknown"}.`);
    }

    const vertexElementIndex = header.elements.findIndex((element) => element.name === "vertex");
    if (vertexElementIndex === -1) {
        throw new Error("PLY file does not contain a vertex element.");
    }

    const vertexElement = header.elements[vertexElementIndex];
    const vertexCount = vertexElement.count;
    if (vertexCount <= 0) {
        throw new Error("PLY file does not contain any vertices.");
    }

    let vertexSectionOffset = header.headerLength;
    for (let elementIndex = 0; elementIndex < vertexElementIndex; elementIndex += 1) {
        const element = header.elements[elementIndex];
        vertexSectionOffset += element.count * element.stride;
    }

    const sampledCount = Number.isFinite(pointBudget)
        ? Math.min(vertexCount, Math.max(1, Math.round(pointBudget)))
        : vertexCount;
    const textureDimensions = resolveTextureDimensions(sampledCount, maxTextureSize);
    const textureWidth = textureDimensions.width;
    const textureHeight = textureDimensions.height;

    const dataView = new DataView(buffer);
    const propertyMap = new Map(vertexElement.properties.map((property) => [property.name, property]));
    const xProperty = findProperty(propertyMap, ["x", "px", "posx"]);
    const yProperty = findProperty(propertyMap, ["y", "py", "posy"]);
    const zProperty = findProperty(propertyMap, ["z", "pz", "posz"]);

    if (!xProperty || !yProperty || !zProperty) {
        throw new Error("PLY vertex element is missing position properties.");
    }

    const readX = makeScalarReader(dataView, vertexSectionOffset + xProperty.offset, xProperty.type, true);
    const readY = makeScalarReader(dataView, vertexSectionOffset + yProperty.offset, yProperty.type, true);
    const readZ = makeScalarReader(dataView, vertexSectionOffset + zProperty.offset, zProperty.type, true);
    const fdc0 = propertyMap.get("f_dc_0");
    const fdc1 = propertyMap.get("f_dc_1");
    const fdc2 = propertyMap.get("f_dc_2");
    const hasShColor = Boolean(fdc0 && fdc1 && fdc2);
    const readSh0 = fdc0 ? makeScalarReader(dataView, vertexSectionOffset + fdc0.offset, fdc0.type, true) : null;
    const readSh1 = fdc1 ? makeScalarReader(dataView, vertexSectionOffset + fdc1.offset, fdc1.type, true) : null;
    const readSh2 = fdc2 ? makeScalarReader(dataView, vertexSectionOffset + fdc2.offset, fdc2.type, true) : null;
    const redProperty = findProperty(propertyMap, ["red", "diffuse_red", "r", "diffuse_r"]);
    const greenProperty = findProperty(propertyMap, ["green", "diffuse_green", "g", "diffuse_g"]);
    const blueProperty = findProperty(propertyMap, ["blue", "diffuse_blue", "b", "diffuse_b"]);
    const hasBaseColor = Boolean(redProperty && greenProperty && blueProperty);
    const readRed = redProperty ? makeScalarReader(dataView, vertexSectionOffset + redProperty.offset, redProperty.type, true) : null;
    const readGreen = greenProperty ? makeScalarReader(dataView, vertexSectionOffset + greenProperty.offset, greenProperty.type, true) : null;
    const readBlue = blueProperty ? makeScalarReader(dataView, vertexSectionOffset + blueProperty.offset, blueProperty.type, true) : null;
    const opacityProperty = propertyMap.get("opacity");
    const readOpacity = opacityProperty ? makeScalarReader(dataView, vertexSectionOffset + opacityProperty.offset, opacityProperty.type, true) : null;
    const scaleReaders = ["scale_0", "scale_1", "scale_2"].map((propertyName) => {
        const property = propertyMap.get(propertyName);
        return property ? makeScalarReader(dataView, vertexSectionOffset + property.offset, property.type, true) : null;
    });
    const rotationReaders = ["rot_0", "rot_1", "rot_2", "rot_3"].map((propertyName) => {
        const property = propertyMap.get(propertyName);
        return property ? makeScalarReader(dataView, vertexSectionOffset + property.offset, property.type, true) : null;
    });

    const shRestProperties: WorkerProperty[] = [];
    for (let componentIndex = 0; componentIndex < SH_REST_COMPONENT_COUNT; componentIndex += 1) {
        const property = propertyMap.get(`f_rest_${componentIndex}`);
        if (!property) {
            break;
        }
        shRestProperties.push(property);
    }
    const shRestReaders = shRestProperties.map((property) =>
        makeScalarReader(dataView, vertexSectionOffset + property.offset, property.type, true),
    );

    const positions = new Float32Array(sampledCount * 3);
    const sampledSourceIndices = new Uint32Array(sampledCount);
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    let shColorMin = Number.POSITIVE_INFINITY;
    let shColorMax = Number.NEGATIVE_INFINITY;
    let validPositionCount = 0;
    const debugSamples: SerializedSharpGaussianDebugSample[] = [];

    postProgress("Scanning dense PLY header and positions...");

    for (let sampleIndex = 0; sampleIndex < sampledCount; sampleIndex += 1) {
        const sourceIndex =
            sampledCount === vertexCount ? sampleIndex : Math.min(vertexCount - 1, Math.floor((sampleIndex * vertexCount) / sampledCount));
        sampledSourceIndices[sampleIndex] = sourceIndex;
        const vertexOffset = sourceIndex * vertexElement.stride;
        const positionOffset = sampleIndex * 3;
        const rawX = Number(readX(vertexOffset));
        const rawY = Number(readY(vertexOffset));
        const rawZ = Number(readZ(vertexOffset));
        const rotatedPosition = applyPreviewOrientation
            ? rotatePreviewOrientationPosition(rawY, rawZ)
            : { y: rawY, z: rawZ };
        const hasFinitePosition =
            Number.isFinite(rawX) &&
            Number.isFinite(rotatedPosition.y) &&
            Number.isFinite(rotatedPosition.z);
        const x = sanitizeFinite(rawX, 0);
        const y = sanitizeFinite(rotatedPosition.y, 0);
        const z = sanitizeFinite(rotatedPosition.z, 0);

        positions[positionOffset + 0] = x;
        positions[positionOffset + 1] = y;
        positions[positionOffset + 2] = z;

        if (hasFinitePosition) {
            validPositionCount += 1;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            minZ = Math.min(minZ, z);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
            maxZ = Math.max(maxZ, z);
        }

        if (readSh0 && readSh1 && readSh2) {
            const sh0 = sanitizeFinite(Number(readSh0(vertexOffset)), 0);
            const sh1 = sanitizeFinite(Number(readSh1(vertexOffset)), 0);
            const sh2 = sanitizeFinite(Number(readSh2(vertexOffset)), 0);
            shColorMin = Math.min(shColorMin, sh0, sh1, sh2);
            shColorMax = Math.max(shColorMax, sh0, sh1, sh2);
        }

        if (debugSamples.length < 3) {
            let color: [number, number, number] = [0, 0, 0];
            if (readRed && readGreen && readBlue) {
                color = [
                    sanitizeHalfFloatValue(srgbUnitToLinear(Number(readRed(vertexOffset)) / 255), 0),
                    sanitizeHalfFloatValue(srgbUnitToLinear(Number(readGreen(vertexOffset)) / 255), 0),
                    sanitizeHalfFloatValue(srgbUnitToLinear(Number(readBlue(vertexOffset)) / 255), 0),
                ];
            } else if (readSh0 && readSh1 && readSh2) {
                color = [
                    sanitizeHalfFloatValue(Number(readSh0(vertexOffset)), 0),
                    sanitizeHalfFloatValue(Number(readSh1(vertexOffset)), 0),
                    sanitizeHalfFloatValue(Number(readSh2(vertexOffset)), 0),
                ];
            }

            debugSamples.push({
                sampleIndex,
                sourceIndex,
                position: [x, y, z],
                scale: [
                    sanitizeNonNegativeHalfFloatValue(
                        scaleReaders[0] ? Math.exp(Number(scaleReaders[0](vertexOffset))) : DEFAULT_SPLAT_SCALE,
                        DEFAULT_SPLAT_SCALE,
                    ),
                    sanitizeNonNegativeHalfFloatValue(
                        scaleReaders[1] ? Math.exp(Number(scaleReaders[1](vertexOffset))) : DEFAULT_SPLAT_SCALE,
                        DEFAULT_SPLAT_SCALE,
                    ),
                    sanitizeNonNegativeHalfFloatValue(
                        scaleReaders[2] ? Math.exp(Number(scaleReaders[2](vertexOffset))) : DEFAULT_SPLAT_SCALE,
                        DEFAULT_SPLAT_SCALE,
                    ),
                ],
                color,
                colorPayloadMode: hasBaseColor
                    ? "albedo_linear"
                    : hasShColor
                      ? String(colorEncoding ?? "").trim().toLowerCase() === "sh_dc_rgb"
                          ? "sh_dc"
                          : "sh_dc"
                      : "albedo_linear",
            });
        }

        if (sampleIndex > 0 && sampleIndex % PROGRESS_INTERVAL === 0) {
            postProgress(`Scanning dense PLY positions... ${Math.round((sampleIndex / sampledCount) * 100)}%`);
        }
    }

    if (validPositionCount === 0) {
        throw new Error("PLY payload did not produce any finite positions.");
    }

    const rootBounds = sanitizeBounds({ minX, minY, minZ, maxX, maxY, maxZ });
    const rootSphere = boundsSphere(rootBounds);
    const previewFocusSphere = resolvePreviewFocusSphere(positions, sampledCount, rootSphere);
    const colorPayloadMode = inferColorPayloadMode({
        hasBaseColor,
        hasShColor,
        shColorMin,
        shColorMax,
        colorEncoding,
    });
    const shBasisCount = colorPayloadMode === "sh_dc" ? Math.min(SH_MAX_BASIS_COUNT, Math.floor(shRestReaders.length / 3)) : 0;
    const shRestComponentCount = shBasisCount * 3;
    const shTextureDepth = shBasisCount > 0
        ? sanitizePositiveInteger(Math.max(1, Math.ceil(shRestComponentCount / 4)), "SH texture depth")
        : 1;
    const shTextureWidth = shBasisCount > 0 ? textureWidth : 1;
    const shTextureHeight = shBasisCount > 0 ? textureHeight : 1;
    sanitizePositiveInteger(shTextureWidth, "SH texture width");
    sanitizePositiveInteger(shTextureHeight, "SH texture height");
    const rootLevel = resolveSharpChunkOctreeLevel(sampledCount);
    const rootBuckets = new Map<number, number[]>();

    if (rootLevel === 0) {
        rootBuckets.set(
            0,
            Array.from({ length: sampledCount }, (_, sampleIndex) => sampleIndex),
        );
    } else {
        postProgress("Partitioning spatial chunks...");
        for (let sampleIndex = 0; sampleIndex < sampledCount; sampleIndex += 1) {
            const offset = sampleIndex * 3;
            const code = computeCodeForPoint(
                positions[offset + 0],
                positions[offset + 1],
                positions[offset + 2],
                rootBounds,
                rootLevel,
            );
            const bucket = rootBuckets.get(code);
            if (bucket) {
                bucket.push(sampleIndex);
            } else {
                rootBuckets.set(code, [sampleIndex]);
            }
        }
    }

    const chunkBuckets: WorkerChunk[] = [];
    rootBuckets.forEach((sourceIndices, code) => {
        appendSharpGaussianChunks(sourceIndices, positions, computeChunkBounds(sourceIndices, positions), rootLevel, code, chunkBuckets);
    });
    chunkBuckets.sort((left, right) => left.code - right.code);

    const texelCount = textureDimensions.texelCount;
    const centerAlphaData = new Uint16Array(texelCount * 4);
    const colorData = new Uint16Array(texelCount * 4);
    const scaleData = new Uint16Array(texelCount * 4);
    const rotationData = new Uint16Array(texelCount * 4);
    const shData = new Uint16Array(shBasisCount > 0 ? texelCount * 4 * shTextureDepth : 4);
    const chunks: SerializedSharpGaussianChunk[] = [];
    let sampleOffset = 0;

    postProgress("Packing dense splat textures...");

    for (let chunkIndex = 0; chunkIndex < chunkBuckets.length; chunkIndex += 1) {
        const chunkBucket = chunkBuckets[chunkIndex];
        const chunkStart = sampleOffset;

        for (let localIndex = 0; localIndex < chunkBucket.sourceIndices.length; localIndex += 1) {
            const sampleIndex = chunkBucket.sourceIndices[localIndex];
            const sourceIndex = sampledSourceIndices[sampleIndex];
            const vertexOffset = sourceIndex * vertexElement.stride;
            const positionOffset = sampleIndex * 3;
            const texelOffset = sampleOffset * 4;
            const position: [number, number, number] = [
                sanitizeHalfFloatValue(positions[positionOffset + 0], 0),
                sanitizeHalfFloatValue(positions[positionOffset + 1], 0),
                sanitizeHalfFloatValue(positions[positionOffset + 2], 0),
            ];
            const scale: [number, number, number] = [
                sanitizeNonNegativeHalfFloatValue(
                    scaleReaders[0] ? Math.exp(Number(scaleReaders[0](vertexOffset))) : DEFAULT_SPLAT_SCALE,
                    DEFAULT_SPLAT_SCALE,
                ),
                sanitizeNonNegativeHalfFloatValue(
                    scaleReaders[1] ? Math.exp(Number(scaleReaders[1](vertexOffset))) : DEFAULT_SPLAT_SCALE,
                    DEFAULT_SPLAT_SCALE,
                ),
                sanitizeNonNegativeHalfFloatValue(
                    scaleReaders[2] ? Math.exp(Number(scaleReaders[2](vertexOffset))) : DEFAULT_SPLAT_SCALE,
                    DEFAULT_SPLAT_SCALE,
                ),
            ];

            centerAlphaData[texelOffset + 0] = toSafeHalfFloat(position[0], 0);
            centerAlphaData[texelOffset + 1] = toSafeHalfFloat(position[1], 0);
            centerAlphaData[texelOffset + 2] = toSafeHalfFloat(position[2], 0);
            centerAlphaData[texelOffset + 3] = toSafeHalfFloat(
                readOpacity ? clamp01(sigmoid(sanitizeFinite(Number(readOpacity(vertexOffset)), 0))) : 0.92,
                0.92,
            );

            if (colorPayloadMode === "albedo_linear" && readRed && readGreen && readBlue) {
                colorData[texelOffset + 0] = toSafeHalfFloat(sanitizeHalfFloatValue(srgbUnitToLinear(Number(readRed(vertexOffset)) / 255), 0), 0);
                colorData[texelOffset + 1] = toSafeHalfFloat(sanitizeHalfFloatValue(srgbUnitToLinear(Number(readGreen(vertexOffset)) / 255), 0), 0);
                colorData[texelOffset + 2] = toSafeHalfFloat(sanitizeHalfFloatValue(srgbUnitToLinear(Number(readBlue(vertexOffset)) / 255), 0), 0);
            } else if (colorPayloadMode === "albedo_srgb" && readSh0 && readSh1 && readSh2) {
                colorData[texelOffset + 0] = toSafeHalfFloat(sanitizeHalfFloatValue(srgbByteOrUnitToUnit(Number(readSh0(vertexOffset))), 0), 0);
                colorData[texelOffset + 1] = toSafeHalfFloat(sanitizeHalfFloatValue(srgbByteOrUnitToUnit(Number(readSh1(vertexOffset))), 0), 0);
                colorData[texelOffset + 2] = toSafeHalfFloat(sanitizeHalfFloatValue(srgbByteOrUnitToUnit(Number(readSh2(vertexOffset))), 0), 0);
            } else if (readSh0 && readSh1 && readSh2) {
                colorData[texelOffset + 0] = toSafeHalfFloat(Number(readSh0(vertexOffset)), 0);
                colorData[texelOffset + 1] = toSafeHalfFloat(Number(readSh1(vertexOffset)), 0);
                colorData[texelOffset + 2] = toSafeHalfFloat(Number(readSh2(vertexOffset)), 0);
            }
            colorData[texelOffset + 3] = toSafeHalfFloat(1, 1);

            scaleData[texelOffset + 0] = toSafeHalfFloat(scale[0], DEFAULT_SPLAT_SCALE);
            scaleData[texelOffset + 1] = toSafeHalfFloat(scale[1], DEFAULT_SPLAT_SCALE);
            scaleData[texelOffset + 2] = toSafeHalfFloat(scale[2], DEFAULT_SPLAT_SCALE);

            const rotationX = sanitizeFinite(rotationReaders[0] ? Number(rotationReaders[0](vertexOffset)) : 0, 0);
            const rotationY = sanitizeFinite(rotationReaders[1] ? Number(rotationReaders[1](vertexOffset)) : 0, 0);
            const rotationZ = sanitizeFinite(rotationReaders[2] ? Number(rotationReaders[2](vertexOffset)) : 0, 0);
            const rotationW = sanitizeFinite(rotationReaders[3] ? Number(rotationReaders[3](vertexOffset)) : 1, 1);
            const rotatedQuaternion = applyPreviewOrientation
                ? rotatePreviewOrientationQuaternion(rotationX, rotationY, rotationZ, rotationW)
                : { x: rotationX, y: rotationY, z: rotationZ, w: rotationW };

            rotationData[texelOffset + 0] = toSafeHalfFloat(rotatedQuaternion.x, 0);
            rotationData[texelOffset + 1] = toSafeHalfFloat(rotatedQuaternion.y, 0);
            rotationData[texelOffset + 2] = toSafeHalfFloat(rotatedQuaternion.z, 0);
            rotationData[texelOffset + 3] = toSafeHalfFloat(rotatedQuaternion.w, 1);

            for (let componentIndex = 0; componentIndex < shRestComponentCount; componentIndex += 1) {
                const layer = Math.floor(componentIndex / 4);
                const lane = componentIndex % 4;
                const targetOffset = ((layer * texelCount) + sampleOffset) * 4 + lane;
                const value = Number(shRestReaders[componentIndex](vertexOffset));
                shData[targetOffset] = toSafeHalfFloat(value, 0);
            }

            sampleOffset += 1;

            if (sampleOffset > 0 && sampleOffset % PROGRESS_INTERVAL === 0) {
                postProgress(`Packing dense splat textures... ${Math.round((sampleOffset / sampledCount) * 100)}%`);
            }
        }

        const safeChunkBounds = sanitizeBounds(chunkBucket.bounds);
        const chunkSphere = boundsSphere(safeChunkBounds);
        chunks.push({
            start: chunkStart,
            count: chunkBucket.sourceIndices.length,
            code: chunkBucket.code,
            boundingBoxMin: [safeChunkBounds.minX, safeChunkBounds.minY, safeChunkBounds.minZ],
            boundingBoxMax: [safeChunkBounds.maxX, safeChunkBounds.maxY, safeChunkBounds.maxZ],
            boundingSphereCenter: [chunkSphere.center[0], chunkSphere.center[1], chunkSphere.center[2]],
            boundingSphereRadius: sanitizeRadius(chunkSphere.radius),
        });
    }

    return {
        centerAlphaData,
        colorData,
        scaleData,
        rotationData,
        shData,
        shTextureWidth,
        shTextureHeight,
        shTextureDepth,
        colorPayloadMode,
        shBasisCount,
        textureWidth,
        textureHeight,
        count: sampledCount,
        chunks,
        sceneRadius: sanitizeRadius(rootSphere.radius),
        boundingBoxMin: [rootBounds.minX, rootBounds.minY, rootBounds.minZ],
        boundingBoxMax: [rootBounds.maxX, rootBounds.maxY, rootBounds.maxZ],
        boundingSphereCenter: [rootSphere.center[0], rootSphere.center[1], rootSphere.center[2]],
        boundingSphereRadius: sanitizeRadius(rootSphere.radius),
        previewFocusCenter: previewFocusSphere.center,
        previewFocusRadius: previewFocusSphere.radius,
        previewFocusForward: previewFocusSphere.forward,
        debugSamples,
    };
}

if (typeof self !== "undefined") {
    self.onmessage = (event: MessageEvent<ParseRequest>) => {
        if (event.data.type !== "parse") {
            return;
        }

        try {
            const payload = parsePackedSharpGaussianPayload({
                buffer: event.data.buffer,
                pointBudget: event.data.pointBudget,
                maxTextureSize: event.data.maxTextureSize,
                colorEncoding: event.data.colorEncoding,
                applyPreviewOrientation: event.data.applyPreviewOrientation,
            });

            self.postMessage(
                {
                    type: "success",
                    payload,
                },
                [
                    payload.centerAlphaData.buffer,
                    payload.colorData.buffer,
                    payload.scaleData.buffer,
                    payload.rotationData.buffer,
                    payload.shData.buffer,
                ],
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const stack = error instanceof Error ? error.stack : undefined;
            self.postMessage({
                type: "error",
                message,
                stack,
            });
        }
    };
}

export {};
