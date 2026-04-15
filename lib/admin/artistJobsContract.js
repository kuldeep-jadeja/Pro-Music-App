export const JOB_STATUS_OPTIONS = ['all', 'queued', 'running', 'done', 'failed', 'do_not_expand'];

export const DEFAULT_STATUS_FILTER = 'all';
export const DEFAULT_QUERY = '';
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

export function isValidJobStatusFilter(status) {
    return JOB_STATUS_OPTIONS.includes(status);
}
