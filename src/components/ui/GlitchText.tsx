'use client';

import { useEffect, useState, useRef } from 'react';
import { motion, useInView } from 'framer-motion';

const CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*+<>?!';

interface GlitchTextProps {
    text: string;
    className?: string;
    speed?: number;          // ms per tick
    duration?: number;       // total ms before completing
    scrambleOffset?: number; // max chars to scramble at once
    delay?: number;          // initial delay in seconds
}

export function GlitchText({
    text,
    className = '',
    speed = 40,
    duration = 1200,
    scrambleOffset = 3,
    delay = 0,
}: GlitchTextProps) {
    const [displayText, setDisplayText] = useState('');
    const containerRef = useRef<HTMLSpanElement>(null);
    const isInView = useInView(containerRef, { once: true, amount: 0.5 });

    // Convert delay to ms for logic
    const delayMs = delay * 1000;

    useEffect(() => {
        if (!isInView) {
            // Initial state: random garbage or hidden
            setDisplayText('');
            return;
        }

        let timeoutId: NodeJS.Timeout;
        let intervalId: NodeJS.Timeout;

        // Start effect after the delay
        timeoutId = setTimeout(() => {
            let iteration = 0;
            const targetLength = text.length;
            const totalIterations = duration / speed;
            // How many chars we lock in per iteration to finish strictly on time
            const charsPerIteration = targetLength / totalIterations;

            intervalId = setInterval(() => {
                const charsLocked = Math.floor(iteration * charsPerIteration);

                if (charsLocked >= targetLength) {
                    setDisplayText(text);
                    clearInterval(intervalId);
                    return;
                }

                const scrambled = text.split('').map((char, index) => {
                    // Preserve spaces
                    if (char === ' ') return ' ';

                    // If this char is already conceptually "locked in", show the real char
                    if (index < charsLocked) {
                        return char;
                    }

                    // If this char is within the scrambling window (next N chars), randomize it
                    if (index < charsLocked + scrambleOffset) {
                        return CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
                    }

                    // Otherwise, it hasn't appeared yet
                    return '';
                }).join('');

                setDisplayText(scrambled);
                iteration += 1;
            }, speed);
        }, delayMs);

        return () => {
            clearTimeout(timeoutId);
            clearInterval(intervalId);
        };
    }, [text, speed, duration, scrambleOffset, isInView, delayMs]);

    return (
        <motion.span
            ref={containerRef}
            className={className}
            initial={{ opacity: 0 }}
            animate={isInView ? { opacity: 1 } : { opacity: 0 }}
            transition={{ duration: 0.3, delay }}
        >
            {displayText || '\u00A0'}
        </motion.span>
    );
}
