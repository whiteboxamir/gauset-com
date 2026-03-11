export type MvpActivityTone = "neutral" | "info" | "success" | "warning";

export interface MvpActivityEntry {
    id: string;
    at: string;
    label: string;
    detail: string;
    tone: MvpActivityTone;
}

export interface MvpChangeSummary {
    persistent: string[];
    sceneDirection: string[];
}

export interface DemoWorldPreset {
    title: string;
    summary: string;
    inputLabel: string;
    sceneGraph: any;
    assetsList: any[];
}

const DEMO_REFERENCE_IMAGE = "/images/hero/interior_daylight.png";

function readDirectorBrief(sceneGraph: any) {
    if (typeof sceneGraph?.director_brief === "string") {
        return sceneGraph.director_brief.trim();
    }
    if (typeof sceneGraph?.sceneDirectionNote === "string") {
        return sceneGraph.sceneDirectionNote.trim();
    }
    return "";
}

const getEnvironmentId = (sceneGraph: any) => {
    if (!sceneGraph?.environment) return null;
    if (typeof sceneGraph.environment === "string") return sceneGraph.environment;
    return sceneGraph.environment.id ?? null;
};

const getAssetCount = (sceneGraph: any) => (Array.isArray(sceneGraph?.assets) ? sceneGraph.assets.length : 0);

const createActivityId = () => `activity_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export function createDemoWorldPreset(): DemoWorldPreset {
    const demoAssets = [
        {
            id: "asset_counter_sign",
            name: "Counter sign",
            preview: DEMO_REFERENCE_IMAGE,
            instanceId: "inst_counter_sign",
            position: [1.6, 1.2, -1.1],
            rotation: [0, 0.18, 0],
            scale: [0.6, 0.6, 0.6],
        },
        {
            id: "asset_bar_stool",
            name: "Bar stool",
            preview: DEMO_REFERENCE_IMAGE,
            instanceId: "inst_bar_stool",
            position: [-0.9, 0, 0.85],
            rotation: [0, 0.42, 0],
            scale: [0.92, 0.92, 0.92],
        },
    ];

    return {
        title: "Neighborhood cafe",
        summary: "A preloaded world that shows the persistent room state before you upload anything.",
        inputLabel: "Demo world still",
        sceneGraph: {
            environment: {
                id: "demo_world_cafe",
                label: "Neighborhood cafe",
                previewImage: DEMO_REFERENCE_IMAGE,
                sourceLabel: "Demo world still",
                statusLabel: "Demo world loaded",
            },
            assets: demoAssets,
            director_brief:
                "Wide shot from the doorway. Keep the counter, stools, and daylight feeling fixed while you change only framing and blocking.",
        },
        assetsList: demoAssets.map((asset) => ({
            id: asset.id,
            name: asset.name,
            preview: asset.preview,
        })),
    };
}

export function createActivityEntry(label: string, detail: string, tone: MvpActivityTone = "neutral"): MvpActivityEntry {
    return {
        id: createActivityId(),
        at: new Date().toISOString(),
        label,
        detail,
        tone,
    };
}

const formatDelta = (count: number, singular: string, plural = `${singular}s`) => {
    if (count > 0) return `${count} ${count === 1 ? singular : plural} added`;
    return `${Math.abs(count)} ${Math.abs(count) === 1 ? singular : plural} removed`;
};

export function buildChangeSummary(
    currentSceneGraph: any,
    baselineSceneGraph: any | null,
    currentInputLabel?: string | null,
    lastOutputInputLabel?: string | null,
): MvpChangeSummary | null {
    if (!baselineSceneGraph) return null;

    const persistent: string[] = [];
    const sceneDirection: string[] = [];

    const baselineEnvironmentId = getEnvironmentId(baselineSceneGraph);
    const currentEnvironmentId = getEnvironmentId(currentSceneGraph);
    if (baselineEnvironmentId !== currentEnvironmentId) {
        persistent.push(currentEnvironmentId ? "Persistent world source changed" : "Persistent world removed");
    }

    if (currentInputLabel && lastOutputInputLabel && currentInputLabel !== lastOutputInputLabel) {
        persistent.push(`Reference still changed from ${lastOutputInputLabel} to ${currentInputLabel}`);
    }

    const assetDelta = getAssetCount(currentSceneGraph) - getAssetCount(baselineSceneGraph);
    if (assetDelta !== 0) {
        persistent.push(formatDelta(assetDelta, "world asset"));
    }

    const baselineDirection = readDirectorBrief(baselineSceneGraph);
    const currentDirection = readDirectorBrief(currentSceneGraph);
    if (baselineDirection !== currentDirection) {
        sceneDirection.push(currentDirection ? "Director brief updated" : "Director brief cleared");
    }

    if (persistent.length === 0 && sceneDirection.length === 0) {
        return null;
    }

    return {
        persistent: persistent.slice(0, 3),
        sceneDirection: sceneDirection.slice(0, 3),
    };
}
