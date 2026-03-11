import type { SceneReviewRecord } from "@/lib/mvp-workspace";

export interface ReviewPackage {
    sceneId: string | null;
    versionId: string | null;
    sceneGraph: any;
    assetsList: any[];
    review?: SceneReviewRecord;
    exportedAt: string;
    summary: {
        assetCount: number;
        hasEnvironment: boolean;
    };
}

function encodeBase64(value: string) {
    if (typeof window === "undefined") {
        return Buffer.from(value, "utf-8").toString("base64");
    }
    return window.btoa(unescape(encodeURIComponent(value)));
}

function decodeBase64(value: string) {
    if (typeof window === "undefined") {
        return Buffer.from(value, "base64").toString("utf-8");
    }
    return decodeURIComponent(escape(window.atob(value)));
}

export function createReviewPackage(
    sceneGraph: any,
    assetsList: any[],
    sceneId: string | null,
    versionId: string | null,
    review?: ReviewPackage["review"],
): ReviewPackage {
    return {
        sceneId,
        versionId,
        sceneGraph,
        assetsList,
        review,
        exportedAt: new Date().toISOString(),
        summary: {
            assetCount: Array.isArray(sceneGraph?.assets) ? sceneGraph.assets.length : 0,
            hasEnvironment: Boolean(sceneGraph?.environment),
        },
    };
}

export function encodeReviewPackage(reviewPackage: ReviewPackage) {
    return encodeBase64(JSON.stringify(reviewPackage));
}

export function decodeReviewPackage(payload: string) {
    return JSON.parse(decodeBase64(payload)) as ReviewPackage;
}
