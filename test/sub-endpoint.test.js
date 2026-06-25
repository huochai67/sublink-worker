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
                proxies: ['香港 01', '日本 01'],
                filter: '(港|HK)',
                url: 'http://www.gstatic.com/generate_204',
                interval: 300,
                tolerance: 50
            }
        ]);
    });

    it('select group with regex token gets proxies and filter', () => {
        const groups = buildClashExternalProxyGroups({
            rulesets: [],
            proxyGroups: [
                { name: '🎥 奈飞节点', type: 'select', tokens: ['(NF|Netflix)'] }
            ],
            flags: {}
        }, ['香港 01', '日本 01', '美国 NF']);

        expect(groups).toEqual([
            {
                name: '🎥 奈飞节点',
                type: 'select',
                proxies: ['香港 01', '日本 01', '美国 NF'],
                filter: '(NF|Netflix)'
            }
        ]);
    });

    it('uses proxy-providers when there are no inline proxies', () => {
        const groups = buildClashExternalProxyGroups({
            rulesets: [],
            proxyGroups: [
                { name: '♻️ 自动选择', type: 'url-test', tokens: ['.*', 'http://www.gstatic.com/generate_204', '300,,50'] },
                { name: '🚀 节点选择', type: 'select', tokens: ['[]♻️ 自动选择', '[]DIRECT'] }
            ],
            flags: {}
        }, [], ['provider-a']);

        expect(groups).toEqual([
            {
                name: '♻️ 自动选择',
                type: 'url-test',
                use: ['provider-a'],
                url: 'http://www.gstatic.com/generate_204',
                interval: 300,
                tolerance: 50
            },
            {
                name: '🚀 节点选择',
                type: 'select',
                proxies: ['♻️ 自动选择', 'DIRECT'],
                use: ['provider-a']
            }
        ]);
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
            '规则集_节点选择': {
                type: 'http',
                behavior: 'classical',
                format: 'text',
                url: 'https://example.com/Proxy.list',
                path: './ruleset/规则集_节点选择.yaml',
                interval: 86400
            }
        });
        expect(result.rules).toEqual([
            'RULE-SET,规则集_节点选择,🚀 节点选择',
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

    it('supports surge target', async () => {
        const app = createTestApp();
        const res = await app.request(`http://localhost/sub?target=surge&url=${encodeURIComponent(ssNode)}`);
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('[General]');
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
        expect(text).toContain('规则集_全球直连:');
        expect(text).toContain('RULE-SET,规则集_全球直连,🎯 全球直连');
        expect(text).toContain('GEOIP,CN,🎯 全球直连');
        expect(text).toContain('MATCH,🐟 漏网之鱼');
        expect(text).toContain('name: 🚀 节点选择');
        expect(text).toContain('name: 🇭🇰 香港节点');
        expect(text).toContain('filter: (港|HK|Hong Kong)');
    });

    it('clash target with external config includes proxies in url-test groups', async () => {
        const externalConfig = `[custom]
custom_proxy_group=🇭🇰 香港节点\`url-test\`(港|HK)\`http://www.gstatic.com/generate_204\`300,,50
custom_proxy_group=🚀 节点选择\`select\`[]🇭🇰 香港节点\`[]DIRECT
enable_rule_generator=true
overwrite_original_rules=true`;

        vi.stubGlobal('fetch', vi.fn(async (url) => {
            if (String(url) === 'https://example.com/config.ini') {
                return { ok: true, status: 200, text: async () => externalConfig };
            }
            throw new Error(`Unexpected fetch: ${url}`);
        }));

        const app = createTestApp();
        const res = await app.request(`http://localhost/sub?target=clash&url=${encodeURIComponent(ssNode)}&config=${encodeURIComponent('https://example.com/config.ini')}`);
        expect(res.status).toBe(200);
        const text = await res.text();
        const hkGroupMatch = text.match(/name: 🇭🇰 香港节点[\s\S]*?(?=\n  - name:|\nrules:)/);
        expect(hkGroupMatch).toBeTruthy();
        expect(hkGroupMatch[0]).toContain('proxies:');
        expect(hkGroupMatch[0]).toContain('filter: (港|HK)');
    });

    it('clash target with external config inlines upstream clash nodes', async () => {
        const externalConfig = `[custom]
custom_proxy_group=♻️ 自动选择\`url-test\`.*\`http://www.gstatic.com/generate_204\`300,,50
custom_proxy_group=🚀 节点选择\`select\`[]♻️ 自动选择\`[]DIRECT
enable_rule_generator=true
overwrite_original_rules=true`;
        const upstreamClash = `dns:
  nameserver-policy:
    rule-set:Direct,ChinaMedia,China:
      - https://doh.pub/dns-query
  fake-ip-filter:
    - rule-set:FakeIpFilter
proxies:
  - name: HK-Node
    type: ss
    server: hk.example.com
    port: 443
    cipher: aes-128-gcm
    password: test123`;

        vi.stubGlobal('fetch', vi.fn(async (url) => {
            if (String(url) === 'https://example.com/ACL4SSR_Online_Full.ini') {
                return { ok: true, status: 200, text: async () => externalConfig };
            }
            if (String(url) === 'https://example.com/upstream-clash.yaml') {
                return {
                    ok: true,
                    status: 200,
                    text: async () => upstreamClash,
                    headers: new Headers()
                };
            }
            throw new Error(`Unexpected fetch: ${url}`);
        }));

        const app = createTestApp();
        const res = await app.request(`http://localhost/sub?target=clash&url=${encodeURIComponent('https://example.com/upstream-clash.yaml')}&config=${encodeURIComponent('https://example.com/ACL4SSR_Online_Full.ini')}`);
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('proxies:');
        expect(text).toContain('name: HK-Node');
        expect(text).toContain('name: ♻️ 自动选择');
        expect(text).not.toContain('proxy-providers:');
        expect(text).not.toContain('rule-set:Direct');
        expect(text).not.toContain('rule-set:FakeIpFilter');
    });

    it('clash target with external config supports pipe-separated upstream sources', async () => {
        const externalConfig = `[custom]
custom_proxy_group=♻️ 自动选择\`url-test\`.*\`http://www.gstatic.com/generate_204\`300,,50
custom_proxy_group=🚀 节点选择\`select\`[]♻️ 自动选择\`[]DIRECT
enable_rule_generator=true
overwrite_original_rules=true`;
        const upstreamSingbox = JSON.stringify({
            outbounds: [
                {
                    type: 'shadowsocks',
                    tag: 'SG-Node',
                    server: 'sg.example.com',
                    server_port: 443,
                    method: 'aes-128-gcm',
                    password: 'test123'
                }
            ]
        });
        const upstreamUriList = 'ss://YWVzLTEyOC1nY206cGFzc3dvcmRAMTI3LjAuMC4xOjgzODg=#HK-Node';

        vi.stubGlobal('fetch', vi.fn(async (url) => {
            if (String(url) === 'https://example.com/ACL4SSR_Online_Full.ini') {
                return { ok: true, status: 200, text: async () => externalConfig };
            }
            if (String(url) === 'https://example.com/upstream-singbox.json') {
                return {
                    ok: true,
                    status: 200,
                    text: async () => upstreamSingbox,
                    headers: new Headers()
                };
            }
            if (String(url) === 'https://example.com/rawv2b64') {
                return {
                    ok: true,
                    status: 200,
                    text: async () => upstreamUriList,
                    headers: new Headers()
                };
            }
            throw new Error(`Unexpected fetch: ${url}`);
        }));

        const app = createTestApp();
        const mixedSources = 'https://example.com/upstream-singbox.json|https://example.com/rawv2b64';
        const res = await app.request(`http://localhost/sub?target=clash&url=${encodeURIComponent(mixedSources)}&config=${encodeURIComponent('https://example.com/ACL4SSR_Online_Full.ini')}`);
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('name: SG-Node');
        expect(text).toContain('name: HK-Node');
        expect(text).toContain('name: ♻️ 自动选择');
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

describe('GET /sub with include/exclude filters', () => {
    const multiNodeInput = [
        'ss://YWVzLTEyOC1nY206cGFzc3dvcmRAMTI3LjAuMC4xOjgzODg=#香港 01',
        'ss://YWVzLTEyOC1nY206cGFzc3dvcmRAMTI0LjAuMC4xOjgzODg=#日本 01',
        'ss://YWVzLTEyOC1nY206cGFzc3dvcmRAMTI1LjAuMC4xOjgzODg=#美国 01'
    ].join('\n');

    it('include filter only keeps matching nodes', async () => {
        const app = createTestApp();
        const res = await app.request(`http://localhost/sub?target=clash&url=${encodeURIComponent(multiNodeInput)}&include=${encodeURIComponent('香港|日本')}`);
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('香港 01');
        expect(text).toContain('日本 01');
        expect(text).not.toContain('美国 01');
    });

    it('exclude filter removes matching nodes', async () => {
        const app = createTestApp();
        const res = await app.request(`http://localhost/sub?target=clash&url=${encodeURIComponent(multiNodeInput)}&exclude=${encodeURIComponent('美国')}`);
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('香港 01');
        expect(text).toContain('日本 01');
        expect(text).not.toContain('美国 01');
    });

    it('include and exclude filters work together', async () => {
        const app = createTestApp();
        const res = await app.request(`http://localhost/sub?target=clash&url=${encodeURIComponent(multiNodeInput)}&include=${encodeURIComponent('香港|日本|美国')}&exclude=${encodeURIComponent('日本')}`);
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('香港 01');
        expect(text).not.toContain('日本 01');
        expect(text).toContain('美国 01');
    });

    it('returns 400 for invalid include regex', async () => {
        const app = createTestApp();
        const res = await app.request(`http://localhost/sub?target=clash&url=${encodeURIComponent(multiNodeInput)}&include=${encodeURIComponent('[invalid')}`);
        expect(res.status).toBe(400);
        expect(await res.text()).toContain('Invalid include regex pattern');
    });

    it('returns 400 for invalid exclude regex', async () => {
        const app = createTestApp();
        const res = await app.request(`http://localhost/sub?target=clash&url=${encodeURIComponent(multiNodeInput)}&exclude=${encodeURIComponent('[invalid')}`);
        expect(res.status).toBe(400);
        expect(await res.text()).toContain('Invalid exclude regex pattern');
    });

    it('include filter works with singbox target', async () => {
        const app = createTestApp();
        const res = await app.request(`http://localhost/sub?target=singbox&url=${encodeURIComponent(multiNodeInput)}&include=${encodeURIComponent('香港')}`);
        expect(res.status).toBe(200);
        const json = await res.json();
        const outbounds = json.outbounds || [];
        const proxyOutbound = outbounds.find(o => o.tag === 'proxy' || o.type === 'direct');
        // Check that only Hong Kong node is present in outbounds
        const allOutboundTags = outbounds.flatMap(o => o.outbounds || []).flat();
        expect(allOutboundTags).toContain('香港 01');
        expect(allOutboundTags).not.toContain('日本 01');
        expect(allOutboundTags).not.toContain('美国 01');
    });

    it('exclude filter works with surge target', async () => {
        const app = createTestApp();
        const res = await app.request(`http://localhost/sub?target=surge&url=${encodeURIComponent(multiNodeInput)}&exclude=${encodeURIComponent('美国')}`);
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('香港 01');
        expect(text).toContain('日本 01');
        expect(text).not.toContain('美国 01');
    });
});

describe('GET /sub with filename parameter', () => {
    const ssNode = 'ss://YWVzLTEyOC1nY206cGFzc3dvcmRAMTI3LjAuMC4xOjgzODg=#香港 01';

    it('sets Content-Disposition header for clash target', async () => {
        const app = createTestApp();
        const res = await app.request(`http://localhost/sub?target=clash&url=${encodeURIComponent(ssNode)}&filename=MyConfig`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-disposition')).toBe('attachment; filename="MyConfig.yaml"');
    });

    it('sets Content-Disposition header for singbox target', async () => {
        const app = createTestApp();
        const res = await app.request(`http://localhost/sub?target=singbox&url=${encodeURIComponent(ssNode)}&filename=MyConfig`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-disposition')).toBe('attachment; filename="MyConfig.json"');
    });

    it('sets Content-Disposition header for surge target', async () => {
        const app = createTestApp();
        const res = await app.request(`http://localhost/sub?target=surge&url=${encodeURIComponent(ssNode)}&filename=MyConfig`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-disposition')).toBe('attachment; filename="MyConfig.conf"');
    });

    it('sets Content-Disposition header for v2ray target', async () => {
        const app = createTestApp();
        const res = await app.request(`http://localhost/sub?target=v2ray&url=${encodeURIComponent(ssNode)}&filename=MyConfig`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-disposition')).toBe('attachment; filename="MyConfig.txt"');
    });

    it('does not set Content-Disposition when filename is not provided', async () => {
        const app = createTestApp();
        const res = await app.request(`http://localhost/sub?target=clash&url=${encodeURIComponent(ssNode)}`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-disposition')).toBeNull();
    });
});
