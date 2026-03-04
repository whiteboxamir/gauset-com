'use client';

import { useRef, useEffect } from 'react';
import { motion, useTransform, useSpring, useMotionValue } from 'framer-motion';

function useRectProgress(ref: React.RefObject<HTMLElement | null>, type: 'spine' | 'card') {
    const progress = useMotionValue(0);

    useEffect(() => {
        let rafId: number;
        const update = () => {
            if (ref.current) {
                const rect = ref.current.getBoundingClientRect();
                const windowHeight = window.innerHeight;

                let startY = 0;
                let endY = 0;

                if (type === 'spine') {
                    startY = windowHeight / 2;
                    endY = windowHeight - rect.height;
                } else if (type === 'card') {
                    startY = windowHeight;
                    endY = windowHeight / 2 - rect.height / 2;
                }

                if (startY !== endY) {
                    let p = (startY - rect.top) / (startY - endY);
                    if (p < 0) p = 0;
                    if (p > 1) p = 1;
                    progress.set(p);
                }
            }
            rafId = requestAnimationFrame(update);
        };
        update();
        return () => cancelAnimationFrame(rafId);
    }, [ref, type]);

    return progress;
}

/* ─── Variables for tweaking physics ─── */
const physicsConfig = {
    spineStiffness: 120,
    spineDamping: 30,
    cardStiffness: 150,
    cardDamping: 20,
    cardMass: 1,
    spineGlowIntensity: '0 0 20px 2px rgba(255,255,255,0.5)',
};

const STAGES = [
    {
        id: 'screenplay',
        label: 'SCREENPLAY',
        tagline: 'A screenplay enters the system.',
        meta: 'SC 01 · PARSE · INGEST',
        detail: 'Structure, characters, locations, props — extracted and indexed.',
        accent: '#d4a04a', // gold
        statusLabel: 'INGESTING',
    },
    {
        id: 'world-gen',
        label: 'WORLD GENERATION',
        tagline: 'Scenes become explorable worlds.',
        meta: 'ENV · BUILD · POPULATE',
        detail: 'Persistent environments generated from scene descriptions.',
        accent: '#4a9fd4', // blue
        statusLabel: 'GENERATING',
    },
    {
        id: 'staging',
        label: 'STAGING',
        tagline: 'Direct, block, and iterate in real-time.',
        meta: 'CAM · ACTOR · LIGHT',
        detail: 'Place cameras. Direct performances. Adjust in the world.',
        accent: '#ef4444', // red
        statusLabel: 'RECORDING',
    },
    {
        id: 'orchestration',
        label: 'ORCHESTRATION',
        tagline: 'An agent maintains continuity across the film.',
        meta: 'CONTINUITY · RENDER · EXPORT',
        detail: 'Every shot, every scene — connected and consistent.',
        accent: '#d4a04a', // gold
        statusLabel: 'ORCHESTRATING',
    },
] as const;

const MONO: React.CSSProperties = {
    fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", "Courier New", monospace',
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
};

/* ═══════════════════════════════════════════════════════════════
   PipelineSection — Concept 2: "Gaussian Spine"
   ═══════════════════════════════════════════════════════════════ */
