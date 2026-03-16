use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DnrRule {
    pub id: u32,
    pub priority: u32,
    pub action: DnrAction,
    pub condition: DnrCondition,
}

#[derive(Debug, Clone, Serialize)]
pub struct DnrAction {
    #[serde(rename = "type")]
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DnrCondition {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url_filter: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub regex_filter: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_types: Option<Vec<String>>,
}

impl DnrRule {
    pub fn block(id: u32, priority: u32, condition: DnrCondition) -> Self {
        Self {
            id,
            priority,
            action: DnrAction {
                kind: "block".to_string(),
            },
            condition,
        }
    }
}
