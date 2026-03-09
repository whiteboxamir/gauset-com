import * as THREE from "three";
import { GPUComputationRenderer } from "three/examples/jsm/misc/GPUComputationRenderer.js";

const SORT_CULL_SENTINEL = 65504;

const GPU_SORT_INIT_SHADER = `
uniform sampler2D uCenterAlphaTexture;
uniform sampler2D uActiveIndexTexture;
uniform vec2 uPayloadTextureSize;
uniform float uPayloadTextureWidth;
uniform float uPointCount;
uniform mat4 uViewMatrix;
uniform mat4 uViewProjectionMatrix;
uniform float uCullSentinel;

vec2 coordsForIndex(float index, float width, vec2 size) {
    return (vec2(mod(index, width), floor(index / width)) + 0.5) / size;
}

void main() {
    float linearIndex = floor(gl_FragCoord.x - 0.5) + floor(gl_FragCoord.y - 0.5) * resolution.x;

    if (linearIndex >= uPointCount) {
        gl_FragColor = vec4(uCullSentinel, linearIndex, 0.0, 0.0);
        return;
    }

    float payloadIndex = texture2D(uActiveIndexTexture, coordsForIndex(linearIndex, resolution.x, resolution.xy)).x;
    vec2 payloadUv = coordsForIndex(payloadIndex, uPayloadTextureWidth, uPayloadTextureSize);
    vec4 centerAlpha = texture2D(uCenterAlphaTexture, payloadUv);
    vec4 worldCenter = vec4(centerAlpha.xyz, 1.0);
    vec4 viewCenter = uViewMatrix * worldCenter;
    vec4 clipCenter = uViewProjectionMatrix * worldCenter;
    float key = uCullSentinel;
    float visible = 0.0;

    if (clipCenter.w > 0.0) {
        vec3 ndc = clipCenter.xyz / clipCenter.w;
        if (abs(ndc.x) <= 1.02 && abs(ndc.y) <= 1.02 && ndc.z >= -1.0 && ndc.z <= 1.0) {
            key = viewCenter.z;
            visible = 1.0;
        }
    }

    gl_FragColor = vec4(key, payloadIndex, visible, 0.0);
}
`;

const GPU_SORT_BITONIC_SHADER = `
uniform sampler2D uSourcePairs;
uniform float uStage;
uniform float uPass;

vec2 uvForIndex(float index) {
    return (vec2(mod(index, resolution.x), floor(index / resolution.x)) + 0.5) / resolution.xy;
}

vec4 readPair(float index) {
    return texture2D(uSourcePairs, uvForIndex(index));
}

bool pairLess(vec4 leftPair, vec4 rightPair) {
    if (leftPair.x < rightPair.x) {
        return true;
    }
    if (leftPair.x > rightPair.x) {
        return false;
    }
    return leftPair.y < rightPair.y;
}

void main() {
    float linearIndex = floor(gl_FragCoord.x - 0.5) + floor(gl_FragCoord.y - 0.5) * resolution.x;
    bool ascending = mod(linearIndex, 2.0 * uStage) < uStage;
    bool lowerHalf = mod(linearIndex, 2.0 * uPass) < uPass;
    float partnerIndex = lowerHalf ? linearIndex + uPass : linearIndex - uPass;

    vec4 selfPair = readPair(linearIndex);
    vec4 partnerPair = readPair(partnerIndex);
    bool keepLower = (ascending && lowerHalf) || (!ascending && !lowerHalf);
    bool selfBeforePartner = pairLess(selfPair, partnerPair);

    gl_FragColor = keepLower
        ? (selfBeforePartner ? selfPair : partnerPair)
        : (selfBeforePartner ? partnerPair : selfPair);
}
`;

type SharpGaussianGpuSorterConfig = {
    renderer: THREE.WebGLRenderer;
    centerAlphaTexture: THREE.Texture;
    payloadTextureWidth: number;
    payloadTextureHeight: number;
    activeIndices: Uint32Array;
};

