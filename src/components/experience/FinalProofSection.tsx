'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * FinalProofSection — "From prompt to production."
 * Cinematic proof section with full-bleed autoplay video as background.
 * Self-contained: no global CSS, no external dependencies beyond React.
 */
export function FinalProofSection() {
    const sectionRef = useRef<HTMLDivElement>(null);
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const el = sectionRef.current;
        if (!el) return;

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setIsVisible(true);
                }
            },
            { threshold: 0.1 }
        );

        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    return (
        <section
            ref={sectionRef}
            style={{
                position: 'relative',
                width: '100%',
                height: '85vh',
                overflow: 'hidden',
                background: '#050510',
                opacity: isVisible ? 1 : 0,
                transition: 'opacity 1.2s ease',
            }}
        >
            {/* Video — absolute fill, acts as background */}
            <video
                src="/video/gauset-proof.mp4"
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    objectPosition: 'center 70%',
                    display: 'block',
                }}
            />

            {/* Dark depth overlay */}
            <div
                style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(0, 0, 0, 0.3)',
                    pointerEvents: 'none',
                    zIndex: 1,
                }}
            />

            {/* Top gradient — seamless blend into page above */}
            <div
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: '30%',
                    background: 'linear-gradient(to bottom, #050510 0%, transparent 100%)',
                    pointerEvents: 'none',
                    zIndex: 2,
                }}
            />

            {/* Bottom gradient — seamless blend into page below */}
            <div
                style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: '30%',
                    background: 'linear-gradient(to top, #050510 0%, transparent 100%)',
                    pointerEvents: 'none',
                    zIndex: 2,
                }}
            />

            {/* Text content — positioned at top, above video content */}
            <div
                style={{
                    position: 'relative',
                    zIndex: 3,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'flex-start',
                    height: '100%',
                    padding: '6vh 24px 0',
                    pointerEvents: 'none',
                }}
            >
                {/* Label */}
                <p
                    style={{
                        fontSize: '10px',
                        letterSpacing: '0.35em',
                        textTransform: 'uppercase',
                        fontWeight: 500,
                        color: 'rgba(100, 200, 220, 0.5)',
                        marginBottom: '16px',
                        textShadow: '0 1px 8px rgba(0,0,0,0.9)',
                    }}
                >
                    In Production
                </p>

                {/* Headline */}
                <h2
                    style={{
                        fontSize: 'clamp(2rem, 5vw, 3.5rem)',
                        fontWeight: 500,
                        letterSpacing: '-0.04em',
                        lineHeight: 1.1,
                        color: 'rgba(255, 255, 255, 0.9)',
                        textAlign: 'center',
                        margin: '0 0 12px 0',
                        textShadow: '0 4px 30px rgba(0,0,0,0.8)',
                    }}
                >
                    From prompt to production.
                </h2>

                {/* Subtext */}
                <p
                    style={{
                        fontSize: 'clamp(0.875rem, 1.5vw, 1.125rem)',
                        color: 'rgba(200, 200, 200, 0.85)',
                        letterSpacing: '-0.01em',
                        lineHeight: 1.6,
                        textAlign: 'center',
                        maxWidth: '480px',
                        margin: 0,
                        textShadow: '0 2px 16px rgba(0,0,0,0.9)',
                    }}
                >
                    Real workflows. Real worlds. Directed&nbsp;in&#8209;browser.
                </p>
            </div>
        </section>
    );
}
