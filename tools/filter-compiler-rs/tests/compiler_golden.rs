use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

fn unique_temp_dir() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time should move forward")
        .as_nanos();
    let pid = std::process::id();
    let dir = std::env::temp_dir().join(format!("demolition-filter-tests-{pid}-{nanos}"));
    fs::create_dir_all(&dir).expect("should create temp dir");
    dir
}

fn run_compiler(input: &PathBuf, output: &PathBuf, parser_mode: &str) -> std::process::Output {
    run_compiler_with_args(
        input,
        output,
        parser_mode,
        &["--max-static-rules", "30", "--start-id", "100"],
    )
}

fn run_compiler_with_args(
    input: &PathBuf,
    output: &PathBuf,
    parser_mode: &str,
    extra_args: &[&str],
) -> std::process::Output {
    let bin = env!("CARGO_BIN_EXE_filter-compiler-rs");
    let mut cmd = Command::new(bin);
    cmd
        .arg("--input")
        .arg(input)
        .arg("--output")
        .arg(output)
        .arg("--parser-mode")
        .arg(parser_mode);

    for arg in extra_args {
        cmd.arg(arg);
    }

    cmd.output().expect("compiler should execute")
}

fn parse_json_file(path: &PathBuf) -> Value {
    let text = fs::read_to_string(path).expect("json output should be readable");
    serde_json::from_str(&text).expect("output should be valid json")
}

#[test]
fn native_mode_matches_golden_fixture() {
    let work = unique_temp_dir();
    let input = work.join("basic.abp");
    let output = work.join("rules.json");

    fs::write(&input, include_str!("fixtures/basic.abp")).expect("input should write");

    let result = run_compiler(&input, &output, "native");
    assert!(result.status.success(), "native compile failed: {}", String::from_utf8_lossy(&result.stderr));

    let actual = parse_json_file(&output);
    let expected: Value = serde_json::from_str(include_str!("fixtures/basic.native.expected.json"))
        .expect("golden fixture should parse");

    assert_eq!(actual, expected);
}

#[test]
fn native_mode_output_is_deterministic_across_runs() {
    let work = unique_temp_dir();
    let input = work.join("basic.abp");
    let out_a = work.join("rules-a.json");
    let out_b = work.join("rules-b.json");

    fs::write(&input, include_str!("fixtures/basic.abp")).expect("input should write");

    let a = run_compiler(&input, &out_a, "native");
    let b = run_compiler(&input, &out_b, "native");

    assert!(a.status.success(), "first run failed: {}", String::from_utf8_lossy(&a.stderr));
    assert!(b.status.success(), "second run failed: {}", String::from_utf8_lossy(&b.stderr));

    let rules_a = parse_json_file(&out_a);
    let rules_b = parse_json_file(&out_b);
    assert_eq!(rules_a, rules_b);
}

#[test]
fn overflow_outputs_are_emitted_when_requested() {
    let work = unique_temp_dir();
    let input = work.join("basic.abp");
    let output = work.join("rules.json");
    let overflow_meta = work.join("overflow.json");

    fs::write(&input, include_str!("fixtures/basic.abp")).expect("input should write");

    let result = run_compiler_with_args(
        &input,
        &output,
        "native",
        &[
            "--max-static-rules",
            "1",
            "--start-id",
            "100",
            "--overflow-output",
            overflow_meta.to_str().expect("overflow path should be valid utf-8"),
            "--overflow-chunk-size",
            "1",
        ],
    );
    assert!(result.status.success(), "compile with overflow output failed: {}", String::from_utf8_lossy(&result.stderr));

    let meta = parse_json_file(&overflow_meta);
    assert_eq!(meta["selectedCount"], 1);
    assert_eq!(meta["overflowCount"], 2);
    assert_eq!(meta["chunkSize"], 1);

    let chunks = meta["chunks"].as_array().expect("chunks should be an array");
    assert_eq!(chunks.len(), 2);

    let chunk_path_1 = work.join(chunks[0]["path"].as_str().expect("chunk path should be string"));
    let chunk_path_2 = work.join(chunks[1]["path"].as_str().expect("chunk path should be string"));

    assert!(chunk_path_1.exists());
    assert!(chunk_path_2.exists());

    let chunk1 = parse_json_file(&chunk_path_1);
    let chunk2 = parse_json_file(&chunk_path_2);

    assert_eq!(chunk1.as_array().expect("chunk 1 should be array").len(), 1);
    assert_eq!(chunk2.as_array().expect("chunk 2 should be array").len(), 1);
}

#[cfg(feature = "adblock-bridge")]
#[test]
fn adblock_mode_matches_native_for_basic_fixture() {
    let work = unique_temp_dir();
    let input = work.join("basic.abp");
    let native_output = work.join("native.json");
    let adblock_output = work.join("adblock.json");

    fs::write(&input, include_str!("fixtures/basic.abp")).expect("input should write");

    let native = run_compiler(&input, &native_output, "native");
    let adblock = run_compiler(&input, &adblock_output, "adblock");

    assert!(native.status.success(), "native run failed: {}", String::from_utf8_lossy(&native.stderr));
    assert!(adblock.status.success(), "adblock run failed: {}", String::from_utf8_lossy(&adblock.stderr));

    let native_rules = parse_json_file(&native_output);
    let adblock_rules = parse_json_file(&adblock_output);
    assert_eq!(adblock_rules, native_rules);
}

#[cfg(not(feature = "adblock-bridge"))]
#[test]
fn adblock_mode_reports_feature_requirement_without_bridge() {
    let work = unique_temp_dir();
    let input = work.join("basic.abp");
    let output = work.join("adblock.json");

    fs::write(&input, include_str!("fixtures/basic.abp")).expect("input should write");

    let result = run_compiler(&input, &output, "adblock");
    assert!(!result.status.success(), "adblock mode should fail without feature");

    let stderr = String::from_utf8_lossy(&result.stderr);
    assert!(
        stderr.contains("requires building with --features adblock-bridge"),
        "unexpected stderr: {stderr}"
    );
}
