// import Head from 'next/head';
// import Link from 'next/link';
// import { useState } from 'react';
// import { useRouter } from 'next/router';
// import { useAppContext } from '@/lib/AppContext';
// import styles from '@/styles/Auth.module.scss';

// export default function Login() {
//     const router = useRouter();
//     const { setUser } = useAppContext();
//     const [email, setEmail] = useState('');
//     const [password, setPassword] = useState('');
//     const [error, setError] = useState('');
//     const [loading, setLoading] = useState(false);

//     const handleSubmit = async (e) => {
//         e.preventDefault();
//         setError('');

//         if (password.length < 8) {
//             setError('Password must be at least 8 characters.');
//             return;
//         }

//         setLoading(true);

//         try {
//             const res = await fetch('/api/auth/login', {
//                 method: 'POST',
//                 headers: { 'Content-Type': 'application/json' },
//                 body: JSON.stringify({ email, password }),
//             });

//             const data = await res.json();

//             if (!res.ok) {
//                 setError(data.error || 'Login failed.');
//                 return;
//             }

//             // Seed user into global context immediately so the home page
//             // renders the authenticated view on first paint — no flash.
//             setUser(data.user);
//             router.push('/');
//         } catch {
//             setError('Network error. Please try again.');
//         } finally {
//             setLoading(false);
//         }
//     };

//     return (
//         <>
//             <Head>
//                 <title>Log In — Demus</title>
//                 <meta name="description" content="Import Spotify playlists and stream for free" />
//                 <meta name="viewport" content="width=device-width, initial-scale=1" />
//                 <link rel="icon" href="/favicon.ico" />
//             </Head>
//             <div className={styles.page}>
//                 <div className={styles.card}>
//                     <div className={styles.logo}>
//                         <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor">
//                             <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
//                         </svg>
//                         <span className={styles.brand}>Demus</span>
//                     </div>
//                     <h1 className={styles.title}>Welcome back</h1>
//                     <p className={styles.subtitle}>Log in to your account</p>

//                     <form className={styles.form} onSubmit={handleSubmit}>
//                         {error && <div className={styles.error}>{error}</div>}

//                         <div className={styles.field}>
//                             <label className={styles.label} htmlFor="email">Email</label>
//                             <input
//                                 id="email"
//                                 className={styles.input}
//                                 type="email"
//                                 placeholder="you@example.com"
//                                 value={email}
//                                 onChange={(e) => setEmail(e.target.value)}
//                                 required
//                                 autoFocus
//                             />
//                         </div>

//                         <div className={styles.field}>
//                             <label className={styles.label} htmlFor="password">Password</label>
//                             <input
//                                 id="password"
//                                 className={styles.input}
//                                 type="password"
//                                 placeholder="Your password"
//                                 value={password}
//                                 onChange={(e) => setPassword(e.target.value)}
//                                 required
//                                 minLength={8}
//                             />
//                         </div>

//                         <button
//                             className={styles.button}
//                             type="submit"
//                             disabled={loading}
//                         >
//                             {loading ? 'Logging in…' : 'Log In'}
//                         </button>
//                     </form>

//                     <p className={styles.footer}>
//                         Don&apos;t have an account?{' '}
//                         <Link href="/signup">Sign up</Link>
//                     </p>
//                 </div>
//             </div>
//         </>
//     );
// }

// // Opt out of AppLayout — auth pages have their own standalone layout
// Login.getLayout = (page) => page;

// pages/login.js — Split-screen login with equalizer
import Head from 'next/head';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/router';
import { useAppContext } from '@/lib/AppContext';
import styles from '@/styles/Auth.module.scss';


