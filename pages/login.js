import Head from 'next/head';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/router';
import styles from '@/styles/Auth.module.scss';

export default function Login() {
    const router = useRouter();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
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
            </Head>
            <div className={styles.page}>
                <div className={styles.card}>
                    <div className={styles.logo}>
                        <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor">
                            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                        </svg>
                        <span className={styles.brand}>Demus</span>
                    </div>
                    <h1 className={styles.title}>Welcome back</h1>
                    <p className={styles.subtitle}>Log in to your account</p>

                    <form className={styles.form} onSubmit={handleSubmit}>
                        {error && <div className={styles.error}>{error}</div>}

                        <div className={styles.field}>
                            <label className={styles.label} htmlFor="email">Email</label>
                            <input
                                id="email"
                                className={styles.input}
                                type="email"
                                placeholder="you@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                autoFocus
                            />
                        </div>

                        <div className={styles.field}>
                            <label className={styles.label} htmlFor="password">Password</label>
                            <input
                                id="password"
                                className={styles.input}
                                type="password"
                                placeholder="Your password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                minLength={8}
                            />
                        </div>

                        <button
                            className={styles.button}
                            type="submit"
                            disabled={loading}
                        >
                            {loading ? 'Logging in…' : 'Log In'}
                        </button>
                    </form>

                    <p className={styles.footer}>
                        Don&apos;t have an account?{' '}
                        <Link href="/signup">Sign up</Link>
                    </p>
                </div>
            </div>
        </>
    );
}
