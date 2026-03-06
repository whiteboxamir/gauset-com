"use client";

import React, { useEffect, useRef, useState } from "react";
import { Box, ImageIcon, Loader2, Upload } from "lucide-react";

const API_BASE_URL = process.env.NEXT_PUBLIC_GAUSET_API_BASE_URL ?? "http://127.0.0.1:8000";
const POLL_INTERVAL_MS = 1200;
const POLL_TIMEOUT_MS = 120_000;

type JobStatus = "processing" | "completed" | "failed";

interface UploadResponse {
    image_id: string;
    filename: string;
    filepath: string;
    url?: string;
}

interface GenerateResponse {
    job_id?: string;
    scene_id?: string;
    asset_id?: string;
    status: JobStatus;
    urls?: Record<string, string>;
}

interface JobStatusResponse {
    id: string;
    type: "environment" | "asset";
    status: JobStatus;
    error?: string | null;
    result?: {
        scene_id?: string;
        asset_id?: string;
        files?: Record<string, string>;
        urls?: Record<string, string>;
    } | null;
}

interface LeftPanelProps {
    setActiveScene: (sceneId: string | null) => void;
    setSceneGraph: React.Dispatch<React.SetStateAction<any>>;
    setAssetsList: React.Dispatch<React.SetStateAction<any[]>>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const toAbsoluteUrl = (urlOrPath?: string): string => {
    if (!urlOrPath) return "";
    if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")) return urlOrPath;
    return `${API_BASE_URL}${urlOrPath.startsWith("/") ? "" : "/"}${urlOrPath}`;
};

const defaultEnvironmentUrls = (sceneId: string) => ({
    splats: `${API_BASE_URL}/storage/scenes/${sceneId}/environment/splats.ply`,
    cameras: `${API_BASE_URL}/storage/scenes/${sceneId}/environment/cameras.json`,
    metadata: `${API_BASE_URL}/storage/scenes/${sceneId}/environment/metadata.json`,
});

const defaultAssetUrls = (assetId: string) => ({
    mesh: `${API_BASE_URL}/storage/assets/${assetId}/mesh.glb`,
    texture: `${API_BASE_URL}/storage/assets/${assetId}/texture.png`,
    preview: `${API_BASE_URL}/storage/assets/${assetId}/preview.png`,
});

async function pollJob(jobId: string): Promise<JobStatusResponse> {
    const start = Date.now();

    while (Date.now() - start < POLL_TIMEOUT_MS) {
        const response = await fetch(`${API_BASE_URL}/jobs/${jobId}`);
        if (!response.ok) {
            throw new Error(`Job polling failed (${response.status})`);
        }

        const payload = (await response.json()) as JobStatusResponse;
        if (payload.status === "completed" || payload.status === "failed") {
            return payload;
        }

        await sleep(POLL_INTERVAL_MS);
    }

    throw new Error("Timed out waiting for generation job to finish.");
}

export default function LeftPanel({ setActiveScene, setSceneGraph, setAssetsList }: LeftPanelProps) {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [isGeneratingEnv, setIsGeneratingEnv] = useState(false);
    const [isGeneratingAsset, setIsGeneratingAsset] = useState(false);
    const [uploadInfo, setUploadInfo] = useState<UploadResponse | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [statusText, setStatusText] = useState<string>("");
    const [errorText, setErrorText] = useState<string>("");

    useEffect(() => {
        return () => {
            if (previewUrl) {
                URL.revokeObjectURL(previewUrl);
            }
        };
    }, [previewUrl]);

    const triggerFilePicker = () => {
        fileInputRef.current?.click();
    };

    const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;

        setErrorText("");
        setStatusText("");
        setIsUploading(true);
        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
        }
        setPreviewUrl(URL.createObjectURL(file));

