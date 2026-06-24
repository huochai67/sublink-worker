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

function parseHealthCheckOptions(tokens) {
    const url = tokens.find(token => /^https?:\/\//i.test(token)) || 'http://www.gstatic.com/generate_204';
    const optionsToken = tokens.find(token => /^\d+/.test(token));
    const [intervalRaw, , toleranceRaw] = optionsToken ? optionsToken.split(',') : [];
    const interval = Number(intervalRaw) || 300;
    const tolerance = Number(toleranceRaw) || 50;
    return { url, interval, tolerance };
}

function appendProxyToken(proxies, token, proxyNames) {
    if (token === '.*') {
        proxies.push(...proxyNames);
        return;
    }
    if (token.startsWith(INLINE_PREFIX)) {
        const name = token.slice(INLINE_PREFIX.length).trim();
        if (name) proxies.push(name);
    }
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

export function buildClashExternalProxyGroups(parsedConfig, proxyNames = []) {
    return parsedConfig.proxyGroups.map(group => {
        if (group.type === 'url-test' || group.type === 'fallback' || group.type === 'load-balance') {
            const matchToken = group.tokens[0];
            const healthCheck = parseHealthCheckOptions(group.tokens.slice(1));
            const clashGroup = {
                name: group.name,
                type: group.type,
                ...healthCheck
            };
            if (matchToken === '.*') {
                clashGroup.proxies = [...proxyNames];
            } else if (matchToken) {
                clashGroup.filter = matchToken;
            }
            return clashGroup;
        }

        const proxies = [];
        group.tokens.forEach(token => appendProxyToken(proxies, token, proxyNames));
        return {
            name: group.name,
            type: group.type,
            proxies
        };
    });
}
