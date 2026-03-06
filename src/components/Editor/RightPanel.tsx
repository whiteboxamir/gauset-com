"use client";

import React, { useMemo, useState } from "react";
import { Box, Copy, Layers, Loader2, Plus, Save, Trash2 } from "lucide-react";

const API_BASE_URL = process.env.NEXT_PUBLIC_GAUSET_API_BASE_URL ?? "http://127.0.0.1:8000";

export default function RightPanel({ sceneGraph, setSceneGraph, assetsList, activeScene }: any) {
    const [isSaving, setIsSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState("");
    const [saveError, setSaveError] = useState("");

    const environmentId = useMemo(() => {
        if (!sceneGraph?.environment) return null;
        if (typeof sceneGraph.environment === "string") return sceneGraph.environment;
        return sceneGraph.environment.id ?? null;
    }, [sceneGraph]);

    const handleDragStart = (event: React.DragEvent, asset: any) => {
        event.dataTransfer.setData("asset", JSON.stringify(asset));
    };

    const addAssetToScene = (asset: any) => {
        setSceneGraph((prev: any) => ({
            ...prev,
            assets: [
                ...(prev.assets ?? []),
                {
                    ...asset,
                    instanceId: `inst_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                    position: [0, 0, 0],
                    rotation: [0, 0, 0],
                    scale: [1, 1, 1],
                },
            ],
        }));
    };

    const duplicateSceneAsset = (instanceId: string) => {
        setSceneGraph((prev: any) => {
            const source = (prev.assets ?? []).find((asset: any) => asset.instanceId === instanceId);
            if (!source) return prev;

            const sourcePos = source.position ?? [0, 0, 0];
            const cloned = {
                ...source,
                instanceId: `inst_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                position: [sourcePos[0] + 0.75, sourcePos[1], sourcePos[2] + 0.75],
            };
            return {
                ...prev,
                assets: [...(prev.assets ?? []), cloned],
            };
        });
    };

    const deleteSceneAsset = (instanceId: string) => {
        setSceneGraph((prev: any) => ({
            ...prev,
            assets: (prev.assets ?? []).filter((asset: any) => asset.instanceId !== instanceId),
        }));
    };

    const saveScene = async () => {
        const sceneId = activeScene || `scene_${Date.now().toString(36)}`;
        setIsSaving(true);
        setSaveError("");
        setSaveMessage("");

        try {
            const response = await fetch(`${API_BASE_URL}/scene/save`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    scene_id: sceneId,
                    scene_graph: {
                        environment: sceneGraph.environment,
                        assets: sceneGraph.assets,
                    },
                }),
            });

            if (!response.ok) {
                throw new Error(`Scene save failed (${response.status})`);
            }

            setSaveMessage(`Saved ${sceneId}`);
        } catch (error) {
            setSaveError(error instanceof Error ? error.message : "Scene save failed");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-neutral-950">
            <div className="p-4 border-b border-neutral-800 flex items-center justify-between shrink-0 bg-neutral-900/30">
                <h3 className="font-semibold text-white tracking-tight text-sm">Scene Inspector</h3>
                <button
                    onClick={saveScene}
                    disabled={isSaving}
                    className="p-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white transition-colors shadow-lg shadow-blue-900/20 disabled:opacity-60 disabled:hover:bg-blue-600"
                    title="Save Scene as JSON"
                >
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                </button>
            </div>
            {saveMessage && <p className="px-4 pt-3 text-xs text-emerald-400">{saveMessage}</p>}
            {saveError && <p className="px-4 pt-3 text-xs text-rose-400">{saveError}</p>}

            <div className="flex-1 overflow-y-auto p-4 border-b border-neutral-800">
                <div className="flex items-center gap-2 mb-4 text-xs font-bold text-neutral-500 uppercase tracking-wider">
                    <Layers className="h-3 w-3" />
                    Scene Graph
                </div>

                {environmentId ? (
                    <div className="space-y-2 text-sm animate-in fade-in">
                        <div className="bg-neutral-900/80 rounded-lg px-3 py-2.5 text-emerald-400 border py-1.5 border-emerald-900/30 flex justify-between items-center shadow-inner">
                            <span className="font-medium">Environment Splat</span>
                            <span className="text-[10px] bg-emerald-950/50 px-1.5 py-0.5 rounded text-emerald-500 font-mono tracking-wider">BG</span>
                        </div>
                        {(sceneGraph.assets ?? []).map((asset: any, index: number) => (
                            <div
                                key={asset.instanceId || index}
                                className="bg-neutral-900/50 rounded-lg px-3 py-2.5 text-blue-400 border border-blue-900/30 ml-4 flex flex-col gap-2 hover:border-blue-700/50 hover:bg-neutral-900 transition-colors"
                            >
                                <div className="flex justify-between items-center">
                                    <span className="font-medium flex items-center gap-2 truncate">
                                        <Box className="h-3 w-3 opacity-50 shrink-0" /> {asset.name}
                                    </span>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <button
                                            onClick={() => duplicateSceneAsset(asset.instanceId)}
                                            className="p-1 rounded text-neutral-300 hover:text-white hover:bg-neutral-800"
                                            title="Duplicate"
                                        >
                                            <Copy className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                            onClick={() => deleteSceneAsset(asset.instanceId)}
                                            className="p-1 rounded text-rose-300 hover:text-rose-200 hover:bg-rose-950/40"
                                            title="Delete"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                </div>
                                <span className="text-xs text-neutral-500 font-mono">
                                    pos [{(asset.position ?? [0, 0, 0]).map((value: number) => Number(value).toFixed(2)).join(", ")}]
                                </span>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="h-20 flex items-center justify-center">
                        <p className="text-xs text-neutral-600 italic">Scene is empty</p>
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 bg-neutral-900/20">
                <div className="flex items-center gap-2 mb-4 text-xs font-bold text-neutral-500 uppercase tracking-wider">
                    <Box className="h-3 w-3" />
                    Local Assets
                </div>

                {assetsList.length > 0 ? (
                    <div className="grid grid-cols-2 gap-3 pb-8">
                        {assetsList.map((asset: any, index: number) => (
                            <div
                                key={asset.id || index}
                                draggable
                                onDragStart={(event) => handleDragStart(event, asset)}
                                onClick={() => addAssetToScene(asset)}
                                className="bg-neutral-900 border border-neutral-800 rounded-xl p-3 hover:border-blue-500/50 cursor-grab active:cursor-grabbing transition-all group aspect-square flex flex-col justify-between hover:shadow-xl hover:shadow-black/50 animate-in zoom-in-95 duration-200"
                            >
                                <div
                                    className="w-full flex-1 bg-gradient-to-tr from-neutral-800 to-neutral-700 rounded-lg mb-2 overflow-hidden relative shadow-inner bg-cover bg-center"
                                    style={asset.preview ? { backgroundImage: `url(${asset.preview})` } : undefined}
                                >
                                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-neutral-900/40 transition-opacity backdrop-blur-[2px]">
                                        <div className="bg-blue-600 text-white rounded-full p-1 shadow-lg pointer-events-none">
                                            <Plus className="h-4 w-4" />
                                        </div>
                                    </div>
                                </div>
                                <p className="text-xs text-center text-neutral-400 font-medium truncate group-hover:text-blue-200">{asset.name}</p>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center h-40 flex items-center justify-center border-2 border-dashed border-neutral-800/50 rounded-xl bg-neutral-900/30">
                        <p className="text-xs text-neutral-600 px-4">Assets generated from TripoSR will appear here.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
