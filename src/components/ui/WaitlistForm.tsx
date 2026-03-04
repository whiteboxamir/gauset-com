'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

interface WaitlistFormProps {
    className?: string;
    size?: 'default' | 'large';
    placeholder?: string;
    buttonText?: string;
    onSuccess?: () => void;
}

export function WaitlistForm({
    className,
    size = 'default',
    placeholder = 'you@yourstudio.com',
    buttonText,
    onSuccess,
}: WaitlistFormProps) {
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [message, setMessage] = useState('');
    const [isFocused, setIsFocused] = useState(false);

    const handleSubmit = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (status === 'loading' || status === 'success') return;

        setStatus('loading');
        setMessage('');

        const formData = new FormData(e.currentTarget);
        const email = formData.get('email') as string;

        try {
            const res = await fetch('/api/waitlist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });

            const data = await res.json();

            if (data.success) {
                setStatus('success');
                setMessage(data.message);
                onSuccess?.();
            } else {
                setStatus('error');
                setMessage(data.message);
                setTimeout(() => {
                    setStatus('idle');
                    setMessage('');
                }, 3000);
            }
        } catch {
            setStatus('error');
            setMessage('Something went wrong. Try again.');
            setTimeout(() => {
                setStatus('idle');
                setMessage('');
            }, 3000);
        }
    }, [status, onSuccess]);

    const isLarge = size === 'large';
    const showTextButton = isLarge && buttonText;

    return (
        <div className={cn('relative w-full max-w-md mx-auto', className)}>
            <AnimatePresence mode="wait">
                {status !== 'success' ? (
                    <motion.form
                        key="form"
                        onSubmit={handleSubmit}
                        initial={false}
                        exit={{ opacity: 0, scale: 0.95, filter: 'blur(6px)', transition: { duration: 0.5, ease: [0.4, 0, 0.2, 1] } }}
                        className={cn(
                            'relative group flex items-center w-full bg-black/40 backdrop-blur-md border rounded-full transition-all duration-500 z-10',
                            isLarge ? 'pl-8 pr-2 py-2' : 'pl-6 pr-2 py-2',
                            isFocused
                                ? 'border-cyan-400 shadow-[0_0_30px_rgba(34,211,238,0.4)]'
                                : 'border-white/20 hover:border-white/30 hover:bg-black/50'
                        )}
                    >
                        {/* Animated glow ring behind input */}
                        <div
                            className={cn(
                                'absolute -inset-[2px] rounded-full transition-all duration-700 pointer-events-none -z-10',
                                isFocused
                                    ? 'opacity-100 blur-md scale-[1.02]'
                                    : 'opacity-0 scale-100'
                            )}
                            style={{
                                background: isFocused
                                    ? 'linear-gradient(90deg, #ec4899, #06b6d4, #8b5cf6, #ec4899)'
                                    : 'none',
                                backgroundSize: '200% 200%',
                                animation: isFocused ? 'gradient-xy 3s linear infinite' : 'none',
                            }}
                        />

                        <input
                            type="email"
                            name="email"
                            placeholder={placeholder}
                            required
                            disabled={status === 'loading'}
                            onFocus={() => setIsFocused(true)}
                            onBlur={() => setIsFocused(false)}
                            className={cn(
                                'relative z-[1] flex-1 min-w-0 bg-transparent text-white',
                                'placeholder:text-neutral-400 focus:outline-none transition-all duration-500',
                                'border-none',
                                isLarge ? 'py-3 text-lg' : 'py-2 text-base'
                            )}
                        />

                        <button
                            type="submit"
                            disabled={status === 'loading'}
                            className={cn(
                                'shrink-0 rounded-full flex items-center justify-center z-[2]',
                                'transition-all duration-500 disabled:cursor-not-allowed',
                                'active:scale-95 hover:scale-[1.05] hover:brightness-110',
                                status === 'loading'
                                    ? 'bg-white/10 text-white/60'
                                    : showTextButton
                                        ? 'bg-white text-black hover:bg-[rgba(100,200,220,1)] hover:text-white hover:shadow-[0_0_24px_rgba(13,59,79,0.4)]'
                                        : 'bg-white text-black hover:bg-[rgba(100,200,220,1)] hover:text-white hover:shadow-[0_0_20px_rgba(13,59,79,0.4)]',
                                showTextButton
                                    ? 'px-6 py-3 text-sm font-medium tracking-wide'
                                    : isLarge ? 'w-12 h-12' : 'w-10 h-10'
                            )}
                            style={{
                                animation: status !== 'loading' ? 'cta-glow-pulse 4s ease-in-out infinite' : 'none',
                            }}
                        >
                            {status === 'loading' ? (
                                <svg className={cn('animate-spin', isLarge ? 'w-5 h-5' : 'w-4 h-4')} viewBox="0 0 24 24" fill="none">
                                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                                    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                </svg>
                            ) : showTextButton ? (
                                buttonText
                            ) : (
                                <svg className={cn(isLarge ? 'w-5 h-5' : 'w-4 h-4')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M5 12h14M12 5l7 7-7 7" />
                                </svg>
                            )}
                        </button>

                        {/* Shimmer overlay during loading */}
                        {status === 'loading' && (
                            <div className="absolute inset-0 rounded-full overflow-hidden z-[3] pointer-events-none">
                                <div
                                    className="absolute inset-0 animate-shimmer"
                                    style={{
                                        background: 'linear-gradient(90deg, transparent, rgba(100,200,220,0.07), transparent)',
                                    }}
                                />
                            </div>
                        )}
                    </motion.form>
                ) : (
                    <motion.div
                        key="success"
                        initial={{ opacity: 0, scale: 0.95, filter: 'blur(6px)' }}
                        animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                        transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
                        className={cn(
                            'flex items-center justify-center w-full bg-black/40 backdrop-blur-md border border-[rgba(100,200,220,0.4)] rounded-full',
                            isLarge ? 'py-3 text-lg' : 'py-2 text-base'
                        )}
                        style={{ boxShadow: '0 0 20px rgba(13,59,79,0.3)' }}
                    >
                        <p className="text-white font-medium tracking-wide">
                            {message || 'Access Requested'}
                        </p>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Error message */}
            <AnimatePresence>
                {status === 'error' && message && (
                    <motion.p
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -5 }}
                        className="absolute -bottom-8 left-0 right-0 text-center text-sm font-medium text-red-400/80"
                    >
                        {message}
                    </motion.p>
                )}
            </AnimatePresence>
        </div>
    );
}
