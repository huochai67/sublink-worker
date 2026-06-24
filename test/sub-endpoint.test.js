import { afterEach, describe, it, expect, vi } from 'vitest';
import { parseSubconverterExternalConfig } from '../src/subconverter/externalConfigParser.js';
import { buildClashExternalRules, buildClashExternalProxyGroups } from '../src/subconverter/clashExternalConfig.js';
import { createApp } from '../src/app/createApp.jsx';
import { MemoryKVAdapter } from '../src/adapters/kv/memoryKv.js';

describe('parseSubconverterExternalConfig', () => {
    it('parses rulesets, proxy groups, and flags from a custom section', () => {
        const parsed = parseSubconverterExternalConfig(`
; ignored header comment
[custom]
ruleset=🎯 全球直连,[]GEOIP,CN
ruleset=🐟 漏网之鱼,[]FINAL
ruleset=🚀 节点选择,https://example.com/Proxy.list
custom_proxy_group=🚀 节点选择\`select\`[]♻️ 自动选择\`[]DIRECT\`.*
custom_proxy_group=♻️ 自动选择\`url-test\`.*\`http://www.gstatic.com/generate_204\`300,,50
enable_rule_generator=true
overwrite_original_rules=true

[other]
ruleset=ignored,[]FINAL
`);

        expect(parsed.rulesets).toEqual([
            { outbound: '🎯 全球直连', source: '[]GEOIP,CN' },
            { outbound: '🐟 漏网之鱼', source: '[]FINAL' },
            { outbound: '🚀 节点选择', source: 'https://example.com/Proxy.list' }
        ]);
        expect(parsed.proxyGroups).toEqual([
            { name: '🚀 节点选择', type: 'select', tokens: ['[]♻️ 自动选择', '[]DIRECT', '.*'] },
            { name: '♻️ 自动选择', type: 'url-test', tokens: ['.*', 'http://www.gstatic.com/generate_204', '300,,50'] }
        ]);
        expect(parsed.flags).toEqual({
            enableRuleGenerator: true,
            overwriteOriginalRules: true
    });
});

describe('buildClashExternalProxyGroups', () => {
    it('converts select and url-test groups from external config', () => {
        const groups = buildClashExternalProxyGroups({
            rulesets: [],
            proxyGroups: [
                { name: '🚀 节点选择', type: 'select', tokens: ['[]♻️ 自动选择', '[]DIRECT', '.*'] },
                { name: '♻️ 自动选择', type: 'url-test', tokens: ['.*', 'http://www.gstatic.com/generate_204', '300,,50'] },
                { name: '🇭🇰 香港节点', type: 'url-test', tokens: ['(港|HK)', 'http://www.gstatic.com/generate_204', '300,,50'] }
            ],
            flags: {}
        }, ['香港 01', '日本 01']);

        expect(groups).toEqual([
            {
                name: '🚀 节点选择',
                type: 'select',
                proxies: ['♻️ 自动选择', 'DIRECT', '香港 01', '日本 01']
            },
            {
                name: '♻️ 自动选择',
                type: 'url-test',
                proxies: ['香港 01', '日本 01'],
                url: 'http://www.gstatic.com/generate_204',
                interval: 300,
                tolerance: 50
            },
            {
                name: '🇭🇰 香港节点',
                type: 'url-test',
                filter: '(港|HK)',
                url: 'http://www.gstatic.com/generate_204',
                interval: 300,
                tolerance: 50
            }
        ]);
    });
});
});

describe('buildClashExternalRules', () => {
    it('converts remote rulesets to rule providers and inline rules to Clash rules', () => {
        const result = buildClashExternalRules({
            rulesets: [
                { outbound: '🚀 节点选择', source: 'https://example.com/Proxy.list' },
                { outbound: '🎯 全球直连', source: '[]GEOIP,CN' },
                { outbound: '🐟 漏网之鱼', source: '[]FINAL' }
            ],
            proxyGroups: [],
            flags: {}
        });

        expect(result.ruleProviders).toEqual({
            subconverter_0: {
                type: 'http',
                behavior: 'classical',
                url: 'https://example.com/Proxy.list',
                path: './ruleset/subconverter_0.yaml',
                interval: 86400
            }
        });
        expect(result.rules).toEqual([
            'RULE-SET,subconverter_0,🚀 节点选择',
            'GEOIP,CN,🎯 全球直连',
            'MATCH,🐟 漏网之鱼'
        ]);
    });
});

