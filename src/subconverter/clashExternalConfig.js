const INLINE_PREFIX = '[]';

function sanitizeProviderName(index) {
    return `subconverter_${index}`;
}

function convertInlineRule(source, outbound) {
    const rule = source.slice(INLINE_PREFIX.length).trim();
    if (!rule) return null;
    if (rule === 'FINAL') return `MATCH,${outbound}`;
    return `${rule},${outbound}`;
}

export function buildClashExternalRules(parsedConfig) {
    const ruleProviders = {};
    const rules = [];
    let providerIndex = 0;

    parsedConfig.rulesets.forEach(({ outbound, source }) => {
        if (source.startsWith(INLINE_PREFIX)) {
            const rule = convertInlineRule(source, outbound);
            if (rule) rules.push(rule);
            return;
        }

        if (/^https?:\/\//i.test(source)) {
            const providerName = sanitizeProviderName(providerIndex++);
            ruleProviders[providerName] = {
                type: 'http',
                behavior: 'classical',
                url: source,
                path: `./ruleset/${providerName}.yaml`,
                interval: 86400
            };
            rules.push(`RULE-SET,${providerName},${outbound}`);
        }
    });

    return { ruleProviders, rules };
}
