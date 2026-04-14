/**
 * Server-only admin identity utilities.
 *
 * IMPORTANT: This file must only be imported from server-side code (API routes,
 * getServerSideProps). Never import it in client-side components or pages that
 * are included in the client bundle.
 *
 * Admin identity is determined exclusively by the ADMIN_EMAIL environment
 * variable. The value is normalized via trim().toLowerCase() before comparison
 * to prevent whitespace or casing mismatches.
 *
 * If ADMIN_EMAIL is not configured, all admin access is denied and a warning
 * is emitted once to the server log.
 */

let _missingConfigWarned = false;

/**
 * Normalize an email address for comparison: trim whitespace and lowercase.
 *
 * @param {string} email
 * @returns {string} Normalized email
 */
export function normalizeEmail(email) {
    if (typeof email !== 'string') return '';
    return email.trim().toLowerCase();
}

/**
 * Check whether a given email matches the configured ADMIN_EMAIL.
 *
 * Returns false (fail-closed) when:
 * - ADMIN_EMAIL is not set in the environment
 * - The provided email is falsy or not a string
 * - The normalized emails do not match
 *
 * Emits a one-time server warning when ADMIN_EMAIL is missing so the operator
 * can identify misconfiguration without flooding logs.
 *
 * @param {string} email - Email address to check (typically from req.user.email)
 * @returns {boolean}
 */
export function isAdminEmail(email) {
    const configuredEmail = process.env.ADMIN_EMAIL;

    if (!configuredEmail) {
        if (!_missingConfigWarned) {
            console.warn(
                '[adminAccess] WARNING: ADMIN_EMAIL is not configured. ' +
                'All admin access will be denied until ADMIN_EMAIL is set.'
            );
            _missingConfigWarned = true;
        }
        return false;
    }

    if (!email) return false;

    return normalizeEmail(email) === normalizeEmail(configuredEmail);
}
