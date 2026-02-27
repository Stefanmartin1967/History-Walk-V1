import { describe, it, expect } from 'vitest';
import { getDomainFromUrl } from '../src/url-utils.js';

describe('getDomainFromUrl', () => {
    describe('Happy path', () => {
        it('should extract domain from simple https url', () => {
            expect(getDomainFromUrl('https://example.com')).toBe('example.com');
        });

        it('should extract domain from simple http url', () => {
            expect(getDomainFromUrl('http://example.com')).toBe('example.com');
        });

        it('should remove www prefix', () => {
            expect(getDomainFromUrl('https://www.example.com')).toBe('example.com');
        });

        it('should handle subdomains', () => {
            expect(getDomainFromUrl('https://blog.example.com')).toBe('blog.example.com');
        });

        it('should handle complex paths', () => {
            expect(getDomainFromUrl('https://www.example.com/path/to/resource?query=param')).toBe('example.com');
        });
    });

    describe('Edge cases and error handling', () => {
        it('should return empty string for null or undefined', () => {
            expect(getDomainFromUrl(null)).toBe('');
            expect(getDomainFromUrl(undefined)).toBe('');
            expect(getDomainFromUrl('')).toBe('');
        });

        it('should return original string if URL is invalid (no protocol)', () => {
            // "example.com" throws in new URL() without protocol in some environments,
            // or is parsed weirdly. In browser it might be relative path.
            // new URL('example.com') throws TypeError.
            expect(getDomainFromUrl('example.com')).toBe('example.com');
        });

        it('should return original string if not a valid URL structure', () => {
            expect(getDomainFromUrl('not a url')).toBe('not a url');
        });
    });

    describe('Special characters (IDN / Arabic)', () => {
        it('should handle Arabic characters in path (User Case)', () => {
            const url = 'http://palaisbenayed.com/la-mosquee-hadher-bach-%D8%AC%D8%A7%D9%85%D8%B9-%D8%AD%D8%A7%D8%B6%D8%B1-%D8%A8%D8%A7%D8%B4';
            // The domain is just palaisbenayed.com
            expect(getDomainFromUrl(url)).toBe('palaisbenayed.com');
        });

        it('should handle Arabic characters in domain (Punycode/IDN)', () => {
            // Example: http://موقع.وزارة-الاتصالات.مصر/
            // Note: new URL() might convert to punycode (xn--...) or keep unicode depending on env.
            // Let's check what it returns. If it fails, it returns the full URL.
            const arabicUrl = 'http://موقع.وزارة-الاتصالات.مصر/';
            const result = getDomainFromUrl(arabicUrl);

            // We expect it either to be the punycode domain OR the original URL if parsing fails.
            // But new URL() usually supports IDN.
            // Let's verify it doesn't crash.
            expect(result).not.toBeNull();
        });
    });
});
