import type { Metadata, Viewport } from 'next'
import { GeistSans } from 'geist/font/sans';
import './globals.css'

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
}

export const metadata: Metadata = {
    title: 'GAUSET | Build worlds. Not clips.',
    description: 'Gauset is a production layer for AI-generated worlds. You don\'t generate shots — you build worlds and direct inside them.',
}

export default function RootLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <html lang="en" className={GeistSans.className}>
            <body className="antialiased selection:bg-white/20 selection:text-white bg-black text-[#ebebeb]">
                {children}
            </body>
        </html>
    )
}