export function PipelineSection() {
    const containerRef = useRef<HTMLDivElement>(null);

    // Passively track position via Bounding Rect (bypasses Drei scroll hijack)
    const scrollYProgress = useRectProgress(containerRef, 'spine');

    const spineSpring = useSpring(scrollYProgress, {
        stiffness: physicsConfig.spineStiffness,
        damping: physicsConfig.spineDamping,
        restDelta: 0.001
    });

    return (
        <div ref={containerRef} className="relative z-10 py-[15vh] max-w-[1440px] mx-auto w-full overflow-hidden md:overflow-visible">

            {/* ── CENTRAL SPINE ── */}
            <div className="absolute left-[31px] md:left-1/2 top-[15vh] bottom-[15vh] w-[2px] bg-white/5 md:-translate-x-1/2" />

            {/* The "Charge" traveling down the spine */}
            <motion.div
                className="absolute left-[31.5px] md:left-1/2 w-[3px] rounded-full z-20 md:-translate-x-1/2"
                style={{
                    height: '20vh',
                    top: useTransform(spineSpring, [0, 1], ['0%', '100%']),
                    translateY: '-50%',
                    opacity: useTransform(spineSpring, [0, 0.1, 0.9, 1], [0, 1, 1, 0]),
                    scaleY: useTransform(spineSpring, [0, 0.1, 0.9, 1], [0.5, 1, 1, 0]),
                    background: 'linear-gradient(to bottom, transparent, rgba(255,255,255,0.8), rgba(255,255,255,1), rgba(255,255,255,0.8), transparent)',
                    boxShadow: physicsConfig.spineGlowIntensity,
                }}
            />

            {/* ── STAGES ── */}
            <div className="flex flex-col gap-[15vh] md:gap-[30vh] relative z-10">
                {STAGES.map((stage, i) => (
                    <PipelineStage key={stage.id} stage={stage} index={i} total={STAGES.length} />
                ))}
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════
   PipelineStage — A single cinematic stage
   ═══════════════════════════════════════════════════════════════ */
function PipelineStage({ stage, index, total }: { stage: (typeof STAGES)[number]; index: number; total: number }) {
    const cardRef = useRef<HTMLDivElement>(null);

    const scrollYProgress = useRectProgress(cardRef, 'card');

    // Spring physics for the card unfolding
    const springScale = useSpring(useTransform(scrollYProgress, [0, 1], [0.85, 1]), {
        stiffness: physicsConfig.cardStiffness,
        damping: physicsConfig.cardDamping,
        mass: physicsConfig.cardMass
    });
    const springOpacity = useSpring(useTransform(scrollYProgress, [0, 1], [0, 1]), {
        stiffness: physicsConfig.cardStiffness,
        damping: physicsConfig.cardDamping,
        mass: physicsConfig.cardMass
    });
    const springY = useSpring(useTransform(scrollYProgress, [0, 1], [40, 0]), {
        stiffness: physicsConfig.cardStiffness,
        damping: physicsConfig.cardDamping,
        mass: physicsConfig.cardMass
    });

    const isLeft = index % 2 === 0;

    return (
        <div ref={cardRef} className="relative flex w-full items-center justify-center pl-[80px] pr-6 md:px-16" style={{ minHeight: '40vh' }}>

            <motion.div
                className={`w-full max-w-5xl flex flex-col ${isLeft ? 'md:items-start' : 'md:items-end'} items-center`}
                style={{
                    opacity: springOpacity,
                    scale: springScale,
                    y: springY,
                }}
            >
                <div className="relative w-full md:max-w-lg" style={{ padding: '40px 32px', minHeight: '240px' }}>

                    {/* Glass Backing */}
                    <div className="absolute inset-0 pointer-events-none bg-black/40 backdrop-blur-sm" style={{ border: `1px solid rgba(255, 255, 255, 0.05)`, borderRadius: '4px' }} />
                    <CornerBrackets color={stage.accent} />

                    <div className="relative z-10">
                        {/* Status */}
                        <div className="flex items-center gap-2 mb-6">
                            <motion.div
                                className="w-[6px] h-[6px] rounded-full"
                                style={{
                                    backgroundColor: stage.accent,
                                    boxShadow: `0 0 10px ${stage.accent}`
                                }}
                                animate={{ opacity: [0.4, 1, 0.4] }}
                                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                            />
                            <span style={{ ...MONO, fontSize: '10px', color: `${stage.accent}cc` }}>{stage.statusLabel}</span>
                            <span style={{ ...MONO, fontSize: '10px', color: 'rgba(255,255,255,0.2)' }}>·</span>
                            <span style={{ ...MONO, fontSize: '10px', color: 'rgba(255,255,255,0.35)' }}>
                                {String(index + 1).padStart(2, '0')}/{String(total).padStart(2, '0')}
                            </span>
                        </div>

                        <h3 className="text-2xl sm:text-3xl md:text-4xl font-medium tracking-tighter leading-tight mb-4 text-white">
                            {stage.tagline}
                        </h3>

                        <p className="text-sm md:text-base tracking-tight leading-relaxed max-w-md text-white/50 mb-6">
                            {stage.detail}
                        </p>

                        <span style={{ ...MONO, fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>{stage.meta}</span>
                    </div>

                    {/* Ambient / Thematic Visual Layer */}
                    <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-sm" style={{ zIndex: 0 }}>
                        {stage.id === 'screenplay' && <DataWaterfallEffect accent={stage.accent} progress={scrollYProgress} />}
                        {stage.id === 'world-gen' && <ParticleCloudEffect accent={stage.accent} progress={scrollYProgress} />}
                        {stage.id === 'staging' && <CameraRailEffect accent={stage.accent} progress={scrollYProgress} />}
                        {stage.id === 'orchestration' && <OrbitalRingsEffect accent={stage.accent} progress={scrollYProgress} />}
                    </div>

                </div>
            </motion.div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════
   CornerBrackets — Film viewfinder corner brackets
   ═══════════════════════════════════════════════════════════════ */
function CornerBrackets({ color }: { color: string }) {
    const corners = [
        { top: '-1px', left: '-1px', borderTop: true, borderLeft: true },
        { top: '-1px', right: '-1px', borderTop: true, borderRight: true },
        { bottom: '-1px', left: '-1px', borderBottom: true, borderLeft: true },
        { bottom: '-1px', right: '-1px', borderBottom: true, borderRight: true },
    ];

    return (
        <>
            {corners.map((c, i) => {
                const pos: React.CSSProperties = {};
                if (c.top !== undefined) pos.top = c.top;
                if (c.bottom !== undefined) pos.bottom = c.bottom;
                if (c.left !== undefined) pos.left = c.left;
                if (c.right !== undefined) pos.right = c.right;

                return (
                    <div
                        key={i}
                        className="absolute pointer-events-none"
                        style={{
                            ...pos,
                            width: '16px',
                            height: '16px',
                            borderTop: c.borderTop ? `1px solid ${color}60` : 'none',
                            borderBottom: c.borderBottom ? `1px solid ${color}60` : 'none',
                            borderLeft: c.borderLeft ? `1px solid ${color}60` : 'none',
                            borderRight: c.borderRight ? `1px solid ${color}60` : 'none',
                        }}
                    />
                );
            })}
        </>
    );
}

/* ═══════════════════════════════════════════════════════════════
   Effect Components
   ═══════════════════════════════════════════════════════════════ */

function DataWaterfallEffect({ accent, progress }: { accent: string; progress: any }) {
    const opacity = useSpring(useTransform(progress, [0, 1], [0, 0.15]), { stiffness: 100, damping: 20 });
    return (
        <motion.div className="absolute inset-0" style={{ opacity, maskImage: 'linear-gradient(to bottom, transparent, black 20%, black 80%, transparent)' }}>
            {Array.from({ length: 14 }).map((_, i) => (
                <div
                    key={i}
                    className="absolute text-[8px] whitespace-nowrap"
                    style={{
                        left: `${5 + Math.random() * 90}%`,
                        color: accent,
                        animation: `data-waterfall ${1.5 + Math.random() * 2}s linear ${Math.random() * 2}s infinite`
                    }}
                >
                    {Math.random() > 0.5 ? '01001010 01101' : 'EXT. SCENE - DAY'}
                </div>
            ))}
        </motion.div>
    );
}

function ParticleCloudEffect({ accent, progress }: { accent: string; progress: any }) {
    const scale = useSpring(useTransform(progress, [0, 1], [0.5, 1]), { stiffness: 100, damping: 15 });
    const opacity = useSpring(useTransform(progress, [0, 1], [0, 0.3]), { stiffness: 100, damping: 15 });

    return (
        <motion.div className="absolute inset-y-0 right-0 w-1/2 flex items-center justify-center opacity-80" style={{ scale, opacity }}>
            {Array.from({ length: 30 }).map((_, i) => {
                const angle = Math.random() * Math.PI * 2;
                const distance = 10 + Math.random() * 70;
                const tx = Math.cos(angle) * distance;
                const ty = Math.sin(angle) * distance;
                return (
                    <div
                        key={i}
                        className="absolute w-[2px] h-[2px] rounded-full"
                        style={{
                            background: accent,
                            boxShadow: `0 0 10px ${accent}`,
                            '--tx': `${tx}px`,
                            '--ty': `${ty}px`,
                            animation: `particle-drift ${2 + Math.random() * 2}s ease-out ${Math.random() * 2}s infinite`
                        } as React.CSSProperties}
                    />
                );
            })}
        </motion.div>
    );
}

function CameraRailEffect({ accent, progress }: { accent: string; progress: any }) {
    const scaleX = useSpring(useTransform(progress, [0, 1], [0, 1]), { stiffness: 120, damping: 20 });
    const opacity = useSpring(useTransform(progress, [0, 1], [0, 0.4]), { stiffness: 120, damping: 20 });

    return (
        <motion.div className="absolute inset-0" style={{ opacity }}>
            <motion.div className="absolute top-1/2 left-4 right-4 h-px border-t border-dashed origin-left" style={{ borderColor: accent, scaleX }} />
            <motion.div
                className="absolute top-1/2 left-1/3 w-4 h-4 border border-white/50 bg-black/50 backdrop-blur-sm shadow-lg -translate-y-1/2 flex items-center justify-center origin-left"
                style={{ scale: scaleX }}
            >
                <div className="w-1 h-1 rounded-full" style={{ backgroundColor: accent }} />
            </motion.div>
            <motion.div
                className="absolute top-1/2 right-1/4 w-3 h-3 border border-white/30 bg-black -translate-y-1/2 origin-left"
                style={{ scale: scaleX }}
            />
        </motion.div>
    );
}

function OrbitalRingsEffect({ accent, progress }: { accent: string; progress: any }) {
    const scale = useSpring(useTransform(progress, [0, 1], [0.2, 1]), { stiffness: 100, damping: 20 });
    const opacity = useSpring(useTransform(progress, [0, 1], [0, 0.25]), { stiffness: 100, damping: 20 });

    return (
        <motion.div className="absolute inset-y-0 right-0 w-1/2 flex items-center justify-center mix-blend-screen" style={{ scale, opacity, perspective: '800px' }}>
            {[
                { rx: '70deg', ry: '0deg', duration: '8s' },
                { rx: '70deg', ry: '60deg', duration: '12s' },
                { rx: '70deg', ry: '-60deg', duration: '10s' },
            ].map((ring, i) => (
                <div
                    key={i}
                    className="absolute w-32 h-32 rounded-full border-[1.5px] border-dashed"
                    style={{
                        borderColor: accent,
                        '--rx': ring.rx,
                        '--ry': ring.ry,
                        animation: `orbit-ring ${ring.duration} linear infinite`
                    } as React.CSSProperties}
                />
            ))}
        </motion.div>
    );
}