export default function Login() {
    const router = useRouter();
    const { setUser } = useAppContext();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [focused, setFocused] = useState(null);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (password.length < 8) {
            setError('Password must be at least 8 characters.');
            return;
        }

        setLoading(true);

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });

            const data = await res.json();

            if (!res.ok) {
                setError(data.error || 'Login failed.');
                return;
            }
            router.push('/');
            setUser(data.user);
        } catch {
            setError('Network error. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <Head>
                <title>Log In — Demus</title>
                <meta name="description" content="Import Spotify playlists and stream for free" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <link rel="icon" href="/favicon.ico" />
            </Head>

            <div className={styles.page}>
                {/* ── LEFT: Brand showcase ──────────────────── */}
                <div className={styles.brandSide}>
                    <div className={styles.blob1} />
                    <div className={styles.blob2} />
                    <div className={styles.gridOverlay} />

                    <div className={styles.brandLogo}>
                        <Link href="/">demus</Link>
                    </div>

                    <div className={styles.brandCenter}>
                        <div className={styles.equalizer}>
                            {[60, 85, 45, 95, 70, 50, 80, 55, 90, 40, 75, 65].map((h, i) => (
                                <span
                                    key={i}
                                    className={styles.eqBar}
                                    style={{
                                        '--bar-height': `${h}%`,
                                        animationDelay: `${i * 0.12}s`,
                                    }}
                                />
                            ))}
                        </div>

                        <h1 className={styles.heroTitle}>
                            Your music.
                            <br />
                            <span className={styles.heroGradient}>No limits.</span>
                        </h1>

                        <p className={styles.heroSub}>
                            Import your Spotify playlists. Stream anything, anywhere. Completely free.
                        </p>
                    </div>

                    <div className={styles.stats}>
                        <div className={styles.stat}>
                            <span className={styles.statValue}>10K+</span>
                            <span className={styles.statLabel}>Tracks</span>
                        </div>
                        <div className={styles.stat}>
                            <span className={styles.statValue}>500+</span>
                            <span className={styles.statLabel}>Playlists imported</span>
                        </div>
                        <div className={styles.stat}>
                            <span className={styles.statValue}>Free</span>
                            <span className={styles.statLabel}>Forever</span>
                        </div>
                    </div>
                </div>

                {/* ── RIGHT: Login form ─────────────────────── */}
                <div className={styles.formSide}>
                    <div className={styles.formGlow} />

                    <div className={styles.formWrap}>
                        <div className={styles.mobileLogo}>demus</div>

                        <h2 className={styles.title}>Welcome back</h2>
                        <p className={styles.subtitle}>Enter your credentials to continue</p>

                        <form className={styles.form} onSubmit={handleSubmit}>
                            {error && <div className={styles.error}>{error}</div>}

                            <div className={styles.floatingField}>
                                <input
                                    id="email"
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    onFocus={() => setFocused('email')}
                                    onBlur={() => setFocused(null)}
                                    required
                                    autoFocus
                                    className={`${styles.floatingInput} ${focused === 'email' || email ? styles.hasValue : ''
                                        }`}
                                />
                                <label htmlFor="email" className={styles.floatingLabel}>
                                    Email address
                                </label>
                            </div>

                            <div className={styles.floatingField}>
                                <input
                                    id="password"
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    onFocus={() => setFocused('password')}
                                    onBlur={() => setFocused(null)}
                                    required
                                    minLength={8}
                                    className={`${styles.floatingInput} ${focused === 'password' || password ? styles.hasValue : ''
                                        }`}
                                />
                                <label htmlFor="password" className={styles.floatingLabel}>
                                    Password
                                </label>
                                <button
                                    type="button"
                                    className={styles.eyeToggle}
                                    onClick={() => setShowPassword(!showPassword)}
                                    tabIndex={-1}
                                >
                                    {showPassword ? (
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                                            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                                            <line x1="1" y1="1" x2="23" y2="23" />
                                        </svg>
                                    ) : (
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                            <circle cx="12" cy="12" r="3" />
                                        </svg>
                                    )}
                                </button>
                            </div>

                            <div className={styles.forgotRow}>
                                <button type="button" className={styles.forgotLink}>
                                    Forgot password?
                                </button>
                            </div>

                            <button
                                className={styles.button}
                                type="submit"
                                disabled={loading}
                            >
                                {loading ? 'Logging in…' : (
                                    <>
                                        Continue
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={styles.btnArrow}>
                                            <line x1="5" y1="12" x2="19" y2="12" />
                                            <polyline points="12 5 19 12 12 19" />
                                        </svg>
                                    </>
                                )}
                            </button>
                        </form>

                        <div className={styles.divider}>
                            <span>or</span>
                        </div>

                        <button className={styles.socialButton}>
                            <svg width="18" height="18" viewBox="0 0 24 24">
                                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                            </svg>
                            Continue with Google
                        </button>

                        <p className={styles.footer}>
                            New here?{' '}
                            <Link href="/signup">Create an account</Link>
                        </p>
                    </div>
                </div>
            </div>
        </>
    );
}

Login.getLayout = (page) => page;
