use crate::parser::ParsedRule;

pub struct PrioritizeResult {
    pub selected: Vec<ParsedRule>,
    pub overflow: Vec<ParsedRule>,
}

pub fn prioritize_with_overflow(mut rules: Vec<ParsedRule>, max_rules: usize) -> PrioritizeResult {
    rules.sort_by(|a, b| score_rule(b).cmp(&score_rule(a)));

    if rules.len() <= max_rules {
        return PrioritizeResult {
            selected: rules,
            overflow: vec![],
        };
    }

    let overflow = rules.split_off(max_rules);
    PrioritizeResult {
        selected: rules,
        overflow,
    }
}

fn score_rule(rule: &ParsedRule) -> i64 {
    let mut score = 100_i64;

    if rule.priority >= 2 {
        score += 120;
    }

    if !rule.resource_types.is_empty() {
        score += 25;
    }

    if rule.resource_types.iter().any(|t| t == "script" || t == "xmlhttprequest") {
        score += 60;
    }

    if rule.url_filter.starts_with("||") {
        score += 20;
    }

    if rule.url_filter.contains("google") || rule.url_filter.contains("doubleclick") {
        score += 80;
    }

    score
}