        try {
            const formData = new FormData();
            formData.append("file", file);

            const response = await fetch(`${API_BASE_URL}/upload`, {
                method: "POST",
                body: formData,
            });

            if (!response.ok) {
                throw new Error(`Upload failed (${response.status})`);
            }

            const payload = (await response.json()) as UploadResponse;
            setUploadInfo(payload);
            setStatusText(`Uploaded ${payload.filename}`);
        } catch (error) {
            setUploadInfo(null);
            setErrorText(error instanceof Error ? error.message : "Upload failed");
        } finally {
            setIsUploading(false);
        }
    };

    const generateEnvironment = async () => {
        if (!uploadInfo) return;
        setIsGeneratingEnv(true);
        setErrorText("");
        setStatusText("Generating environment...");

        try {
            const response = await fetch(`${API_BASE_URL}/generate/environment`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ image_id: uploadInfo.image_id }),
            });
            if (!response.ok) {
                throw new Error(`Environment generation failed (${response.status})`);
            }

            const payload = (await response.json()) as GenerateResponse;
            const jobId = payload.job_id ?? payload.scene_id;
            if (!jobId) {
                throw new Error("Missing job id from environment generation response.");
            }

            const finalJob = await pollJob(jobId);
            if (finalJob.status === "failed") {
                throw new Error(finalJob.error || "Environment generation failed.");
            }

            const sceneId = finalJob.result?.scene_id ?? payload.scene_id ?? jobId;
            const fallbackUrls = defaultEnvironmentUrls(sceneId);
            const urls = {
                splats: toAbsoluteUrl(finalJob.result?.urls?.splats ?? payload.urls?.splats ?? fallbackUrls.splats),
                cameras: toAbsoluteUrl(finalJob.result?.urls?.cameras ?? payload.urls?.cameras ?? fallbackUrls.cameras),
                metadata: toAbsoluteUrl(finalJob.result?.urls?.metadata ?? payload.urls?.metadata ?? fallbackUrls.metadata),
            };

            setSceneGraph((prev: any) => ({
                ...prev,
                environment: {
                    id: sceneId,
                    urls,
                    files: finalJob.result?.files ?? null,
                },
            }));
            setActiveScene(sceneId);
            setStatusText(`Environment ready: ${sceneId}`);
        } catch (error) {
            setErrorText(error instanceof Error ? error.message : "Environment generation failed.");
        } finally {
            setIsGeneratingEnv(false);
        }
    };

    const generateAsset = async () => {
        if (!uploadInfo) return;
        setIsGeneratingAsset(true);
        setErrorText("");
        setStatusText("Generating asset...");

        try {
            const response = await fetch(`${API_BASE_URL}/generate/asset`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ image_id: uploadInfo.image_id }),
            });
            if (!response.ok) {
                throw new Error(`Asset generation failed (${response.status})`);
            }

            const payload = (await response.json()) as GenerateResponse;
            const jobId = payload.job_id ?? payload.asset_id;
            if (!jobId) {
                throw new Error("Missing job id from asset generation response.");
            }

            const finalJob = await pollJob(jobId);
            if (finalJob.status === "failed") {
                throw new Error(finalJob.error || "Asset generation failed.");
            }

            const assetId = finalJob.result?.asset_id ?? payload.asset_id ?? jobId;
            const fallbackUrls = defaultAssetUrls(assetId);
            const urls = {
                mesh: toAbsoluteUrl(finalJob.result?.urls?.mesh ?? payload.urls?.mesh ?? fallbackUrls.mesh),
                texture: toAbsoluteUrl(finalJob.result?.urls?.texture ?? payload.urls?.texture ?? fallbackUrls.texture),
                preview: toAbsoluteUrl(finalJob.result?.urls?.preview ?? payload.urls?.preview ?? fallbackUrls.preview),
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
            setAssetsList((prev: any[]) => [...prev, newAsset]);
            setStatusText(`Asset ready: ${assetId}`);
        } catch (error) {
            setErrorText(error instanceof Error ? error.message : "Asset generation failed.");
        } finally {
            setIsGeneratingAsset(false);
        }
    };

    return (
        <div className="flex flex-col h-full p-6 text-neutral-300">
            <h2 className="text-xl font-bold mb-8 text-white tracking-tight">Gauset Generator</h2>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp"
                className="hidden"
                onChange={handleUpload}
            />

            <div className="border-2 border-dashed border-neutral-700/50 rounded-xl p-8 mb-8 text-center hover:border-blue-500/50 hover:bg-neutral-900 transition-all cursor-pointer group" onClick={triggerFilePicker}>
                {isUploading ? (
                    <Loader2 className="mx-auto h-8 w-8 mb-3 text-blue-500 animate-spin" />
                ) : (
                    <Upload className="mx-auto h-8 w-8 mb-3 text-neutral-500 group-hover:text-blue-400 transition-colors" />
                )}
                <p className="text-sm font-medium group-hover:text-blue-100">{isUploading ? "Uploading..." : "Upload Photo"}</p>
                <p className="text-xs text-neutral-500 mt-1">PNG, JPG up to 10MB</p>
            </div>

            {statusText && <p className="text-xs text-emerald-400 mb-4">{statusText}</p>}
            {errorText && <p className="text-xs text-rose-400 mb-4 whitespace-pre-wrap">{errorText}</p>}

            {uploadInfo && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="bg-neutral-900 rounded-lg p-4 flex gap-4 items-center border border-neutral-800">
                        <div
                            className="w-12 h-12 bg-gradient-to-tr from-neutral-800 to-neutral-700 rounded object-cover bg-cover bg-center shadow-inner"
                            style={previewUrl ? { backgroundImage: `url(${previewUrl})` } : undefined}
                        />
                        <div className="flex-1 text-sm">
                            <p className="font-semibold text-white">Ready for Generation</p>
                            <p className="text-xs text-neutral-400 truncate">{uploadInfo.filename}</p>
                        </div>
                    </div>

                    <button
                        onClick={generateEnvironment}
                        disabled={isGeneratingEnv || isGeneratingAsset}
                        className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-white font-medium flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:hover:bg-emerald-600 shadow-lg shadow-emerald-900/20"
                    >
                        {isGeneratingEnv ? <Loader2 className="animate-spin h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
                        {isGeneratingEnv ? "Generating Environments..." : "Generate Environment"}
                    </button>

                    <button
                        onClick={generateAsset}
                        disabled={isGeneratingEnv || isGeneratingAsset}
                        className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-500 rounded-xl text-white font-medium flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:hover:bg-blue-600 shadow-lg shadow-blue-900/20"
                    >
                        {isGeneratingAsset ? <Loader2 className="animate-spin h-5 w-5" /> : <Box className="h-5 w-5" />}
                        {isGeneratingAsset ? "Generating Asset..." : "Generate Asset"}
                    </button>
                </div>
            )}
        </div>
    );
}
