const INLINE_PREFIX = '[]';

function sanitizeOutboundName(outbound) {
    // Strip emoji and leading/trailing whitespace, replace spaces with underscores
    const cleaned = outbound
        .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\u200d\uFE0F]/gu, '')
        .replace(/\s+/g, '_')
        .replace(/^_|_$/g, '');
    return cleaned || 'rule';
}

function sanitizeProviderName(outbound, usedNames) {
    const base = `规则集_${sanitizeOutboundName(outbound)}`;
    if (!usedNames.has(base)) {
        usedNames.add(base);
        return base;
    }
    let i = 2;
    while (usedNames.has(`${base}_${i}`)) i++;
    const name = `${base}_${i}`;
    usedNames.add(name);
    return name;
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
    const usedNames = new Set();

    parsedConfig.rulesets.forEach(({ outbound, source }) => {
        if (source.startsWith(INLINE_PREFIX)) {
            const rule = convertInlineRule(source, outbound);
            if (rule) rules.push(rule);
            return;
        }

        if (/^https?:\/\//i.test(source)) {
            const providerName = sanitizeProviderName(outbound, usedNames);
            ruleProviders[providerName] = {
                type: 'http',
                behavior: 'classical',
                format: 'text',
                url: source,
                path: `./ruleset/${providerName}.yaml`,
                interval: 86400
            };
            rules.push(`RULE-SET,${providerName},${outbound}`);
        }
    });

    return { ruleProviders, rules };
}

export function buildClashExternalProxyGroups(parsedConfig, proxyNames = [], providerNames = []) {
    return parsedConfig.proxyGroups.map(group => {
        const isAutoType = group.type === 'url-test' || group.type === 'fallback' || group.type === 'load-balance';
        const matchToken = group.tokens[0];

        if (isAutoType) {
            const healthCheck = parseHealthCheckOptions(group.tokens.slice(1));
            const clashGroup = {
                name: group.name,
                type: group.type,
                ...healthCheck
            };
            if (proxyNames.length > 0) {
                clashGroup.proxies = [...proxyNames];
            }
            if (providerNames.length > 0) {
                clashGroup.use = [...providerNames];
            }
            if (matchToken && matchToken !== '.*') {
                clashGroup.filter = matchToken;
            }
            return clashGroup;
        }

        // select groups: collect explicit [] refs and .* expansions
        const proxies = [];
        group.tokens.forEach(token => appendProxyToken(proxies, token, proxyNames));

        // If no proxies resolved (e.g. all tokens are regex patterns), fall back to full list
        if (proxies.length === 0) {
            proxies.push(...proxyNames);
        }

        const result = {
            name: group.name,
            type: group.type,
            proxies
        };
        if (providerNames.length > 0) {
            result.use = [...providerNames];
        }

        // Attach filter for regex match tokens (not .* and not [] refs)
        if (matchToken && matchToken !== '.*' && !matchToken.startsWith(INLINE_PREFIX)) {
            result.filter = matchToken;
        }

        return result;
    });
}
