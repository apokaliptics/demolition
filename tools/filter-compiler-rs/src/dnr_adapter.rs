use crate::dnr::{DnrCondition, DnrRule};
use crate::parser::ParsedRule;

pub fn to_dnr_rules(parsed: Vec<ParsedRule>, start_id: u32) -> Vec<DnrRule> {
    parsed
        .into_iter()
        .enumerate()
        .map(|(idx, rule)| {
            let id = start_id + idx as u32;
            let condition = DnrCondition {
                url_filter: Some(rule.url_filter),
                regex_filter: None,
                resource_types: if rule.resource_types.is_empty() {
                    None
                } else {
                    Some(rule.resource_types)
                },
            };

            DnrRule::block(id, rule.priority, condition)
        })
        .collect()
}
