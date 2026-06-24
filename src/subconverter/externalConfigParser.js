const parseBoolean = (value) => String(value).trim().toLowerCase() === 'true';

export function parseSubconverterExternalConfig(content = '') {
    const rulesets = [];
    const proxyGroups = [];
    const flags = {
        enableRuleGenerator: false,
        overwriteOriginalRules: false
    };
    let inCustomSection = false;

    String(content).split(/\r?\n/).forEach(rawLine => {
        const line = rawLine.trim();
        if (!line || line.startsWith(';') || line.startsWith('#')) return;

        const sectionMatch = line.match(/^\[([^\]]+)]$/);
        if (sectionMatch) {
            inCustomSection = sectionMatch[1].trim().toLowerCase() === 'custom';
            return;
        }
        if (!inCustomSection) return;

        if (line.startsWith('ruleset=')) {
            const value = line.slice('ruleset='.length);
            const commaIndex = value.indexOf(',');
            if (commaIndex === -1) return;
            const outbound = value.slice(0, commaIndex).trim();
            const source = value.slice(commaIndex + 1).trim();
            if (outbound && source) rulesets.push({ outbound, source });
            return;
        }

        if (line.startsWith('custom_proxy_group=')) {
            const value = line.slice('custom_proxy_group='.length);
            const parts = value.split('`').map(part => part.trim()).filter(Boolean);
            const [name, type, ...tokens] = parts;
            if (name && type) proxyGroups.push({ name, type, tokens });
            return;
        }

        const equalsIndex = line.indexOf('=');
        if (equalsIndex === -1) return;
        const key = line.slice(0, equalsIndex).trim();
        const value = line.slice(equalsIndex + 1).trim();
        if (key === 'enable_rule_generator') flags.enableRuleGenerator = parseBoolean(value);
        if (key === 'overwrite_original_rules') flags.overwriteOriginalRules = parseBoolean(value);
    });

    return { rulesets, proxyGroups, flags };
}
