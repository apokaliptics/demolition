mod dnr;
mod dnr_adapter;
mod parser;
mod prioritize;

use clap::Parser;
use dnr_adapter::to_dnr_rules;
use parser::{parse_rules_native, parse_rules_with_adblock, ParsedRule, ParserMode};
use prioritize::prioritize_with_overflow;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Parser)]
#[command(name = "filter-compiler-rs")]
#[command(about = "Compile ABP-style filters into MV3 DNR JSON")]
struct Args {
    #[arg(short, long)]
    input: PathBuf,

    #[arg(short, long)]
    output: PathBuf,

    #[arg(long, default_value_t = 30_000)]
    max_static_rules: usize,

    #[arg(long, default_value_t = 1)]
    start_id: u32,

    #[arg(long, value_enum, default_value_t = ParserMode::Native)]
    parser_mode: ParserMode,

    #[arg(long)]
    overflow_output: Option<PathBuf>,

    #[arg(long, default_value_t = 5_000)]
    overflow_chunk_size: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OverflowChunkMeta {
    id: usize,
    rule_count: usize,
    start_id: u32,
    end_id: u32,
    path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OverflowMetadata {
    parser_mode: String,
    input: String,
    max_static_rules: usize,
    start_id: u32,
    total_parsed: usize,
    selected_count: usize,
    overflow_count: usize,
    chunk_size: usize,
    chunks: Vec<OverflowChunkMeta>,
}

fn write_overflow_outputs(
    overflow_rules: Vec<ParsedRule>,
    selected_count: usize,
    args: &Args,
) -> Result<(), String> {
    let Some(metadata_path) = args.overflow_output.as_ref() else {
        return Ok(());
    };

    if let Some(parent) = metadata_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed creating overflow output directory {}: {e}", parent.display()))?;
    }

    let chunk_size = args.overflow_chunk_size.max(1);
    let stem = metadata_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("overflow");
    let ext = metadata_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("json");

    let mut chunk_metas = Vec::new();

    for (idx, chunk) in overflow_rules.chunks(chunk_size).enumerate() {
        let chunk_id = idx + 1;
        let chunk_start_id = args.start_id + selected_count as u32 + (idx * chunk_size) as u32;
        let chunk_rules = to_dnr_rules(chunk.to_vec(), chunk_start_id);
        let chunk_file_name = format!("{stem}.chunk{chunk_id}.{ext}");
        let chunk_path = metadata_path.with_file_name(chunk_file_name.clone());
        let chunk_json = serde_json::to_string_pretty(&chunk_rules)
            .map_err(|e| format!("failed serializing overflow chunk json: {e}"))?;

        fs::write(&chunk_path, chunk_json)
            .map_err(|e| format!("failed writing overflow chunk {}: {e}", chunk_path.display()))?;

        let chunk_end_id = if chunk_rules.is_empty() {
            chunk_start_id
        } else {
            chunk_start_id + chunk_rules.len() as u32 - 1
        };

        chunk_metas.push(OverflowChunkMeta {
            id: chunk_id,
            rule_count: chunk_rules.len(),
            start_id: chunk_start_id,
            end_id: chunk_end_id,
            path: chunk_file_name,
        });
    }

    let metadata = OverflowMetadata {
        parser_mode: format!("{:?}", args.parser_mode).to_ascii_lowercase(),
        input: args.input.display().to_string(),
        max_static_rules: args.max_static_rules,
        start_id: args.start_id,
        total_parsed: selected_count + overflow_rules.len(),
        selected_count,
        overflow_count: overflow_rules.len(),
        chunk_size,
        chunks: chunk_metas,
    };

    let metadata_json = serde_json::to_string_pretty(&metadata)
        .map_err(|e| format!("failed serializing overflow metadata json: {e}"))?;
    fs::write(metadata_path, metadata_json)
        .map_err(|e| format!("failed writing overflow metadata {}: {e}", metadata_path.display()))?;

    Ok(())
}

fn main() -> Result<(), String> {
    let args = Args::parse();

    let text = fs::read_to_string(&args.input)
        .map_err(|e| format!("failed reading input {}: {e}", args.input.display()))?;

    let lines = text.lines().map(|s| s.to_string());
    let parsed = match args.parser_mode {
        ParserMode::Native => parse_rules_native(lines),
        ParserMode::Adblock => parse_rules_with_adblock(lines)?,
    };

    let result = prioritize_with_overflow(parsed, args.max_static_rules);
    let selected_count = result.selected.len();
    let overflow_count = result.overflow.len();
    let rules = to_dnr_rules(result.selected, args.start_id);

    let json = serde_json::to_string_pretty(&rules)
        .map_err(|e| format!("failed serializing json: {e}"))?;

    if let Some(parent) = args.output.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed creating output directory {}: {e}", parent.display()))?;
    }

    fs::write(&args.output, json)
        .map_err(|e| format!("failed writing output {}: {e}", args.output.display()))?;

    write_overflow_outputs(result.overflow, selected_count, &args)?;

    println!(
        "Compiled {} rules (overflow: {}) from {} -> {} (mode: {:?})",
        rules.len(),
        overflow_count,
        args.input.display(),
        args.output.display(),
        args.parser_mode
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pipeline_assigns_deterministic_ids_from_start_id() {
        let parsed = vec![
            ParsedRule {
                url_filter: "||one.example^".to_string(),
                resource_types: vec!["image".to_string()],
                priority: 1,
            },
            ParsedRule {
                url_filter: "||two.example^".to_string(),
                resource_types: vec!["script".to_string()],
                priority: 2,
            },
        ];

        let selected = prioritize_with_overflow(parsed, 10).selected;
        let rules = to_dnr_rules(selected, 500);

        assert_eq!(rules.len(), 2);
        assert_eq!(rules[0].id, 500);
        assert_eq!(rules[1].id, 501);
    }

    #[test]
    fn truncation_respects_max_static_rules() {
        let parsed = vec![
            ParsedRule {
                url_filter: "||a.example^".to_string(),
                resource_types: vec![],
                priority: 1,
            },
            ParsedRule {
                url_filter: "||b.example^".to_string(),
                resource_types: vec![],
                priority: 1,
            },
        ];

        let selected = prioritize_with_overflow(parsed, 1).selected;
        let rules = to_dnr_rules(selected, 1);

        assert_eq!(rules.len(), 1);
    }

    #[test]
    fn prioritize_with_overflow_reports_excess_rules() {
        let parsed = vec![
            ParsedRule {
                url_filter: "||a.example^".to_string(),
                resource_types: vec![],
                priority: 1,
            },
            ParsedRule {
                url_filter: "||b.example^".to_string(),
                resource_types: vec![],
                priority: 1,
            },
            ParsedRule {
                url_filter: "||c.example^".to_string(),
                resource_types: vec![],
                priority: 1,
            },
        ];

        let result = prioritize_with_overflow(parsed, 2);
        assert_eq!(result.selected.len(), 2);
        assert_eq!(result.overflow.len(), 1);
    }
}
