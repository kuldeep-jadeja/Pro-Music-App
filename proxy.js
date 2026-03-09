import { NextResponse } from 'next/server';

// Routes that do NOT require authentication
const PUBLIC_PATHS = new Set(['/login', '/signup']);

// API routes that are publicly accessible (auth endpoints)
const PUBLIC_API_PREFIXES = ['/api/auth/login', '/api/auth/signup'];

export function proxy(request) {
    const { pathname } = request.nextUrl;

    // Always skip Next.js internals, static files, and public assets
    if (
        pathname.startsWith('/_next/') ||
        pathname.startsWith('/icons/') ||
        pathname === '/manifest.json' ||
        pathname === '/sw.js' ||
        pathname === '/offline.html' ||
        pathname === '/robot.txt' ||
        pathname === '/favicon.ico'
    ) {
        return NextResponse.next();
    }

    // Always allow public API endpoints
    if (PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))) {
        return NextResponse.next();
    }

    const token = request.cookies.get('token')?.value;
    const isPublicPage = PUBLIC_PATHS.has(pathname);

    // Not authenticated → redirect to /login (except when already there)
    if (!token && !isPublicPage) {
        const loginUrl = request.nextUrl.clone();
        loginUrl.pathname = '/login';
        // Preserve the intended destination so we can redirect after login
        loginUrl.searchParams.set('from', pathname);
        return NextResponse.redirect(loginUrl);
    }

    // Authenticated user trying to visit /login or /signup → send them home
    if (token && isPublicPage) {
        const homeUrl = request.nextUrl.clone();
        homeUrl.pathname = '/';
        homeUrl.search = '';
        return NextResponse.redirect(homeUrl);
    }

    return NextResponse.next();
}

export const config = {
    // Run on all routes; static file exclusions are handled inside the function
    matcher: ['/((?!_next/static|_next/image).*)'],
};
