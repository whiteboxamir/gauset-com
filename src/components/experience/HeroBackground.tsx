'use client';

import { useEffect, useRef, useState } from 'react';

export function HeroBackground() {
    const containerRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const [parallax, setParallax] = useState({ x: 0, y: 0 });
    const [videoReady, setVideoReady] = useState(false);

    // Subtle parallax on mouse move
    useEffect(() => {
        const handleMouse = (e: MouseEvent) => {
            const cx = window.innerWidth / 2;
            const cy = window.innerHeight / 2;
            const dx = (e.clientX - cx) / cx;
            const dy = (e.clientY - cy) / cy;
            setParallax({ x: dx * -4, y: dy * -3 });
        };
        window.addEventListener('mousemove', handleMouse, { passive: true });
        return () => window.removeEventListener('mousemove', handleMouse);
    }, []);

    // Start video on mount (muted autoplay is allowed)
    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.play().catch(() => { });
        }
    }, []);

    return (
        <div
            ref={containerRef}
            className="absolute inset-0 overflow-hidden"
            style={{ zIndex: 0, backgroundColor: '#050510' }}
        >
            {/* Single looping hero video */}
            <video
                ref={videoRef}
                src="/video/hero-bg.mp4"
                autoPlay
                muted
                loop
                playsInline
                preload="auto"
                onCanPlayThrough={() => setVideoReady(true)}
                className="absolute inset-0 w-full h-full object-cover"
                style={{
                    opacity: videoReady ? 1 : 0,
                    transition: 'opacity 1s ease-in-out',
                    transform: `translate(${parallax.x}px, ${parallax.y}px)`,
                    animation: 'hero-drift 20s ease-in-out infinite',
                    willChange: 'opacity, transform',
                    pointerEvents: 'none',
                }}
            />

            {/* Haze / volumetric light overlay */}
            <div
                className="absolute inset-0 pointer-events-none"
                style={{
                    background: 'radial-gradient(ellipse 120% 80% at 40% 45%, rgba(255,240,200,0.06) 0%, transparent 60%)',
                    animation: 'hero-haze 12s ease-in-out infinite',
                    willChange: 'opacity, transform',
                }}
            />

            {/* Vignette overlay — strong to preserve text contrast */}
            <div
                className="absolute inset-0 pointer-events-none"
                style={{
                    background: 'radial-gradient(ellipse 70% 60% at 50% 50%, transparent 15%, rgba(0,0,0,0.9) 100%)',
                }}
            />

            {/* Bottom fade for text + form readability */}
            <div
                className="absolute inset-x-0 bottom-0 pointer-events-none"
                style={{
                    height: '55%',
                    background: 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.3) 60%, transparent 100%)',
                }}
            />

            {/* Top fade for nav readability */}
            <div
                className="absolute inset-x-0 top-0 pointer-events-none"
                style={{
                    height: '20%',
                    background: 'linear-gradient(to bottom, rgba(0,0,0,0.4) 0%, transparent 100%)',
                }}
            />

            {/* Extra darkening behind center content area for form readability */}
            <div
                className="absolute inset-0 pointer-events-none"
                style={{
                    background: 'radial-gradient(ellipse 60% 50% at 50% 55%, rgba(0,0,0,0.55) 0%, transparent 75%)',
                }}
            />

            {/* Cinematic grain overlay — barely noticeable noise texture */}
            <div
                className="absolute inset-0 pointer-events-none"
                style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`,
                    backgroundSize: '180px 180px',
                    opacity: 0.04,
                    mixBlendMode: 'overlay',
                    animation: 'grain 8s steps(10) infinite',
                }}
            />

            {/* Live production: subtle exposure shift — warm light pulse */}
            <div
                className="absolute inset-0 pointer-events-none"
                style={{
                    background: 'radial-gradient(ellipse 80% 70% at 45% 40%, rgba(255,230,180,0.12) 0%, transparent 65%)',
                    animation: 'exposure-shift 8s ease-in-out infinite',
                    willChange: 'opacity',
                }}
            />

            {/* Live production: gentle focus pulse */}
            <div
                className="absolute inset-0 pointer-events-none"
                style={{
                    background: 'transparent',
                    animation: 'focus-pulse 12s ease-in-out infinite',
                    willChange: 'filter, opacity',
                }}
            />

            {/* Live production: slow cinematic scanline pass */}
            <div
                className="absolute inset-x-0 pointer-events-none"
                style={{
                    height: '2px',
                    background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 30%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.06) 70%, transparent 100%)',
                    animation: 'scanline-pass 18s linear infinite',
                    willChange: 'transform, opacity',
                }}
            />
        </div>
    );
}
