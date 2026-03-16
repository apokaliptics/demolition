use clap::ValueEnum;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedRule {
    pub url_filter: String,
    pub resource_types: Vec<String>,
    pub priority: u32,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
pub enum ParserMode {
    Native,
    Adblock,
}

const SUPPORTED_RESOURCE_TYPES: &[&str] = &[
    "script",
    "image",
    "xmlhttprequest",
    "stylesheet",
    "font",
    "media",
    "object",
    "sub_frame",
];

pub fn parse_abp_line(line: &str) -> Option<ParsedRule> {
    let trimmed = line.trim();

    if trimmed.is_empty() || trimmed.starts_with('!') || trimmed.starts_with('[') {
        return None;
    }

    // Skip cosmetic/scriptlet rules in this stage. They are handled by content scripts.
    if trimmed.contains("##") || trimmed.contains("#@#") || trimmed.contains("##+js") {
        return None;
    }

    // Skip exception rules for now in static compilation path.
    if trimmed.starts_with("@@") {
        return None;
    }

    let (pattern, options) = split_pattern_and_options(trimmed);
    let url_filter = abp_pattern_to_url_filter(pattern)?;
    let resource_types = parse_resource_types(options);

    let priority = if looks_like_high_impact(&url_filter) { 2 } else { 1 };

    Some(ParsedRule {
        url_filter,
        resource_types,
        priority,
    })
}

pub fn parse_rules_native(lines: impl Iterator<Item = String>) -> Vec<ParsedRule> {
    lines.filter_map(|line| parse_abp_line(&line)).collect()
}

fn split_pattern_and_options(line: &str) -> (&str, Option<&str>) {
    if let Some(index) = line.rfind('$') {
        (&line[..index], Some(&line[index + 1..]))
    } else {
        (line, None)
    }
}

fn abp_pattern_to_url_filter(pattern: &str) -> Option<String> {
    let p = pattern.trim();
    if p.is_empty() {
        return None;
    }

    // Keep domain anchors and wildcard paths in DNR-compatible urlFilter syntax.
    if p.starts_with("||") {
        return Some(p.to_string());
    }

    // Most list lines work as direct urlFilter strings.
    Some(p.to_string())
}

fn parse_resource_types(options: Option<&str>) -> Vec<String> {
    let Some(opt_text) = options else {
        return vec![];
    };

    let mut out = Vec::new();

    for part in opt_text.split(',') {
        let token = part.trim().to_ascii_lowercase();
        if token.is_empty() || token.starts_with('~') {
            continue;
        }

        let mapped = match token.as_str() {
            "subdocument" | "frame" => Some("sub_frame"),
            other if SUPPORTED_RESOURCE_TYPES.contains(&other) => Some(other),
            _ => None,
        };

        if let Some(value) = mapped {
            if !out.iter().any(|x| x == value) {
                out.push(value.to_string());
            }
        }
    }

    out
}

fn looks_like_high_impact(filter: &str) -> bool {
    let f = filter.to_ascii_lowercase();
    [
        "doubleclick",
        "googlesyndication",
        "googleadservices",
        "adservice.google",
        "youtube",
        "ads",
        "tracker",
    ]
    .iter()
    .any(|needle| f.contains(needle))
}

#[cfg(feature = "adblock-bridge")]
pub fn parse_rules_with_adblock(lines: impl Iterator<Item = String>) -> Result<Vec<ParsedRule>, String> {
    use adblock::lists::{parse_filter, ParseOptions, ParsedFilter};

    let opts = ParseOptions::default();
    let mut out = Vec::new();

    for line in lines {
      let trimmed = line.trim();
      if trimmed.is_empty() {
          continue;
      }

      if let Ok(parsed) = parse_filter(trimmed, false, opts) {
          if let ParsedFilter::Network(_) = parsed {
              if let Some(rule) = parse_abp_line(trimmed) {
                  out.push(rule);
              }
          }
      }
    }

    Ok(out)
}

#[cfg(not(feature = "adblock-bridge"))]
pub fn parse_rules_with_adblock(_lines: impl Iterator<Item = String>) -> Result<Vec<ParsedRule>, String> {
    Err("parser mode 'adblock' requires building with --features adblock-bridge".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_parser_skips_comments_and_cosmetic_lines() {
        let src = "! comment\n@@||example.com^$document\nexample.com##.ad\n||ads.example^$image\n";
        let rules = parse_rules_native(src.lines().map(String::from));

        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].url_filter, "||ads.example^");
        assert_eq!(rules[0].resource_types, vec!["image".to_string()]);
    }

    #[test]
    fn native_and_bridge_match_for_basic_rule_when_feature_enabled() {
        let src = "||video.example^$media,script\n";

        #[cfg(feature = "adblock-bridge")]
        {
            let native = parse_rules_native(src.lines().map(String::from));
            let bridge = parse_rules_with_adblock(src.lines().map(String::from)).expect("adblock parser should parse basic rule");
            assert_eq!(bridge, native);
        }

        #[cfg(not(feature = "adblock-bridge"))]
        {
            let err = parse_rules_with_adblock(src.lines().map(String::from)).expect_err("bridge mode should be unavailable");
            assert!(err.contains("requires building with --features adblock-bridge"));
        }
    }
}