function nextPowerOfTwo(value: number) {
    let power = 1;

    while (power < value) {
        power *= 2;
    }

    return power;
}

function floorPowerOfTwo(value: number) {
    let power = 1;

    while (power * 2 <= value) {
        power *= 2;
    }

    return power;
}

function resolveGpuSortTextureSize(count: number, maxTextureSize: number) {
    const maxPowerOfTwoTextureSize = floorPowerOfTwo(maxTextureSize);
    const preferredWidth = nextPowerOfTwo(Math.ceil(Math.sqrt(count)));
    const width = Math.min(maxPowerOfTwoTextureSize, preferredWidth);
    const height = nextPowerOfTwo(Math.ceil(count / width));

    if (height > maxPowerOfTwoTextureSize) {
        throw new Error(`GPU splat sort exceeded the available WebGL2 texture size (${maxTextureSize}).`);
    }

    return {
        width,
        height,
        capacity: width * height,
    };
}

function configureSortTarget(target: THREE.WebGLRenderTarget) {
    target.texture.colorSpace = THREE.NoColorSpace;
    target.texture.generateMipmaps = false;
    target.texture.internalFormat = "RGBA32F";
    target.texture.minFilter = THREE.NearestFilter;
    target.texture.magFilter = THREE.NearestFilter;
    target.texture.wrapS = THREE.ClampToEdgeWrapping;
    target.texture.wrapT = THREE.ClampToEdgeWrapping;
}

