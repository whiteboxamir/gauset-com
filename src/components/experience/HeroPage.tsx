'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { ScrollControls, Scroll, Preload } from '@react-three/drei';
import { EffectComposer, Vignette, Bloom } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import * as THREE from 'three';
import { motion, AnimatePresence } from 'framer-motion';
import { WorldRenderer } from './WorldRenderer';
import { WaitlistForm } from '@/components/ui/WaitlistForm';
import { SuccessOverlay } from '@/components/ui/SuccessOverlay';
import { HeroBackground } from './HeroBackground';
import { DirectorOverlay } from './DirectorOverlay';
import { PipelineSection } from './PipelineSection';
import { FinalProofSection } from './FinalProofSection';
import { GlitchText } from '@/components/ui/GlitchText';

function CameraController() {
    const { camera, size } = useThree();
    useEffect(() => {
        const cam = camera as THREE.PerspectiveCamera;
        if (cam.fov !== undefined) {
            cam.fov = size.width < 768 ? 85 : 50;
            cam.updateProjectionMatrix();
        }
    }, [size, camera]);
    return null;
}

export function HeroPage() {
    const [showOverlay, setShowOverlay] = useState(false);
    const handleFormSuccess = useCallback(() => { setShowOverlay(true); }, []);
    const handleOverlayClose = useCallback(() => { setShowOverlay(false); }, []);

    const pageContent = (
        <>
            <div className="hero-container flex flex-col items-center justify-center px-6 text-center relative">
                <HeroBackground />
                <div className="absolute inset-x-0 bottom-0 pointer-events-none" style={{ height: '18%', background: 'linear-gradient(to bottom, transparent 0%, #050510 100%)', zIndex: 50 }} />
                <div className="absolute bottom-0 left-0 w-full h-32 pointer-events-none bg-gradient-to-b from-transparent to-black/60" style={{ zIndex: 51 }} />

                <AnimatePresence>
                    <div className="flex flex-col items-center text-center max-w-5xl relative" style={{ zIndex: 10 }}>
                        <div className="absolute pointer-events-none" style={{ top: '50%', left: '50%', transform: 'translate(-50%, -55%)', width: '120%', height: '80%', background: 'radial-gradient(ellipse 70% 50% at 50% 45%, rgba(0,0,0,0.25) 0%, transparent 70%)', zIndex: -1 }} />
                        <h1 className="hero-headline mb-6 pb-2 leading-[0.92] tracking-[-0.04em]" style={{ filter: 'drop-shadow(0 2px 20px rgba(0,0,0,0.4)) drop-shadow(0 4px 40px rgba(0,0,0,0.3))' }}>
                            <HeroWord word="Build" delay={0} />
                            <HeroWord word="worlds." delay={0.4} />
                            <br className="hidden sm:block" />
                            <HeroWord word="Not" delay={0.9} />
                            <HeroWord word="clips." delay={1.3} isLast />
                        </h1>
                        <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1.4, delay: 2.4, ease: [0.25, 0.1, 0.25, 1] }} className="max-w-xl md:max-w-2xl text-xl md:text-2xl lg:text-3xl tracking-tight text-neutral-300 mb-10 leading-snug" style={{ textShadow: '0 2px 20px rgba(0,0,0,0.8)' }}>
                            The production layer for&nbsp;AI&nbsp;cinema.
                        </motion.p>
                        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1.0, delay: 3.0, ease: [0.25, 0.1, 0.25, 1] }} className="w-full max-w-md pointer-events-auto">
                            <div style={{ animation: "pulse 2.5s ease-in-out infinite" }}>
                                <WaitlistForm size="large" placeholder="you@yourstudio.com" buttonText="Enter early" onSuccess={handleFormSuccess} />
                            </div>
                        </motion.div>
                        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 3.6 }} className="mt-5 text-[11px] uppercase tracking-[0.3em] font-medium" style={{ color: 'rgba(100, 200, 220, 0.45)', textShadow: '0 1px 12px rgba(13,59,79,0.4)' }}>
                            Private access · Rolling invites
                        </motion.p>
                    </div>
                </AnimatePresence>
                <DirectorOverlay />
                <div style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: "120px", pointerEvents: "none", background: "linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,0.6))" }} />
            </div>
            <div style={{ height: '60dvh', position: 'relative', zIndex: 1 }} />
            <div className="h-[100dvh] flex items-center relative">
                <div className="w-full max-w-6xl mx-auto px-6 md:px-16">
                    <div className="md:ml-auto md:max-w-2xl space-y-8">
                        <p className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-medium tracking-tighter leading-[1.05] text-white/90" style={{ textShadow: '0 4px 30px rgba(0,0,0,0.9)' }}>
                            AI video breaks<br />at production.
                        </p>
                        <div className="space-y-4">
                            <p className="text-base md:text-lg text-neutral-400 tracking-tight leading-relaxed max-w-lg" style={{ textShadow: '0 2px 16px rgba(0,0,0,0.9)' }}>Nothing persists. Nothing matches. Characters change faces. Environments reset. Lighting never carries over.</p>
                            <p className="text-base md:text-lg text-neutral-500 tracking-tight leading-relaxed max-w-lg" style={{ textShadow: '0 2px 16px rgba(0,0,0,0.9)' }}>You can&apos;t build a film from isolated clips. Current tools are built for demos, not for production.</p>
                        </div>
                    </div>
                </div>
            </div>
            <div style={{ height: '60dvh' }} />
            <div className="h-[100dvh] flex items-center relative">
                <div className="w-full max-w-6xl mx-auto px-6 md:px-16">
                    <div className="md:max-w-2xl space-y-8">
                        <p className="text-[10px] uppercase tracking-[0.35em] font-medium" style={{ textShadow: '0 1px 8px rgba(0,0,0,0.9)', color: 'rgba(100, 200, 220, 0.5)' }}>Introducing GAUSET</p>
                        <p className="text-4xl sm:text-5xl md:text-6xl font-medium tracking-tighter leading-[1.05] text-white/90" style={{ textShadow: '0 4px 30px rgba(0,0,0,0.9)' }}>Persistent worlds.</p>
                        <div className="space-y-4">
                            <p className="text-base md:text-lg text-neutral-400 tracking-tight leading-relaxed max-w-lg" style={{ textShadow: '0 2px 16px rgba(0,0,0,0.9)' }}>Build a world once and it stays. Same lighting. Same environment. Full continuity across every shot.</p>
                            <p className="text-base md:text-lg text-neutral-500 tracking-tight leading-relaxed max-w-lg" style={{ textShadow: '0 2px 16px rgba(0,0,0,0.9)' }}>Place cameras. Direct characters. Reshoot without rebuilding.</p>
                        </div>
                    </div>
                </div>
            </div>
            <div style={{ height: '60dvh' }} />
            <div className="h-[100dvh] flex flex-col items-center justify-center relative pointer-events-none">
                <div className="flex flex-col items-center justify-center pointer-events-auto w-full">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        whileInView={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 1.0, ease: "easeOut" }}
                        className="w-full max-w-5xl px-6 text-center relative"
                    >
                        {/* Glowing ambient backdrop */}
                        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[300px] bg-gradient-to-r from-pink-500/10 via-cyan-500/10 to-purple-500/10 blur-[100px] -z-10 rounded-full pointer-events-none" />

                        <h2 className="text-5xl sm:text-7xl md:text-8xl font-black tracking-tighter leading-[0.9]" style={{
                            background: 'linear-gradient(135deg, #ffffff 0%, #a5f3fc 50%, #f9a8d4 100%)',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            backgroundClip: 'text',
                            filter: 'drop-shadow(0 0 40px rgba(0,240,255,0.3))'
                        }}>
                            Absolute<br />Freedom.
                        </h2>

                        <p className="mt-8 text-xl md:text-2xl text-neutral-300 font-light tracking-tight max-w-2xl mx-auto leading-relaxed" style={{ textShadow: '0 4px 20px rgba(0,0,0,0.9)' }}>
                            The world is alive. Total control over every angle, every moment. No more static clips.
                        </p>

                        {/* Dynamic Shot Indicators */}
                        <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 mt-16 w-full max-w-4xl mx-auto">
                            {['WIDE', 'CLOSE', 'OTS', 'TRACK'].map((shot, i) => {
                                // We need a wrapper component for hooks, but doing inline Framer Motion events is easier here
                                return (
                                    <motion.div
                                        key={shot}
                                        initial={{ opacity: 0, y: 40, rotateX: 45 }}
                                        whileInView={{ opacity: 1, y: 0, rotateX: 0 }}
                                        transition={{
                                            duration: 0.8,
                                            delay: i * 0.15,
                                            type: 'spring',
                                            bounce: 0.5
                                        }}
                                        viewport={{ margin: "-50px" }}
                                        whileHover={{ scale: 1.15, zIndex: 20 }}
                                        onMouseMove={(e) => {
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            const x = e.clientX - rect.left;
                                            const y = e.clientY - rect.top;
                                            const centerX = rect.width / 2;
                                            const centerY = rect.height / 2;
                                            const rotateX = ((y - centerY) / centerY) * -15; // Max 15deg tilt
                                            const rotateY = ((x - centerX) / centerX) * 15;
                                            e.currentTarget.style.transform = `scale(1.15) perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.transform = `scale(1) perspective(1000px) rotateX(0deg) rotateY(0deg)`;
                                            // Let Framer Motion take back control
                                            e.currentTarget.style.transition = 'transform 0.5s cubic-bezier(0.25, 0.1, 0.25, 1)';
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.transition = 'none'; // Snappy follow when hovered
                                        }}
                                        className="relative group cursor-pointer"
                                        style={{ perspective: 1000 }}
                                    >
                                        {/* Vibrant glow */}
                                        <div className="absolute inset-0 bg-gradient-to-br from-pink-500 to-cyan-500 rounded-2xl blur-[16px] opacity-20 group-hover:opacity-100 transition-opacity duration-500" />

                                        {/* Glass block */}
                                        <div className="relative px-8 py-5 rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl flex flex-col items-center justify-center gap-2 overflow-hidden shadow-2xl transition-all duration-300 group-hover:border-white/30 group-hover:bg-black/80">
                                            {/* Targeting reticle decor */}
                                            <div className="absolute top-3 left-3 w-3 h-3 border-t-2 border-l-2 border-white/20 group-hover:border-cyan-400 transition-colors duration-300" />
                                            <div className="absolute top-3 right-3 w-3 h-3 border-t-2 border-r-2 border-white/20 group-hover:border-pink-500 transition-colors duration-300" />
                                            <div className="absolute bottom-3 left-3 w-3 h-3 border-b-2 border-l-2 border-white/20 group-hover:border-pink-500 transition-colors duration-300" />
                                            <div className="absolute bottom-3 right-3 w-3 h-3 border-b-2 border-r-2 border-white/20 group-hover:border-cyan-400 transition-colors duration-300" />

                                            <span className="text-[10px] text-neutral-500 tracking-[0.4em] font-medium group-hover:text-white/80 transition-colors">CAM_0{i + 1}</span>
                                            <span className="text-xl font-black tracking-widest text-white/90 group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-cyan-400 group-hover:to-pink-500 transition-all">{shot}</span>
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </div>
                    </motion.div>
                </div>
            </div>
            <div style={{ height: '30dvh' }} />
            <PipelineSection />
            <div style={{ height: '30dvh' }} />
            <div className="h-[100dvh] flex items-center justify-center relative pointer-events-none">
                <div className="max-w-4xl px-6 text-center space-y-8 z-10 w-full">
                    <motion.p
                        initial={{ opacity: 0, filter: 'blur(10px)', scale: 0.95 }}
                        whileInView={{ opacity: 1, filter: 'blur(0px)', scale: 1 }}
                        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                        viewport={{ once: false, amount: 0.6 }}
                        className="text-3xl sm:text-4xl md:text-5xl lg:text-7xl font-bold tracking-tighter text-white leading-tight mx-auto pointer-events-auto"
                        style={{
                            textShadow: '0 0 40px rgba(76, 209, 224, 0.5), 0 0 80px rgba(76, 209, 224, 0.2)',
                            background: 'linear-gradient(to bottom, #FFFFFF, #a5f3fc)',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            backgroundClip: 'text',
                        }}>
                        <GlitchText text="The world doesn't reset anymore." speed={40} duration={1200} scrambleOffset={4} delay={0.2} />
                    </motion.p>
                    <motion.p
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        transition={{ duration: 1.0, delay: 0.8, ease: "easeOut" }}
                        viewport={{ once: false, amount: 0.8 }}
                        className="text-base md:text-lg lg:text-xl text-neutral-300 tracking-tight leading-relaxed max-w-xl mx-auto pointer-events-auto"
                        style={{ textShadow: '0 2px 16px rgba(0,0,0,0.9)' }}>
                        Every shot lives in the same world. That changes everything.
                    </motion.p>
                </div>
            </div>
            <div style={{ height: '20dvh' }} />
            <FinalProofSection />
            <div style={{ height: '10dvh' }} />
            <div className="h-[100dvh] flex flex-col items-center justify-center relative">
                <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 80% 60% at 50% 55%, rgba(13,59,79,0.15) 0%, rgba(26,39,68,0.08) 40%, transparent 70%)' }} />
                <div className="relative z-10 flex flex-col items-center text-center max-w-2xl px-6">
                    <p className="text-5xl sm:text-6xl md:text-7xl font-medium tracking-[-0.04em] text-white/90 mb-3" style={{ textShadow: '0 4px 30px rgba(0,0,0,0.8)' }}>GAUSET</p>
                    <p className="text-base sm:text-lg tracking-tight text-neutral-400 font-light mb-10" style={{ textShadow: '0 2px 16px rgba(0,0,0,0.9)' }}>The production layer for AI cinema.</p>
                    <div className="w-full max-w-sm pointer-events-auto">
                        <WaitlistForm size="large" placeholder="you@yourstudio.com" buttonText="Request access" onSuccess={handleFormSuccess} />
                    </div>
                    <p className="mt-5 text-[11px] uppercase tracking-[0.3em] font-medium" style={{ color: 'rgba(100, 200, 220, 0.35)', textShadow: '0 1px 12px rgba(13,59,79,0.4)' }}>Private access · Rolling invites</p>
                </div>
                <footer className="absolute bottom-6 left-0 right-0 flex justify-center gap-8 text-xs text-neutral-600">
                    <span>© {new Date().getFullYear()} Gnosika Inc.</span>
                    <a href="/privacy" className="hover:text-neutral-400 transition-colors pointer-events-auto">Privacy</a>
                    <a href="/terms" className="hover:text-neutral-400 transition-colors pointer-events-auto">Terms</a>
                </footer>
            </div>
        </>
    );
    return (
        <div className="fixed inset-0 w-full h-full bg-transparent overflow-hidden overscroll-none">

            <nav className="fixed top-0 left-0 right-0 flex justify-between items-center px-6 md:px-10 py-5 pointer-events-none z-50">
                <div className="text-white/90 font-bold tracking-[0.15em] text-xs uppercase pointer-events-auto">Gauset</div>
            </nav>
            <SuccessOverlay show={showOverlay} onClose={handleOverlayClose} />

            <div className="absolute inset-0 w-full h-full -z-10">
                <Canvas camera={{ fov: 50, near: 0.1, far: 200 }} gl={{ antialias: true, alpha: false, powerPreference: 'high-performance', stencil: false, depth: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.85 }} dpr={[1, 1.5]} style={{ background: '#000000', touchAction: 'pan-y' }}>
                    <color attach="background" args={['#050510']} />
                    <fog attach="fog" args={['#050510', 30, 120]} />
                    <Suspense fallback={null}>
                        <CameraController />
                        <ScrollControls pages={12.0} damping={0.12}>
                            <WorldRenderer />
                            <Scroll html style={{ width: '100%' }}>
                                <div className="w-screen pointer-events-none">
                                    {pageContent}
                                </div>
                            </Scroll>
                        </ScrollControls>
                        <EffectComposer multisampling={0}>
                            <Bloom luminanceThreshold={0.5} luminanceSmoothing={0.5} intensity={0.5} radius={0.9} mipmapBlur />
                            <Vignette offset={0.25} darkness={0.65} blendFunction={BlendFunction.NORMAL} />
                        </EffectComposer>
                        <Preload all />
                    </Suspense>
                </Canvas>
            </div>
        </div>
    );
}

function HeroWord({ word, delay, isLast = false }: { word: string; delay: number; isLast?: boolean }) {
    return (
        <motion.span initial={{ opacity: 0, y: 40, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ duration: 1.2, delay, ease: [0.22, 1, 0.36, 1] }} className={`inline-block text-6xl sm:text-7xl md:text-8xl lg:text-9xl font-medium ${isLast ? '' : 'mr-4 md:mr-6'}`} style={{ background: 'linear-gradient(to bottom, #FFFFFF, #DADADA)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', textShadow: '0 2px 30px rgba(0,0,0,0.9), 0 0 60px rgba(0,0,0,0.5)', WebkitTextStroke: '0.3px rgba(255,255,255,0.08)' }}>
            {word}
        </motion.span>
    );
}
