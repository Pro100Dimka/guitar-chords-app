//! Build-time-only official ONNX -> canonical NNEF conversion.
//! Source and output SHA-256 validation is enforced by convert.py.
use anyhow::{ensure, format_err};
use std::{fs, time::Instant};
use tract_onnx::prelude::*;

fn main() -> TractResult<()> {
    let args: Vec<_> = std::env::args().collect();
    ensure!(
        args.len() == 3,
        "usage: chord-model-converter MODEL_ONNX MODEL_NNEF_TAR"
    );
    let started = Instant::now();
    let mut graph = tract_onnx::onnx().model_for_path(&args[1])?;
    let names = [
        "StatefulPartitionedCall:1",
        "StatefulPartitionedCall:2",
        "StatefulPartitionedCall:0",
    ];
    let outputs = graph.output_outlets()?.to_vec();
    let selected = names
        .iter()
        .map(|name| {
            outputs
                .iter()
                .copied()
                .find(|&outlet| graph.outlet_label(outlet) == Some(*name))
                .ok_or_else(|| format_err!("missing output {name}"))
        })
        .collect::<TractResult<Vec<_>>>()?;
    graph.select_output_outlets(&selected)?;
    let mut model = graph
        .with_input_fact(0, InferenceFact::dt_shape(f32::datum_type(), [1, 43844, 1]))?
        .into_typed()?
        .into_decluttered()?;
    // Decluttering assigns nondeterministic suffixes to equivalent temporary
    // node names. Names do not affect computation; canonicalize them by the
    // stable evaluation order while preserving public input and output labels.
    let inputs: Vec<_> = model
        .input_outlets()?
        .iter()
        .map(|outlet| outlet.node)
        .collect();
    for (index, node) in model.eval_order()?.into_iter().enumerate() {
        if !inputs.contains(&node) {
            model.node_mut(node).name = format!("node_{index:04}");
        }
    }
    let nodes = model.nodes().len();
    tract_nnef::nnef().write_to_tar_with_config(
        &model,
        fs::File::create(&args[2])?,
        false,
        true,
    )?;
    println!(
        "{{\"nodes\":{nodes},\"export_ms\":{},\"bytes\":{}}}",
        started.elapsed().as_secs_f64() * 1000.0,
        fs::metadata(&args[2])?.len()
    );
    Ok(())
}
