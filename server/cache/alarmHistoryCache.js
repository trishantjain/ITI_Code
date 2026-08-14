const alarmHistoryCache = new Map();

const CACHE_TIMEOUT = 60 * 60 * 1000; // 30 minutes

function get(key) {
    const item = alarmHistoryCache.get(key);

    if (!item) return null;

    item.lastAccess = Date.now();

    return item;
}

function set(key, entries, filePath) {
    alarmHistoryCache.set(key, {
        entries,
        filePath,
        total: entries.length,
        createdAt: Date.now(),
        lastAccess: Date.now()
    });
}

function remove(key) {
    alarmHistoryCache.delete(key);
}

function cleanup() {
    const now = Date.now();

    for (const [key, value] of alarmHistoryCache.entries()) {
        if (now - value.lastAccess > CACHE_TIMEOUT) {
            console.log("Removing expired cache:", key);
            alarmHistoryCache.delete(key);
        }
    }
}

// cleanup every 10 minutes
setInterval(cleanup, 10 * 60 * 1000);

module.exports = {
    get,
    set,
    remove
};

