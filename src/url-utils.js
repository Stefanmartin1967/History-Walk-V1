export function getDomainFromUrl(url) {
    if (!url) return '';
    try {
        const hostname = new URL(url).hostname;
        return hostname.replace(/^www\./, '');
    } catch (e) {
        return url;
    }
}
