"use client";

import React, { useState } from "react";
import { Upload, ImageIcon, Box, Loader2 } from "lucide-react";

export default function LeftPanel({ setActiveScene, setSceneGraph, setAssetsList }: any) {
    const [isUploading, setIsUploading] = useState(false);
    const [isGeneratingEnv, setIsGeneratingEnv] = useState(false);
    const [isGeneratingAsset, setIsGeneratingAsset] = useState(false);
    const [currentImage, setCurrentImage] = useState<string | null>(null);

    const handleUpload = () => {
        setIsUploading(true);
        // Mock upload delay
        setTimeout(() => {
            setCurrentImage("/mock-image.jpg");
            setIsUploading(false);
        }, 1000);
    };

    const generateEnvironment = () => {
        if (!currentImage) return;
        setIsGeneratingEnv(true);
        setTimeout(() => {
            setSceneGraph((prev: any) => ({
                ...prev,
                environment: "scene_01",
            }));
            setActiveScene("scene_01");
            setIsGeneratingEnv(false);
        }, 2000);
    };

    const generateAsset = () => {
        if (!currentImage) return;
        setIsGeneratingAsset(true);
        setTimeout(() => {
            const newAsset = { id: `asset_${Date.now()}`, name: "Mesh Asset" };
            setAssetsList((prev: any) => [...prev, newAsset]);
            setIsGeneratingAsset(false);
        }, 2000);
    };

    return (
        <div className="flex flex-col h-full p-6 text-neutral-300">
            <h2 className="text-xl font-bold mb-8 text-white tracking-tight">Gauset Generator</h2>

            <div className="border-2 border-dashed border-neutral-700/50 rounded-xl p-8 mb-8 text-center hover:border-blue-500/50 hover:bg-neutral-900 transition-all cursor-pointer group" onClick={handleUpload}>
                {isUploading ? (
                    <Loader2 className="mx-auto h-8 w-8 mb-3 text-blue-500 animate-spin" />
                ) : (
                    <Upload className="mx-auto h-8 w-8 mb-3 text-neutral-500 group-hover:text-blue-400 transition-colors" />
                )}
                <p className="text-sm font-medium group-hover:text-blue-100">{isUploading ? 'Uploading...' : 'Upload Photo'}</p>
                <p className="text-xs text-neutral-500 mt-1">PNG, JPG up to 10MB</p>
            </div>

            {currentImage && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="bg-neutral-900 rounded-lg p-4 flex gap-4 items-center border border-neutral-800">
                        <div className="w-12 h-12 bg-gradient-to-tr from-neutral-800 to-neutral-700 rounded object-cover shadow-inner" />
                        <div className="flex-1 text-sm">
                            <p className="font-semibold text-white">Ready for Generation</p>
                            <p className="text-xs text-neutral-400">Select pipeline below</p>
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
