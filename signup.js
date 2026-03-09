import Head from 'next/head';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/router';
import { useAppContext } from '@/lib/AppContext';
import { Eye, EyeOff, ArrowRight } from 'lucide-react';
import styles from '@/styles/Auth.module.scss';

export default function Signup() {
    const router = useRouter();
    const { setUser } = useAppContext();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (password.length < 8) {
            setError('Password must be at least 8 characters.');
            return;
        }

        setLoading(true);

        try {
            const res = await fetch('/api/auth/signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });

            const data = await res.json();

            if (!res.ok) {
                setError(data.error || 'Signup failed.');
                return;
            }

            setUser(data.user);
            router.push('/');
        } catch {
            setError('Network error. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const eqBars = [60, 85, 45, 95, 70, 50, 80, 55, 90, 40, 75, 65];

    return (
        <>
            <Head>
                <title>Sign Up — Demus</title>
                <meta name="description" content="Import Spotify playlists and stream for free" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <link rel="icon" href="/favicon.ico" />
            </Head>

            <div className={styles.page}>
                {/* ── LEFT: Brand side ─────────────────────────── */}
                <div className={styles.brandSide}>
                    <div className={styles.blob1} />
                    <div className={styles.blob2} />
                    <div className={styles.gridOverlay} />

                    <div className={styles.brandLogo}>
                        <Link href="/">demus</Link>
                    </div>

                    <div className={styles.brandCenter}>
                        <div className={styles.equalizer}>
                            {eqBars.map((h, i) => (
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

                {/* ── RIGHT: Form side ─────────────────────────── */}
                <div className={styles.formSide}>
                    <div className={styles.formGlow} />

                    <div className={styles.formWrap}>
                        <div className={styles.mobileLogo}>demus</div>

                        <h2 className={styles.title}>Create your account</h2>
                        <p className={styles.subtitle}>Start importing your playlists</p>

                        <form className={styles.form} onSubmit={handleSubmit}>
                            {error && <div className={styles.error}>{error}</div>}

                            {/* Email */}
                            <div className={styles.floatingField}>
                                <input
                                    id="email"
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    autoFocus
                                    className={`${styles.floatingInput} ${email ? styles.hasValue : ''}`}
                                />
                                <label htmlFor="email" className={styles.floatingLabel}>
                                    Email address
                                </label>
                            </div>

                            {/* Password */}
                            <div className={styles.floatingField}>
                                <input
                                    id="password"
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    minLength={8}
                                    className={`${styles.floatingInput} ${password ? styles.hasValue : ''}`}
                                />
                                <label htmlFor="password" className={styles.floatingLabel}>
                                    Password
                                </label>
                                <button
                                    type="button"
                                    className={styles.eyeToggle}
                                    onClick={() => setShowPassword(!showPassword)}
                                >
                                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>

                            <button
                                type="submit"
                                className={styles.button}
                                disabled={loading}
                            >
                                {loading ? 'Creating account…' : (
                                    <>
                                        Sign Up
                                        <ArrowRight size={16} className={styles.btnArrow} />
                                    </>
                                )}
                            </button>
                        </form>

                        <div className={styles.divider}>
                            <span>or</span>
                        </div>

                        <button type="button" className={styles.socialButton}>
                            <svg width="18" height="18" viewBox="0 0 24 24">
                                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                            </svg>
                            Continue with Google
                        </button>

                        <p className={styles.footer}>
                            Already have an account?{' '}
                            <Link href="/login">Log in</Link>
                        </p>
                    </div>
                </div>
            </div>
        </>
    );
}

Signup.getLayout = (page) => page;