function createActiveIndexTexture(data: Float32Array, width: number, height: number) {
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

export class SharpGaussianGpuSorter {
    readonly orderTextureWidth: number;
    readonly orderTextureHeight: number;
    readonly sortCapacity: number;
    readonly cullSentinel = SORT_CULL_SENTINEL;

    private readonly renderer: THREE.WebGLRenderer;
    private readonly gpuCompute: GPUComputationRenderer;
    private readonly initMaterial: THREE.ShaderMaterial;
    private readonly sortMaterial: THREE.ShaderMaterial;
    private readonly pairTargets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
    private readonly activeIndexData: Float32Array;
    private readonly activeIndexTexture: THREE.DataTexture;
    private currentTargetIndex = 0;
    private activeCount = 0;
    private readonly viewProjectionMatrix = new THREE.Matrix4();

    constructor({ renderer, centerAlphaTexture, payloadTextureWidth, payloadTextureHeight, activeIndices }: SharpGaussianGpuSorterConfig) {
        if (!renderer.capabilities.isWebGL2) {
            throw new Error("GPU-native splat sorting requires WebGL2.");
        }

        if (!renderer.extensions.has("EXT_color_buffer_float")) {
            throw new Error("GPU-native splat sorting requires EXT_color_buffer_float.");
        }

        const requestedCount = Math.max(1, activeIndices.length);
        const sortSize = resolveGpuSortTextureSize(requestedCount, renderer.capabilities.maxTextureSize);

        this.renderer = renderer;
        this.orderTextureWidth = sortSize.width;
        this.orderTextureHeight = sortSize.height;
        this.sortCapacity = sortSize.capacity;
        this.activeIndexData = new Float32Array(this.sortCapacity * 4);
        this.activeIndexData.fill(-1);
        this.activeIndexTexture = createActiveIndexTexture(this.activeIndexData, this.orderTextureWidth, this.orderTextureHeight);
        this.gpuCompute = new GPUComputationRenderer(this.orderTextureWidth, this.orderTextureHeight, renderer);
        this.gpuCompute.setDataType(THREE.FloatType);

        this.initMaterial = this.gpuCompute.createShaderMaterial(GPU_SORT_INIT_SHADER, {
            uCenterAlphaTexture: { value: centerAlphaTexture },
            uActiveIndexTexture: { value: this.activeIndexTexture },
            uPayloadTextureSize: { value: new THREE.Vector2(payloadTextureWidth, payloadTextureHeight) },
            uPayloadTextureWidth: { value: payloadTextureWidth },
            uPointCount: { value: 0 },
            uViewMatrix: { value: new THREE.Matrix4() },
            uViewProjectionMatrix: { value: new THREE.Matrix4() },
            uCullSentinel: { value: this.cullSentinel },
        });
        this.initMaterial.depthTest = false;
        this.initMaterial.depthWrite = false;
        this.initMaterial.toneMapped = false;

        this.sortMaterial = this.gpuCompute.createShaderMaterial(GPU_SORT_BITONIC_SHADER, {
            uSourcePairs: { value: null },
            uStage: { value: 2 },
            uPass: { value: 1 },
        });
        this.sortMaterial.depthTest = false;
        this.sortMaterial.depthWrite = false;
        this.sortMaterial.toneMapped = false;

        const pairTargetA = this.gpuCompute.createRenderTarget(
            this.orderTextureWidth,
            this.orderTextureHeight,
            THREE.ClampToEdgeWrapping,
            THREE.ClampToEdgeWrapping,
            THREE.NearestFilter,
            THREE.NearestFilter,
        );
        const pairTargetB = this.gpuCompute.createRenderTarget(
            this.orderTextureWidth,
            this.orderTextureHeight,
            THREE.ClampToEdgeWrapping,
            THREE.ClampToEdgeWrapping,
            THREE.NearestFilter,
            THREE.NearestFilter,
        );
        configureSortTarget(pairTargetA);
        configureSortTarget(pairTargetB);
        this.pairTargets = [pairTargetA, pairTargetB];
        this.setActiveIndices(activeIndices);
    }

    update(camera: THREE.Camera) {
        if (this.activeCount === 0) {
            return;
        }

        this.initMaterial.uniforms.uViewMatrix.value.copy(camera.matrixWorldInverse);
        this.viewProjectionMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        this.initMaterial.uniforms.uViewProjectionMatrix.value.copy(this.viewProjectionMatrix);
        this.gpuCompute.doRenderTarget(this.initMaterial, this.pairTargets[0]);
        this.currentTargetIndex = 0;

        for (let stage = 2; stage <= this.sortCapacity; stage *= 2) {
            for (let pass = stage / 2; pass >= 1; pass /= 2) {
                const sourceTarget = this.pairTargets[this.currentTargetIndex];
                const destinationTarget = this.pairTargets[this.currentTargetIndex === 0 ? 1 : 0];

                this.sortMaterial.uniforms.uSourcePairs.value = sourceTarget.texture;
                this.sortMaterial.uniforms.uStage.value = stage;
                this.sortMaterial.uniforms.uPass.value = pass;
                this.gpuCompute.doRenderTarget(this.sortMaterial, destinationTarget);
                this.currentTargetIndex = this.currentTargetIndex === 0 ? 1 : 0;
            }
        }

        this.renderer.resetState();
    }

    setActiveIndices(activeIndices: Uint32Array) {
        if (activeIndices.length > this.sortCapacity) {
            throw new Error(`GPU splat sorter capacity (${this.sortCapacity}) is smaller than the active point count (${activeIndices.length}).`);
        }

        this.activeCount = activeIndices.length;
        this.activeIndexData.fill(-1);
        for (let index = 0; index < activeIndices.length; index += 1) {
            this.activeIndexData[index * 4] = activeIndices[index];
        }

        this.activeIndexTexture.needsUpdate = true;
        this.initMaterial.uniforms.uPointCount.value = this.activeCount;
    }

    getTexture() {
        return this.pairTargets[this.currentTargetIndex].texture;
    }

    dispose() {
        this.initMaterial.dispose();
        this.sortMaterial.dispose();
        this.activeIndexTexture.dispose();
        this.pairTargets[0].dispose();
        this.pairTargets[1].dispose();
        this.gpuCompute.dispose();
    }
}