const createTestApp = (overrides = {}) => createApp({
    kv: overrides.kv ?? new MemoryKVAdapter(),
    assetFetcher: overrides.assetFetcher ?? null,
    logger: console,
    config: {
        configTtlSeconds: 60,
        shortLinkTtlSeconds: null,
        ...(overrides.config || {})
    }
});

const ssNode = 'ss://YWVzLTEyOC1nY206cGFzc3dvcmRAMTI3LjAuMC4xOjgzODg=#香港 01';

describe('GET /sub compatibility endpoint', () => {
    it('defaults to Clash output when target is omitted', async () => {
        const app = createTestApp();
        const res = await app.request(`http://localhost/sub?url=${encodeURIComponent(ssNode)}`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/yaml');
        const text = await res.text();
        expect(text).toContain('proxies:');
    });

    it('supports mihomo as a Clash alias', async () => {
        const app = createTestApp();
        const res = await app.request(`http://localhost/sub?target=mihomo&url=${encodeURIComponent(ssNode)}`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/yaml');
    });

    it('supports singbox target', async () => {
        const app = createTestApp();
        const res = await app.request(`http://localhost/sub?target=singbox&url=${encodeURIComponent(ssNode)}`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('application/json');
        const json = await res.json();
        expect(json.outbounds).toBeDefined();
    });

    it('supports v2ray target as base64 node list', async () => {
        const app = createTestApp();
        const res = await app.request(`http://localhost/sub?target=v2ray&url=${encodeURIComponent(ssNode)}`);
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toMatch(/^[A-Za-z0-9+/=]+$/);
    });

    it('returns 400 when url is missing', async () => {
        const app = createTestApp();
        const res = await app.request('http://localhost/sub?target=clash');
        expect(res.status).toBe(400);
        expect(await res.text()).toContain('Missing url parameter');
    });

    it('returns 400 for unsupported target', async () => {
        const app = createTestApp();
        const res = await app.request(`http://localhost/sub?target=unknown&url=${encodeURIComponent(ssNode)}`);
        expect(res.status).toBe(400);
        expect(await res.text()).toContain('Unsupported target');
    });
});

describe('GET /sub with ACL4SSR-style external config', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('generates rule providers, inline rules, and ACL4SSR proxy groups', async () => {
        const externalConfig = `[custom]
ruleset=🎯 全球直连,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/LocalAreaNetwork.list
ruleset=🎯 全球直连,[]GEOIP,CN
ruleset=🐟 漏网之鱼,[]FINAL
custom_proxy_group=🚀 节点选择\`select\`[]♻️ 自动选择\`[]🇭🇰 香港节点\`[]DIRECT
custom_proxy_group=♻️ 自动选择\`url-test\`.*\`http://www.gstatic.com/generate_204\`300,,50
custom_proxy_group=🇭🇰 香港节点\`url-test\`(港|HK|Hong Kong)\`http://www.gstatic.com/generate_204\`300,,50
enable_rule_generator=true
overwrite_original_rules=true`;

        vi.stubGlobal('fetch', vi.fn(async (url) => {
            if (String(url) === 'https://example.com/ACL4SSR_Online_Full.ini') {
                return { ok: true, status: 200, text: async () => externalConfig };
            }
            throw new Error(`Unexpected fetch: ${url}`);
        }));

        const app = createTestApp();
        const res = await app.request(`http://localhost/sub?target=mihomo&url=${encodeURIComponent(ssNode)}&config=${encodeURIComponent('https://example.com/ACL4SSR_Online_Full.ini')}`);
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('rule-providers:');
        expect(text).toContain('subconverter_0:');
        expect(text).toContain('RULE-SET,subconverter_0,🎯 全球直连');
        expect(text).toContain('GEOIP,CN,🎯 全球直连');
        expect(text).toContain('MATCH,🐟 漏网之鱼');
        expect(text).toContain('name: 🚀 节点选择');
        expect(text).toContain('name: 🇭🇰 香港节点');
        expect(text).toContain('filter: (港|HK|Hong Kong)');
    });

    it('returns 400 when external config cannot be fetched', async () => {
        vi.stubGlobal('fetch', vi.fn(async (url) => {
            if (String(url) === 'https://example.com/missing.ini') {
                return { ok: false, status: 404, text: async () => 'not found' };
            }
            throw new Error(`Unexpected fetch: ${url}`);
        }));

        const app = createTestApp();
        const res = await app.request(`http://localhost/sub?target=clash&url=${encodeURIComponent(ssNode)}&config=${encodeURIComponent('https://example.com/missing.ini')}`);
        expect(res.status).toBe(400);
        expect(await res.text()).toContain('Failed to fetch external config');
    });
});
