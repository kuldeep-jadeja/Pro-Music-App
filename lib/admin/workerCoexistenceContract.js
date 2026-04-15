'use strict';

const WORKER_TARGETS = [
    'metadataWorker',
    'artistCrawler',
    'chartsWorker',
    'ytMatchWorker',
    'artistExpandWorker',
];

const QUEUE_KEYS = {
    artistExpand: 'demus:artist-expand:queue',
    ytMatch: 'demus:ytmatch:queue',
    metadata: 'demus:metadata:queue',
};

const CORE_FLOW_ENDPOINTS = [
    '/api/import-playlist',
    '/api/playlists',
    '/api/playlist/[id]/status',
    '/api/admin/enqueue-artists',
    '/api/admin/retry-jobs',
];

const BLOCKING_REGRESSION_CODES = [
    'workers_not_consuming',
    'playlist_flow_stalled',
    'worker_crash_loop',
    'queue_isolation_breach',
];

module.exports = {
    WORKER_TARGETS,
    QUEUE_KEYS,
    CORE_FLOW_ENDPOINTS,
    BLOCKING_REGRESSION_CODES,
};
