import { describe, it, expect } from 'vitest';
import { parseSubconverterExternalConfig } from '../src/subconverter/externalConfigParser.js';

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
