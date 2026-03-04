'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface SuccessOverlayProps {
    show: boolean;
    onClose?: () => void;
}

export function SuccessOverlay({ show, onClose }: SuccessOverlayProps) {
    const [buttonVisible, setButtonVisible] = useState(false);

    // Generate random particles once when the component mounts
    const [particles] = useState(() =>
        Array.from({ length: 40 }).map((_, i) => ({
            id: i,
            angle: Math.random() * Math.PI * 2,
            velocity: 15 + Math.random() * 40,
            size: 2 + Math.random() * 4,
            delay: Math.random() * 0.1,
            color: Math.random() > 0.5 ? '#06b6d4' : '#ec4899' // Cyan or Pink
        }))
    );

    useEffect(() => {
        if (!show) {
            setButtonVisible(false);
            return;
        }
        // Small delay so button animates in after text
        const timer = setTimeout(() => setButtonVisible(true), 100);
        return () => clearTimeout(timer);
    }, [show]);

    return (
        <AnimatePresence>
            {show && (
                <motion.div
                    key="success-overlay"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        zIndex: 9999,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'radial-gradient(ellipse 70% 60% at 50% 50%, #0a081e 0%, #000000 100%)',
                    }}
                >
                    {/* Particles Explosion */}
                    <div style={{ position: 'absolute', top: '50%', left: '50%', width: 0, height: 0, pointerEvents: 'none' }}>
                        {particles.map(p => (
                            <motion.div
                                key={p.id}
                                initial={{ x: 0, y: 0, opacity: 1, scale: 0 }}
                                animate={{
                                    x: Math.cos(p.angle) * p.velocity * 10,
                                    y: Math.sin(p.angle) * p.velocity * 10,
                                    opacity: 0,
                                    scale: p.size / 2
                                }}
                                transition={{
                                    duration: 1.2 + Math.random() * 0.8,
                                    delay: p.delay,
                                    ease: "easeOut"
                                }}
                                style={{
                                    position: 'absolute',
                                    width: p.size,
                                    height: p.size,
                                    borderRadius: '50%',
                                    backgroundColor: p.color,
                                    boxShadow: `0 0 ${p.size * 2}px ${p.color}`,
                                }}
                            />
                        ))}
                    </div>

                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        textAlign: 'center',
                        padding: '0 24px',
                        minHeight: '220px',
                    }}>

                        {/* "You're on the list." */}
                        <motion.h2
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.8, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
                            style={{
                                fontSize: 'clamp(2.5rem, 6vw, 4rem)',
                                fontWeight: 600,
                                letterSpacing: '-0.03em',
                                lineHeight: 1,
                                marginBottom: '16px',
                                background: 'linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(180,165,255,0.85) 100%)',
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                            }}
                        >
                            You&apos;re on the list.
                        </motion.h2>

                        {/* "We'll be in touch." */}
                        <motion.p
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.8, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
                            style={{
                                fontSize: 'clamp(1.1rem, 2.5vw, 1.35rem)',
                                color: 'rgba(200, 200, 210, 0.8)',
                                letterSpacing: '-0.01em',
                                margin: 0,
                            }}
                        >
                            We&apos;ll be in touch.
                        </motion.p>

                        {/* Back button — always in DOM, animated via CSS */}
                        {onClose && (
                            <button
                                onClick={buttonVisible ? onClose : undefined}
                                style={{
                                    marginTop: '48px',
                                    padding: '10px 24px',
                                    borderRadius: '9999px',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    background: 'rgba(255,255,255,0.03)',
                                    color: 'rgba(255,255,255,0.35)',
                                    fontSize: '11px',
                                    letterSpacing: '0.15em',
                                    textTransform: 'uppercase' as const,
                                    fontWeight: 500,
                                    cursor: buttonVisible ? 'pointer' : 'default',
                                    opacity: buttonVisible ? 1 : 0,
                                    transform: buttonVisible ? 'translateY(0)' : 'translateY(10px)',
                                    pointerEvents: buttonVisible ? 'auto' : 'none',
                                    transition: 'opacity 0.5s ease-out, transform 0.5s ease-out, border-color 0.3s ease, color 0.3s ease',
                                }}
                                onMouseEnter={(e) => {
                                    if (!buttonVisible) return;
                                    e.currentTarget.style.borderColor = 'rgba(140,120,255,0.3)';
                                    e.currentTarget.style.color = 'rgba(180,165,255,0.7)';
                                }}
                                onMouseLeave={(e) => {
                                    if (!buttonVisible) return;
                                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                                    e.currentTarget.style.color = 'rgba(255,255,255,0.35)';
                                }}
                            >
                                ← Back to home
                            </button>
                        )}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
