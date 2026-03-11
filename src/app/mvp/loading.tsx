import { Loader2 } from "lucide-react";

export default function MVPLoading() {
    return (
        <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.1),transparent_22%),linear-gradient(180deg,#05070a_0%,#040507_100%)] px-6 py-10 text-white">
            <div className="mx-auto flex min-h-[80vh] max-w-3xl items-center justify-center">
                <div className="w-full rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(10,14,21,0.96),rgba(7,10,14,0.92))] p-8 shadow-[0_28px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
                    <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.26em] text-cyan-200/70">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        MVP Workspace
                    </div>
                    <h1 className="mt-6 text-3xl font-medium tracking-[-0.04em] text-white">Loading workspace</h1>
                    <p className="mt-4 max-w-2xl text-sm leading-7 text-neutral-300">
                        Preparing the persistent world, route-local state, and 3D editor shell.
                    </p>
                    <div className="mt-8 h-2 overflow-hidden rounded-full bg-white/8">
                        <div className="h-full w-1/3 animate-pulse rounded-full bg-gradient-to-r from-cyan-400 via-sky-300 to-emerald-300" />
                    </div>
                </div>
            </div>
        </div>
    );
}
